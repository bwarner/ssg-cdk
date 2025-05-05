import { Stack } from "aws-cdk-lib";
import * as cdk from "aws-cdk-lib";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as iam from "aws-cdk-lib/aws-iam";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { DLQ_RETENTION_DAYS } from "./const";
import Settings from "./settings";
import { IManagedPolicy } from "aws-cdk-lib/aws-iam";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";

export function createLambdaFunction({
  stack,
  lambdaName,
  repositoryVersion,
  repository,
  policies,
  environment,
}: {
  stack: Stack;
  lambdaName: string;
  repositoryVersion: string;
  repository: ecr.Repository;
  policies?: PolicyStatement[];
  managedPolicies?: IManagedPolicy[];
  environment?: Record<string, string>;
}) {
  const settings = new Settings(stack);
  const deadLetterQueue = new sqs.Queue(
    stack,
    `${lambdaName}LambdaDeadLetterQueue`,
    {
      queueName: `${lambdaName}LambdaDeadLetterQueue`,
      retentionPeriod: cdk.Duration.days(DLQ_RETENTION_DAYS),
      removalPolicy: settings.removalPolicy,
    }
  );

  // Create an IAM role for the Lambda function
  const executionRole = new iam.Role(
    stack,
    `${lambdaName}LambdaExecutionRole`,
    {
      assumedBy: new iam.CompositePrincipal(
        new iam.ServicePrincipal("lambda.amazonaws.com"),
        new iam.AccountPrincipal(stack.account)
      ),
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
        `arn:aws:ssm:${stack.region}:${stack.account}:parameter/ssg/*`,
      ],
    })
  );

  if (policies) {
    for (const policy of policies) {
      executionRole.addToPolicy(policy);
    }
  }

  const logGroup = new logs.LogGroup(stack, `${lambdaName}LogGroup`, {
    logGroupName: `/aws/lambda/${lambdaName}`,
    retention: settings.logRetentionPeriod,
    removalPolicy: settings.removalPolicy,
  });

  const lambdaFunction = new lambda.DockerImageFunction(stack, lambdaName, {
    code: lambda.DockerImageCode.fromEcr(repository, {
      tagOrDigest: repositoryVersion ?? "latest",
    }),
    functionName: lambdaName,
    memorySize: 1024,
    timeout: cdk.Duration.seconds(10),
    role: executionRole,
    logGroup,
    description: `${lambdaName} Lambda Function`,
    deadLetterQueue: deadLetterQueue,
    environment: environment,
  });

  const lambdaAlias = new lambda.Alias(
    stack,
    `${lambdaName}${settings.env.toUpperCase()}`,
    {
      aliasName: `${lambdaName}${settings.env.toUpperCase()}`,
      version: lambdaFunction.currentVersion,
    }
  );

  // Example: Lambda error alarm
  new cloudwatch.Alarm(stack, `${lambdaName}LambdaErrorAlarm`, {
    metric: lambdaFunction.metricErrors(),
    threshold: settings.lambdaAlarmThreshold,
    evaluationPeriods: settings.lambdaAlarmEvaluationPeriod,
    alarmDescription: "Alarm if the Lambda function encounters errors.",
    actionsEnabled: settings.lambdaAlarmActionsEnabled,
  });
  // Associate the log group with the Lambda function
  // logGroup.grantWrite(lambdaFunction);
  lambdaOutput(stack, lambdaName, lambdaFunction, lambdaAlias, repository);
  return {
    deadLetterQueue,
    lambdaFunction,
    lambdaAlias,
  };
}

export function lambdaOutput(
  stack: Stack,
  name: string,
  lambdaFunction: lambda.DockerImageFunction,
  lambdaAlias: lambda.Alias,
  repository: ecr.Repository
) {
  new cdk.CfnOutput(stack, `${name}LambdaArn`, {
    value: lambdaFunction.functionArn,
    exportName: `${name}LambdaArn`,
  });
  if (lambdaAlias) {
    new cdk.CfnOutput(stack, `${name}LambdaAliasArn`, {
      value: lambdaAlias.functionArn,
      exportName: `${name}LambdaAliasArn`,
    });
    new cdk.CfnOutput(stack, `${name}Lambda`, {
      value: lambdaAlias.aliasName,
      exportName: `${name}Lambda`,
    });
  }
  new cdk.CfnOutput(stack, `${name}RepositoryArn`, {
    value: repository.repositoryArn,
    exportName: `${name}RepositoryArn`,
  });
}

export function getMetricConfig(
  stack: Stack,
  lambdaFunction: lambda.IFunction,
  deadLetterQueue: sqs.IQueue
) {
  const settings = new Settings(stack);
  return [
    {
      metric: lambdaFunction.metricErrors(),
      alarmProps: {
        threshold: settings.lambdaAlarmThreshold,
        evaluationPeriods: settings.lambdaAlarmEvaluationPeriod,
        alarmDescription: "Alarm if the Lambda function encounters errors.",
      },
    },
    {
      metric: lambdaFunction.metricDuration(),
      alarmProps: {
        threshold: settings.lambdaAlarmThreshold,
        evaluationPeriods: settings.lambdaAlarmEvaluationPeriod,
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
        threshold: settings.queueAlarmThreshold,
        evaluationPeriods: settings.queueAlarmEvaluationPeriod,
        alarmDescription:
          "Alarm if messages start to accumulate in the dead-letter queue.",
        actionsEnabled: settings.queueAlarmActionsEnabled,
      },
    },
  ];
}

export function createMetrics(
  stack: Stack,
  lambdaFunction: lambda.IFunction,
  deadLetterQueue: sqs.IQueue,
  lambdaName: string
) {
  const metricsConfig = getMetricConfig(stack, lambdaFunction, deadLetterQueue);

  return metricsConfig.map(({ metric, alarmProps }, index) => {
    let alarm: cloudwatch.Alarm | undefined;
    if (alarmProps) {
      const alarmName = `${lambdaName}-${metric.metricName}`;
      alarm = new cloudwatch.Alarm(stack, alarmName, {
        metric,
        threshold: alarmProps.threshold,
        evaluationPeriods: alarmProps.evaluationPeriods,
        alarmDescription: alarmProps.alarmDescription,
        actionsEnabled: alarmProps.actionsEnabled,
      });
    }

    return { metric, alarm };
  });
}
