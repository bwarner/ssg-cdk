import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as iam from "aws-cdk-lib/aws-iam";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as sns from "aws-cdk-lib/aws-sns";
import { createLambdaFunction, createMetrics, lambdaOutput } from "./utils";
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
  lambdaAlias: lambda.Alias;
  constructor(scope: Construct, id: string, props?: SsgEbRulesLambdaProps) {
    super(scope, id, props);

    const settings = new Settings(this);

    if (!props?.repository) {
      throw new Error("repository is required");
    }
    if (!props?.repositoryVersion) {
      throw new Error("repositoryVersion is required");
    }

    // SNS Topic
    const ebRuleTopic = new sns.Topic(this, `EventBridgeRuleTopic`, {
      topicName: `EventBridgeRuleTopic`,
      displayName: `EventBridge Rule Topic`,
    });

    const { repository, repositoryVersion, lambdaName } = props;

    const { lambdaFunction, deadLetterQueue, lambdaAlias } =
      createLambdaFunction({
        stack: this,
        lambdaName,
        repositoryVersion,
        repository,
        policies: [
          new iam.PolicyStatement({
            sid: `AllowEventBridgeRuleHandlerToAccessSSM`,
            effect: iam.Effect.ALLOW,
            actions: ["ssm:GetParameter"],
            resources: [
              `arn:aws:ssm:${this.region}:${this.account}:parameter/ssg/*`,
            ],
          }),
          // Allow the EventBridge Rules Lambda to publish to the EventBridge Topic
          new iam.PolicyStatement({
            sid: `Allow${props.lambdaName}ToSendToTopic`,
            effect: iam.Effect.ALLOW,
            actions: ["sns:Publish"],
            resources: [ebRuleTopic.topicArn],
          }),
        ],
      });

    this.deadLetterQueue = deadLetterQueue;
    this.lambdaFunction = lambdaFunction;
    this.ebRuleTopic = ebRuleTopic;
    createMetrics(this, this.lambdaFunction, lambdaName, this.deadLetterQueue);
  }
}
