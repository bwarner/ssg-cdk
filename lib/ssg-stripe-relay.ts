import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as iam from "aws-cdk-lib/aws-iam";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as ssm from "aws-cdk-lib/aws-ssm";
interface SsgRelayLambdaProps extends cdk.StackProps {
  repository: ecr.Repository;
  lambdaName: string;
  repositoryVersion: string;
  stripeDestinationUrl: ssm.StringParameter;
}

export class SsgRelayLambdaStack extends cdk.Stack {
  lambdaFunction: lambda.DockerImageFunction;
  lambdaAlias: lambda.Alias;
  deadLetterQueue: sqs.IQueue;
  stripeDestinationUrl: ssm.StringParameter;
  constructor(scope: Construct, id: string, props?: SsgRelayLambdaProps) {
    super(scope, id, props);

    if (!props?.repository) {
      throw new Error("repository is required");
    }
    if (!props?.repositoryVersion) {
      throw new Error("stripeHookVersion is required");
    }
    // if (!props?.stripeDestinationUrl) {
    //   throw new Error('stripeDestinationUrl is required');
    // }

    // this.stripeDestinationUrl = props.stripeDestinationUrl;
    const { lambdaFunction, lambdaAlias, deadLetterQueue } =
      this.createLambdaFunction(props);
    this.deadLetterQueue = deadLetterQueue;
    this.lambdaAlias = lambdaAlias;
    this.lambdaFunction = lambdaFunction;

    createMetrics(this, this.lambdaFunction, this.deadLetterQueue);
  }

  createLambdaFunction({
    lambdaName,
    repositoryVersion,
    repository,
  }: {
    lambdaName: string;
    repositoryVersion: string;
    repository: ecr.Repository;
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

    // Add the necessary policies to the Lambda execution role
    executionRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName(
        "service-role/AWSLambdaBasicExecutionRole"
      )
    );

    executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: `Allow${lambdaName}ToAccessSSM`,
        effect: iam.Effect.ALLOW,
        actions: ["ssm:GetParameter"],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter/ssg/*`,
        ],
      })
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

function createMetrics(
  stack: cdk.Stack,
  lambdaFunction: lambda.IFunction,
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
      metric: lambdaFunction.metricThrottles,
    },
    {
      metric: lambdaFunction.metricDuration,
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
    let alarm: cloudwatch.Alarm | undefined;
    if (alarmProps) {
      alarm = new cloudwatch.Alarm(stack, `Alarm-${index}`, {
        metric,
        threshold: alarmProps.threshold,
        evaluationPeriods: alarmProps.evaluationPeriods,
        alarmDescription: alarmProps.alarmDescription,
        actionsEnabled: true,
      });
    }

    return { metric, alarm };
  });
}
