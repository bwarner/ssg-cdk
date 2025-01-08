import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cdk from 'aws-cdk-lib';
import * as batch from 'aws-cdk-lib/aws-batch';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sns_subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';

import { IRepository } from 'aws-cdk-lib/aws-ecr';

interface SsgCloudWatchSchedulerProps extends cdk.StackProps {
  repo: IRepository;
  lowPriorityQueue: batch.JobQueue;
  highPriorityQueue: batch.JobQueue;
}

export class CloudWatchSchedulerStack extends cdk.Stack {
  lambdaFunction: lambda.DockerImageFunction;
  lambdaAlias: lambda.Alias;
  jobCommandTopic: sns.Topic;
  jobCommandQueue: sqs.IQueue;
  deadLetterQueue: sqs.IQueue;
  snsDeadLetterQueue: sqs.IQueue;
  scheduleDeadLetterQueue: sqs.IQueue;
  scheduleLambdaDeadLetterQueue: sqs.IQueue;
  devQueue: sqs.Queue;

  constructor(
    scope: Construct,
    id: string,
    props?: SsgCloudWatchSchedulerProps,
  ) {
    super(scope, id, props);

    if (!props || !props.repo) {
      throw new Error('Missing required repository prop');
    }

    // Create an IAM role for the Lambda function
    const executionRole = new iam.Role(this, 'ScheduleBatchExecutionRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      roleName: 'scheduler-batch-execution-role',
      description: 'Scheduler Batch Execution Role',
    });

    // Add the necessary policies to the Lambda execution role
    executionRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName(
        'service-role/AWSBatchServiceRole',
      ),
    );
    executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'BatchSubmitJob',
        actions: ['batch:SubmitJob'],
        resources: ['*'],
      }),
    );

    // Create a CloudWatch Logs group for the Lambda function
    const logGroup = new logs.LogGroup(this, 'ScheduleBatchGroup', {
      logGroupName: '/aws/lambda/ScheduleBatch',
      retention: logs.RetentionDays.ONE_WEEK, // Adjust as needed
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.scheduleLambdaDeadLetterQueue = new sqs.Queue(
      this,
      'ScheduleLambdaDeadLetterQueue',
      {
        queueName: 'ScheduleLambdaDeadLetterQueue',
        retentionPeriod: cdk.Duration.days(7),
      },
    );

    new cdk.CfnOutput(this, 'ScheduleLambdaDeadLetterQueueArn', {
      value: this.scheduleLambdaDeadLetterQueue.queueArn,
      exportName: 'ScheduleLambdaDeadLetterQueueArn',
    });

    executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'BatchLambdaLambdaSendMessages',
        effect: iam.Effect.ALLOW,
        actions: ['sqs:SendMessage'],
        resources: [this.scheduleLambdaDeadLetterQueue.queueArn],
      }),
    );

    this.lambdaFunction = new lambda.DockerImageFunction(
      this,
      'ScheduleBatch',
      {
        code: lambda.DockerImageCode.fromEcr(props.repo, {
          tagOrDigest: process.env.SCHEDULE_BATCH_VERSION ?? 'latest',
        }),
        functionName: 'ScheduleBatch',
        memorySize: 1024,
        timeout: cdk.Duration.seconds(10),
        role: executionRole,
        description: 'Scheduler Batch Lambda Function',
        deadLetterQueue: this.scheduleLambdaDeadLetterQueue,
        environment: {
          BATCH_JOB_QUEUE: props.lowPriorityQueue.jobQueueArn,
        },
        logRetention: logs.RetentionDays.ONE_WEEK, // Ensures logs are retained for a week
      },
    );

    this.lambdaAlias = new lambda.Alias(this, 'ScheduleBatchAlias', {
      aliasName: 'currentBatch',
      version: this.lambdaFunction.currentVersion,
    });

    // Example: Lambda error alarm
    new cloudwatch.Alarm(this, 'LambdaErrorAlarm', {
      metric: this.lambdaFunction.metricErrors(),
      threshold: 1,
      evaluationPeriods: 1,
      alarmDescription: 'Alarm if the Lambda function encounters errors.',
      actionsEnabled: true,
    });
    // Associate the log group with the Lambda function
    logGroup.grantWrite(this.lambdaFunction);

    // Dead Letter Queue
    this.deadLetterQueue = new sqs.Queue(this, 'JobCommandDeadLetterQueue', {
      queueName: 'JobCommandDeadLetterQueue',
      retentionPeriod: cdk.Duration.days(7),
    });

    // Dead Letter Queue
    this.snsDeadLetterQueue = new sqs.Queue(this, 'SNSCommandDeadLetterQueue', {
      queueName: 'SNSJobCommandDeadLetterQueue',
      retentionPeriod: cdk.Duration.days(7),
    });

    this.scheduleDeadLetterQueue = new sqs.Queue(
      this,
      'ScheduleDeadLetterQueue',
      {
        queueName: 'ScheduleDeadLetterQueue',
        retentionPeriod: cdk.Duration.days(7),
      },
    );

    new cdk.CfnOutput(this, 'ScheduleDeadLetterQueueArn', {
      value: this.scheduleDeadLetterQueue.queueArn,
      exportName: 'ScheduleDeadLetterQueueArn',
    });

    this.createSnsTopic();
    this.createSQSQueue();
    this.addPermissions();
  }

  createSnsTopic() {
    // Job Command Topic
    this.jobCommandTopic = new sns.Topic(this, 'JobCommandTopic', {
      topicName: 'JobCommandTopic',
      displayName: 'Job Command SNS Topic',
    });

    // Enable delivery status logging for SNS
    this.jobCommandTopic.addSubscription(
      new sns_subscriptions.SqsSubscription(this.deadLetterQueue, {
        rawMessageDelivery: false,
      }),
    );

    new cdk.CfnOutput(this, 'JobCommandTopicArn', {
      value: this.jobCommandTopic.topicArn,
      exportName: 'JobCommandTopicArn',
    });
  }

  createSQSQueue() {
    // Job Command Queue
    this.jobCommandQueue = new sqs.Queue(this, 'JobCommandQueue', {
      queueName: 'JobCommandQueue',
      visibilityTimeout: cdk.Duration.seconds(30),
      deadLetterQueue: {
        maxReceiveCount: 5,
        queue: this.snsDeadLetterQueue,
      },
    });

    // Define a custom CloudWatch metric for the approximate age of the oldest message
    const ageOfOldestMessageMetric = new cloudwatch.Metric({
      namespace: 'AWS/SQS',
      metricName: 'ApproximateAgeOfOldestMessage',
      dimensionsMap: {
        QueueName: this.jobCommandQueue.queueName,
      },
    });

    // Example: Create an alarm for the approximate age of the oldest message
    new cloudwatch.Alarm(this, 'QueueAgeAlarm', {
      metric: ageOfOldestMessageMetric,
      threshold: 300, // Alarm if the age of the oldest message exceeds 5 minutes
      evaluationPeriods: 1,
      alarmDescription: 'Alarm if the SQS queue message age exceeds 5 minutes.',
      actionsEnabled: true,
    });

    // Developer Queue for handling scheduling commands
    this.devQueue = new sqs.Queue(this, 'DevSchedulingCommandQueue', {
      queueName: 'DevSchedulingCommandQueue',
      visibilityTimeout: cdk.Duration.seconds(30),
    });

    // Add the Job Command Queue as an event source for the Lambda function
    this.lambdaAlias.addEventSourceMapping('JobCommandQueueEventSource', {
      eventSourceArn: this.jobCommandQueue.queueArn,
      batchSize: 1, // Number of messages to process at a time
    });

    // Grant the Lambda function permissions to read from the Job Command Queue
    this.jobCommandQueue.grantConsumeMessages(this.lambdaFunction);

    const subscription = new sns_subscriptions.SqsSubscription(
      this.jobCommandQueue,
    );
    this.jobCommandTopic.addSubscription(subscription);

    new cdk.CfnOutput(this, 'JobCommandQueueUrl', {
      value: this.jobCommandQueue.queueUrl,
      exportName: 'JobCommandQueueUrl',
    });

    new cdk.CfnOutput(this, 'DevQueueUrl', {
      value: this.devQueue.queueUrl,
      exportName: 'DevQueueUrl',
    });

    new cdk.CfnOutput(this, 'JobCommandDeadLetterQueueUrl', {
      value: this.deadLetterQueue.queueUrl,
      exportName: 'JobCommandDeadLetterQueueUrl',
    });
  }

  addPermissions() {
    // create a role that allows CloudWatch Events to publish to the SNS topic
    const eventScheduleRuleRole = new iam.Role(this, 'EventRuleRole', {
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com'),
      roleName: 'EventJobRuleRole',
    });

    eventScheduleRuleRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'AllowEventBridgeToPublish',
        effect: iam.Effect.ALLOW,
        actions: ['sns:Publish'],
        resources: [this.jobCommandTopic.topicArn],
      }),
    );

    eventScheduleRuleRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'AllowSchedulerToSendMesaages',
        effect: iam.Effect.ALLOW,
        actions: ['sqs:SendMessage'],
        resources: [this.scheduleDeadLetterQueue.queueArn],
      }),
    );

    new cdk.CfnOutput(this, 'EventRuleRoleArn', {
      value: eventScheduleRuleRole.roleArn,
      exportName: 'eventScheduleRuleArn',
    });

    // Allow the SNS Topic to send messages to the SQS Queue
    this.jobCommandQueue.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'AllowSNSDelivery',
        effect: iam.Effect.ALLOW,
        principals: [new iam.ServicePrincipal('sns.amazonaws.com')],
        actions: ['sqs:SendMessage'],
        resources: [this.jobCommandQueue.queueArn],
        conditions: {
          ArnEquals: {
            'aws:SourceArn': this.jobCommandTopic.topicArn,
          },
        },
      }),
    );

    // Allow the SQS Queue to trigger the Lambda function
    this.lambdaFunction.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'AllowSQSTrigger',
        actions: [
          'sqs:ReceiveMessage',
          'sqs:DeleteMessage',
          'sqs:GetQueueAttributes',
        ],
        resources: [this.jobCommandQueue.queueArn],
      }),
    );
  }
}
