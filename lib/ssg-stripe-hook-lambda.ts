import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as iam from "aws-cdk-lib/aws-iam";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as sns from "aws-cdk-lib/aws-sns";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";

interface StripeHookProps extends cdk.StackProps {
  repository: ecr.Repository;
  topic: sns.Topic;
  lambdaName: string;
  repositoryVersion: string;
  stripeTopicArnParam: ssm.StringParameter;
  ssgSecret: secretsmanager.Secret;
}

function createMetrics(
  stack: cdk.Stack,
  lambdaFunction: lambda.IFunction,
  topic: sns.ITopic,
  deadLetterQueue: sqs.IQueue
) {
  const metricsConfig = [
    {
      metric: lambdaFunction.metricErrors(),
      alarmProps: {
        threshold: 1,
        evaluationPeriods: 1,
        alarmDescription: "Alarm if the Lambda function encounters errors.",
      },
    },
    {
      metric: lambdaFunction.metricDuration(),
      alarmProps: {
        threshold: 5000,
        evaluationPeriods: 1,
        alarmDescription:
          "Alarm if Lambda function duration exceeds 5 seconds.",
      },
    },
    {
      metric: topic.metricNumberOfMessagesPublished(),
      alarmProps: {
        threshold: 100,
        evaluationPeriods: 1,
        alarmDescription:
          "Alarm if too many messages are published to the topic.",
      },
    },
    {
      metric: topic.metricNumberOfNotificationsFailed(),
      alarmProps: {
        threshold: 10,
        evaluationPeriods: 1,
        alarmDescription: "Alarm if notifications fail.",
      },
    },
    {
      metric: deadLetterQueue.metricApproximateNumberOfMessagesVisible(),
      alarmProps: {
        threshold: 5,
        evaluationPeriods: 1,
        alarmDescription:
          "Alarm if messages start to accumulate in the dead-letter queue.",
      },
    },
  ];

  return metricsConfig.map(({ metric, alarmProps }, index) => {
    const alarm = new cloudwatch.Alarm(stack, `Alarm-${index}`, {
      metric,
      threshold: alarmProps.threshold,
      evaluationPeriods: alarmProps.evaluationPeriods,
      alarmDescription: alarmProps.alarmDescription,
      actionsEnabled: true,
    });

    return { metric, alarm };
  });
}

export class SsgStripeHookStack extends cdk.Stack {
  lambdaFunction: lambda.DockerImageFunction;
  lambdaAlias: lambda.Alias;
  deadLetterQueue: sqs.IQueue;
  constructor(scope: Construct, id: string, props?: StripeHookProps) {
    super(scope, id, props);

    if (!props?.repository) {
      throw new Error("repository is required");
    }
    if (!props?.repositoryVersion) {
      throw new Error("stripeHookVersion is required");
    }

    const { lambdaFunction, lambdaAlias, deadLetterQueue } =
      this.createLambdaFunction(props);
    this.deadLetterQueue = deadLetterQueue;
    this.lambdaAlias = lambdaAlias;
    this.lambdaFunction = lambdaFunction;

    createMetrics(this, this.lambdaFunction, props.topic, this.deadLetterQueue);
  }

  createLambdaFunction({
    lambdaName,
    topic,
    repositoryVersion,
    repository,
    ssgSecret,
    stripeTopicArnParam,
  }: {
    lambdaName: string;
    topic: sns.Topic;
    repositoryVersion: string;
    repository: ecr.Repository;
    ssgSecret: secretsmanager.Secret;
    stripeTopicArnParam: ssm.StringParameter;
  }) {
    const deadLetterQueue = new sqs.Queue(
      this,
      `${lambdaName}LambdaDeadLetterQueue`,
      {
        queueName: `${lambdaName}LambdaDeadLetterQueue`,
        retentionPeriod: cdk.Duration.days(7),
      }
    );
    // Create an IAM role for the Lambda function
    const executionRole = new iam.Role(
      this,
      `${lambdaName}LambdaExecutionRole`,
      {
        assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
        roleName: `${lambdaName.toLowerCase()}-lambda-execution-role`,
        description: `${lambdaName} Execution Role`,
      }
    );

    executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: `Allow${lambdaName}ToPublish`,
        effect: iam.Effect.ALLOW,
        actions: ["sns:Publish"],
        resources: [topic.topicArn],
      })
    );
    executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: `Allow${lambdaName}ToAccessParameters`,
        effect: iam.Effect.ALLOW,
        actions: ["ssm:GetParameter"],
        resources: [stripeTopicArnParam.parameterArn],
      })
    );
    executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: `Allow${lambdaName}ToSecrets`,
        effect: iam.Effect.ALLOW,
        actions: ["secretsmanager:GetSecretValue"],
        resources: [ssgSecret.secretArn],
      })
    );
    // Add the necessary policies to the Lambda execution role
    executionRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName(
        "service-role/AWSLambdaBasicExecutionRole"
      )
    );

    const logGroup = new logs.LogGroup(this, `${lambdaName}LogGroup`, {
      logGroupName: `/aws/lambda/${lambdaName}`,
      retention: logs.RetentionDays.ONE_WEEK, // Adjust as needed
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const lambdaFunction = new lambda.DockerImageFunction(this, lambdaName, {
      code: lambda.DockerImageCode.fromEcr(repository, {
        tagOrDigest: repositoryVersion ?? "latest",
      }),
      functionName: lambdaName,
      memorySize: 1024,
      timeout: cdk.Duration.seconds(10),
      role: executionRole,
      description: `${lambdaName} Lambda Function`,
      deadLetterQueue: deadLetterQueue,
      environment: topic
        ? {
            TOPIC_ARN: topic.topicArn,
          }
        : {},
      logRetention: logs.RetentionDays.ONE_WEEK, // Ensures logs are retained for a week
    });

    const lambdaAlias = new lambda.Alias(this, `${lambdaName}Alias`, {
      aliasName: lambdaName,
      version: lambdaFunction.currentVersion,
    });

    // Example: Lambda error alarm
    new cloudwatch.Alarm(this, `${lambdaName}LambdaErrorAlarm`, {
      metric: lambdaFunction.metricErrors(),
      threshold: 1,
      evaluationPeriods: 1,
      alarmDescription: "Alarm if the Lambda function encounters errors.",
      actionsEnabled: true,
    });
    // Associate the log group with the Lambda function
    logGroup.grantWrite(lambdaFunction);

    this.LambdaOutput(lambdaName, lambdaFunction, lambdaAlias, repository);
    return {
      deadLetterQueue,
      lambdaFunction,
      lambdaAlias,
    };
  }

  private LambdaOutput(
    name: string,
    lambdaFunction: lambda.DockerImageFunction,
    lambdaAlias: lambda.Alias,
    repository: ecr.Repository
  ) {
    new cdk.CfnOutput(this, `${name}LambdaArn`, {
      value: lambdaFunction.functionArn,
      exportName: `${name}LambdaArn`,
    });
    new cdk.CfnOutput(this, `${name}LambdaAliasArn`, {
      value: lambdaAlias.functionArn,
      exportName: `${name}LambdaAliasArn`,
    });
    new cdk.CfnOutput(this, `${name}Lambda`, {
      value: lambdaAlias.aliasName,
      exportName: `${name}Lambda`,
    });
    new cdk.CfnOutput(this, `${name}RepositoryArn`, {
      value: repository.repositoryArn,
      exportName: `${name}RepositoryArn`,
    });
  }
}
