import { Construct } from "constructs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as cdk from "aws-cdk-lib";
import * as batch from "aws-cdk-lib/aws-batch";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as sns from "aws-cdk-lib/aws-sns";
import * as sns_subscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import { IRepository } from "aws-cdk-lib/aws-ecr";
import Settings from "./settings";
import { createLambdaFunction } from "./utils";
import * as ecr from "aws-cdk-lib/aws-ecr";
interface SsgCloudWatchSchedulerProps extends cdk.StackProps {
  repo: IRepository;
  lowPriorityQueue: batch.JobQueue;
  highPriorityQueue: batch.JobQueue;
  relayLambdaRepository: ecr.Repository;
  ebScheduleRepository: ecr.Repository;
  policies?: iam.PolicyStatement[];
}

export class CloudWatchSchedulerStack extends cdk.Stack {
  lambdaFunction: lambda.DockerImageFunction;
  lambdaAlias: lambda.Alias;
  jobCommandTopic: sns.Topic;
  jobCommandQueue: sqs.IQueue;
  scheduleDeadLetterQueue: sqs.IQueue;
  scheduleLambdaFunction: lambda.DockerImageFunction;
  scheduleLambdaAlias: lambda.Alias;
  devQueue: sqs.Queue;
  settings: Settings;
  constructor(
    scope: Construct,
    id: string,
    props?: SsgCloudWatchSchedulerProps
  ) {
    super(scope, id, props);

    if (!props || !props.repo) {
      throw new Error("Missing required repository prop");
    }

    if (
      !process.env.EB_SCHEDULE_LAMBDA_VERSION ||
      !process.env.RELAY_LAMBDA_VERSION
    ) {
      throw new Error(
        "Missing required EB_SCHEDULE_LAMBDA_VERSION OR RELAY_LAMBDA_VERSION prop"
      );
    }

    const relayLambdaVersion = process.env.RELAY_LAMBDA_VERSION;
    const relayLambdaName = "SchedulerRelay";
    if (!relayLambdaVersion) {
      throw new Error("Missing required relayLambdaVersion prop");
    }
    this.settings = new Settings(this);

    const { lambdaFunction, deadLetterQueue, lambdaAlias } =
      createLambdaFunction({
        stack: this,
        lambdaName: relayLambdaName,
        repositoryVersion: relayLambdaVersion,
        repository: props.relayLambdaRepository,
        environment: {
          DESTINATION_URL: this.settings.schedulerDestinationUrl,
        },
      });

    const {
      lambdaFunction: scheduleLambdaFunction,
      lambdaAlias: scheduleLambdaAlias,
    } = createLambdaFunction({
      stack: this,
      lambdaName: "ScheduleLambda",
      repositoryVersion: process.env.EB_SCHEDULE_LAMBDA_VERSION,
      repository: props.ebScheduleRepository,
    });

    this.lambdaFunction = lambdaFunction;
    this.lambdaAlias = lambdaAlias;
    this.scheduleLambdaFunction = scheduleLambdaFunction;
    this.scheduleLambdaAlias = scheduleLambdaAlias;

    this.scheduleDeadLetterQueue = new sqs.Queue(
      this,
      "ScheduleDeadLetterQueue",
      {
        queueName: "ScheduleDeadLetterQueue",
        retentionPeriod: cdk.Duration.days(7),
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }
    );
    new cdk.CfnOutput(this, "ScheduleDeadLetterQueueArn", {
      value: this.scheduleDeadLetterQueue.queueArn,
      exportName: "ScheduleDeadLetterQueueArn",
    });

    this.createSnsTopic();
    this.createSQSQueue();
    this.addPermissions();
  }

  createSnsTopic() {
    // Job Command Topic
    this.jobCommandTopic = new sns.Topic(this, "JobCommandTopic", {
      topicName: "JobCommandTopic",
      displayName: "Job Command SNS Topic",
    });

    new cdk.CfnOutput(this, "JobCommandTopicArn", {
      value: this.jobCommandTopic.topicArn,
      exportName: "JobCommandTopicArn",
    });
  }

  createSQSQueue() {
    // Dead Letter Queue
    const jobCommandQueueDLQ = new sqs.Queue(this, "JobCommandQueueDLQ", {
      queueName: "JobCommandQueueDLQ",
      retentionPeriod: cdk.Duration.days(7),
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Job Command Queue
    this.jobCommandQueue = new sqs.Queue(this, "JobCommandQueue", {
      queueName: "JobCommandQueue",
      visibilityTimeout: cdk.Duration.seconds(60),
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      deadLetterQueue: {
        maxReceiveCount: 5,
        queue: jobCommandQueueDLQ,
      },
    });

    // Define a custom CloudWatch metric for the approximate age of the oldest message
    const ageOfOldestMessageMetric = new cloudwatch.Metric({
      namespace: "AWS/SQS",
      metricName: "ApproximateAgeOfOldestMessage",
      dimensionsMap: {
        QueueName: this.jobCommandQueue.queueName,
      },
    });

    // Example: Create an alarm for the approximate age of the oldest message
    new cloudwatch.Alarm(this, "QueueAgeAlarm", {
      metric: ageOfOldestMessageMetric,
      threshold: this.settings.queueAlarmThreshold, // Alarm if the age of the oldest message exceeds 5 minutes
      evaluationPeriods: this.settings.queueAlarmEvaluationPeriod,
      alarmDescription: "Alarm if the SQS queue message age exceeds 5 minutes.",
      actionsEnabled: this.settings.queueAlarmActionsEnabled,
    });

    // Developer Queue for handling scheduling commands
    this.devQueue = new sqs.Queue(this, "DevSchedulingCommandQueue", {
      queueName: "DevSchedulingCommandQueue",
      visibilityTimeout: cdk.Duration.seconds(30),
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    new cdk.CfnOutput(this, "DevQueueUrl", {
      value: this.devQueue.queueUrl,
      exportName: "DevQueueUrl",
    });

    // Add the Job Command Queue as an event source for the Lambda function
    this.lambdaAlias.addEventSourceMapping("JobCommandQueueEventSource", {
      eventSourceArn: this.jobCommandQueue.queueArn,
      batchSize: 1, // Number of messages to process at a time
    });

    // Grant the Lambda function permissions to read from the Job Command Queue
    this.jobCommandQueue.grantConsumeMessages(this.lambdaFunction);

    this.scheduleLambdaFunction.addEnvironment(
      "TOPIC_ARN",
      this.jobCommandTopic.topicArn
    );
    // Grant the Lambda function permission to publish to the Job Command Topic
    this.jobCommandTopic.grantPublish(this.scheduleLambdaFunction);

    const jobCommandTopicDLQ = new sqs.Queue(this, "JobCommandTopicDLQ", {
      queueName: "JobCommandTopicDLQ",
      retentionPeriod: cdk.Duration.days(7),
    });

    jobCommandTopicDLQ.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: "AllowSNSToWriteToDLQ",
        effect: iam.Effect.ALLOW,
        principals: [new iam.ServicePrincipal("sns.amazonaws.com")],
        actions: ["sqs:SendMessage", "sqs:GetQueueUrl"],
        resources: [jobCommandTopicDLQ.queueArn],
        conditions: {
          ArnEquals: {
            "aws:SourceArn": this.jobCommandTopic.topicArn,
          },
          StringEquals: {
            "aws:SourceAccount": this.account,
          },
        },
      })
    );

    // Enable delivery status logging for SNS
    this.jobCommandTopic.addSubscription(
      new sns_subscriptions.SqsSubscription(this.jobCommandQueue, {
        rawMessageDelivery: false,
        deadLetterQueue: jobCommandTopicDLQ,
        filterPolicy: {},
      })
    );

    new cdk.CfnOutput(this, "JobCommandQueueUrl", {
      value: this.jobCommandQueue.queueUrl,
      exportName: "JobCommandQueueUrl",
    });

    new cdk.CfnOutput(this, "JobCommandTopicDLQUrl", {
      value: jobCommandTopicDLQ.queueUrl,
      exportName: "JobCommandTopicDLQUrl",
    });
  }

  addPermissions() {
    // create a role that allows CloudWatch Events to publish to the SNS topic
    const eventScheduleRuleRole = new iam.Role(this, "EventRuleRole", {
      assumedBy: new iam.ServicePrincipal("scheduler.amazonaws.com"),
      roleName: "EventJobRuleRole",
    });

    eventScheduleRuleRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "AllowSchedulerToInvokeLambda",
        effect: iam.Effect.ALLOW,
        actions: ["lambda:InvokeFunction"],
        resources: [this.scheduleLambdaAlias.functionArn],
      })
    );
    new cdk.CfnOutput(this, "EventRuleRoleArn", {
      value: eventScheduleRuleRole.roleArn,
      exportName: "eventScheduleRuleArn",
    });

    // Allow the SNS Topic to send messages to the SQS Queue
    this.jobCommandQueue.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: "AllowSNSDelivery",
        effect: iam.Effect.ALLOW,
        principals: [new iam.ServicePrincipal("sns.amazonaws.com")],
        actions: ["sqs:SendMessage"],
        resources: [this.jobCommandQueue.queueArn],
        conditions: {
          ArnEquals: {
            "aws:SourceArn": this.jobCommandTopic.topicArn,
          },
          StringEquals: {
            "aws:SourceAccount": this.account, // Ensures only SNS topics in your AWS account can send messages
          },
        },
      })
    );
    // Allow the SQS Queue to trigger the Lambda function
    this.lambdaFunction.addToRolePolicy(
      new iam.PolicyStatement({
        sid: "AllowSQSTrigger",
        actions: [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes",
        ],
        resources: [this.jobCommandQueue.queueArn],
      })
    );
  }
}
