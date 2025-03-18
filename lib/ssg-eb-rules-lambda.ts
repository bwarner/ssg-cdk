import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as iam from "aws-cdk-lib/aws-iam";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as sns from "aws-cdk-lib/aws-sns";
import { createMetrics, getMetricConfig, lambdaOutput } from "./utils";
import * as logs from "aws-cdk-lib/aws-logs";
import Settings from "./settings";

interface SsgEbRulesLambdaProps extends cdk.StackProps {
  repository: ecr.Repository;
  lambdaName: string;
  repositoryVersion: string;
}

export class SsgEbRulesLambdaStack extends cdk.Stack {
  lambdaFunction: lambda.DockerImageFunction;
  deadLetterQueue: sqs.IQueue;
  ebRuleTopic: sns.Topic;
  constructor(scope: Construct, id: string, props?: SsgEbRulesLambdaProps) {
    super(scope, id, props);

    const settings = new Settings(this);

    if (!props?.repository) {
      throw new Error("repository is required");
    }
    if (!props?.repositoryVersion) {
      throw new Error("stripeHookVersion is required");
    }

    // this.stripeDestinationUrl = props.stripeDestinationUrl;
    // const { lambdaFunction, deadLetterQueue } = createLambdaFunction({
    //   stack: this,
    //   lambdaName: props.lambdaName,
    //   repositoryVersion: props.repositoryVersion,
    //   repository: props.repository,
    // });

    // SNS Topic
    const ebRuleTopic = new sns.Topic(this, `EventBridgeRuleTopic`, {
      topicName: `EventBridgeRuleTopic`,
      displayName: `EventBridge Rule Topic`,
    });

    const deadLetterQueue = new sqs.Queue(
      this,
      `EventBridgeRuleHandlerLambdaDeadLetterQueue`,
      {
        queueName: `EventBridgeRuleHandlerLambdaDeadLetterQueue`,
        receiveMessageWaitTime: cdk.Duration.seconds(20),
        retentionPeriod: settings.queueRetentionPeriod,
        removalPolicy: settings.removalPolicy,
      }
    );

    const logGroup = new logs.LogGroup(this, `EventBridgeRuleHandlerLogGroup`, {
      logGroupName: `/aws/lambda/EventBridgeRuleHandler`,
      retention: settings.logRetentionPeriod,
      removalPolicy: settings.removalPolicy,
    });

    const executionRole = new iam.Role(
      this,
      "EventBridgeRuleHandlerExecutionRole",
      {
        assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
        roleName: "EventBridgeRuleHandlerExecutionRole",
        description: `EventBridgeRuleHandler Execution Role`,
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
        sid: `AllowEventBridgeRuleHandlerToAccessSSM`,
        effect: iam.Effect.ALLOW,
        actions: ["ssm:GetParameter"],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter/ssg/*`,
        ],
      })
    );

    // Allow the EventBridge Rules Lambda to publish to the EventBridge Topic
    executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: `Allow${props.lambdaName}ToSendToTopic`,
        effect: iam.Effect.ALLOW,
        actions: ["sns:Publish"],
        resources: [ebRuleTopic.topicArn],
      })
    );
    const { repository, repositoryVersion, lambdaName } = props;
    const lambdaFunction = new lambda.DockerImageFunction(this, lambdaName, {
      code: lambda.DockerImageCode.fromEcr(repository, {
        tagOrDigest: repositoryVersion ?? "latest",
      }),
      environment: {
        TOPIC_ARN: ebRuleTopic.topicArn,
      },
      functionName: lambdaName,
      memorySize: settings.lambdaMemorySize,
      timeout: settings.lambdaTimeout,
      role: executionRole,
      description: `EventBridgeRuleHandler Lambda Function`,
      deadLetterQueue: deadLetterQueue,
      logGroup: logGroup,
    });

    // Example: Lambda error alarm
    new cloudwatch.Alarm(this, `EventBridgeRuleHandlerLambdaErrorAlarm`, {
      metric: lambdaFunction.metricErrors(),
      threshold: settings.lambdaAlarmThreshold,
      evaluationPeriods: settings.lambdaAlarmEvaluationPeriod,
      alarmDescription: "Alarm if the Lambda function encounters errors.",
      actionsEnabled: settings.lambdaAlarmActionsEnabled,
    });

    lambdaOutput(this, lambdaName, lambdaFunction, null, repository);

    this.deadLetterQueue = deadLetterQueue;
    this.lambdaFunction = lambdaFunction;
    this.ebRuleTopic = ebRuleTopic;
    createMetrics(this, this.lambdaFunction, this.deadLetterQueue, lambdaName);
  }
}
