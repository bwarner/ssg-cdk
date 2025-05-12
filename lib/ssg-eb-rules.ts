import { Stack, StackProps } from "aws-cdk-lib";
import { Rule } from "aws-cdk-lib/aws-events";
import { Construct } from "constructs";
import { Alias, Function } from "aws-cdk-lib/aws-lambda";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as cdk from "aws-cdk-lib";
import * as sqs from "aws-cdk-lib/aws-sqs";
import Settings from "./settings";
import * as sns_subscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import * as sns from "aws-cdk-lib/aws-sns";
import * as ecr from "aws-cdk-lib/aws-ecr";
import { createLambdaFunction } from "./utils";
interface SsgEbRulesStackProps extends StackProps {
  relayLambdaRepository: ecr.Repository;
  ebRulesLambdaRepository: ecr.Repository;
}

export class SsgEbRulesStack extends Stack {
  settings: Settings;
  ebRuleTopic: sns.Topic;
  ebRuleQueue: sqs.Queue;
  ebRulesLambdaAlias: Alias;
  constructor(scope: Construct, id: string, props: SsgEbRulesStackProps) {
    super(scope, id, props);

    this.settings = new Settings(this);

    // SNS Topic
    this.ebRuleTopic = new sns.Topic(this, `EventBridgeRuleTopic`, {
      topicName: `EventBridgeRuleTopic`,
      displayName: `EventBridge Rule Topic`,
    });

    const relayLambdaVersion = process.env.RELAY_LAMBDA_VERSION;
    if (!relayLambdaVersion) {
      throw new Error("Missing required relayLambdaVersion prop");
    }
    const relayLambdaName = "EBRelay";

    const queueName = "EbRulesQueue";
    const queueNameDLQ = `${queueName}DLQ`;
    // Dead Letter Queue
    const queueDLQ = new sqs.Queue(this, queueNameDLQ, {
      queueName: queueNameDLQ,
      visibilityTimeout: cdk.Duration.seconds(
        this.settings.deadLetterQueueVisibilityTimeout
      ),
      removalPolicy: this.settings.removalPolicy,
    });

    // Main Queue with Dead Letter Queue
    const queue = new sqs.Queue(this, queueName, {
      queueName,
      visibilityTimeout: cdk.Duration.seconds(this.settings.visibilityTimeout),
      removalPolicy: this.settings.removalPolicy,
      deadLetterQueue: {
        maxReceiveCount: this.settings.deadLetterQueueMaxReceiveCount,
        queue: queueDLQ,
      },
    });

    // Developer Queue for handling scheduling commands
    const devQueue = new sqs.Queue(this, `${queueName}DevQueue`, {
      queueName: `${queueName}DevQueue`,
      visibilityTimeout: cdk.Duration.seconds(this.settings.visibilityTimeout),
      removalPolicy: this.settings.removalPolicy,
    });

    // Output Queue URLs
    new cdk.CfnOutput(this, `${queueName}QueueUrl`, {
      value: queue.queueUrl,
      exportName: `${queueName}QueueUrl`,
    });

    new cdk.CfnOutput(this, `${queueName}DevQueueUrl`, {
      value: devQueue.queueUrl,
      exportName: `${queueName}DevQueueUrl`,
    });

    new cdk.CfnOutput(this, `${queueName}DLQUrl`, {
      value: queueDLQ.queueUrl,
      exportName: `${queueName}DLQUrl`,
    });

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

    // queues subscribes to topic
    this.ebRuleTopic.addSubscription(
      new sns_subscriptions.SqsSubscription(queue)
    );
    this.ebRuleTopic.addSubscription(
      new sns_subscriptions.SqsSubscription(devQueue)
    );

    this.ebRuleQueue = queue;
    this.ebRuleQueue.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: "AllowSNSDelivery",
        effect: iam.Effect.ALLOW,
        principals: [new iam.ServicePrincipal("sns.amazonaws.com")],
        actions: ["sqs:SendMessage"],
        resources: [queue.queueArn],
        conditions: {
          ArnEquals: {
            "aws:SourceArn": this.ebRuleTopic.topicArn,
          },
          StringEquals: {
            "aws:SourceAccount": this.account,
          },
        },
      })
    );

    // // Allow the EventBridge Rules Lambda to publish to the EventBridge Topic
    // lambdaFunction.addToRolePolicy(
    //   new iam.PolicyStatement({
    //     sid: `Allow ${lambdaFunction.functionName} to send messages to ${ebRulesTopicQueueCombo.topic.topicName}`,
    //     actions: ["sns:Publish"],
    //     resources: [ebRulesTopicQueueCombo.topic.topicArn],
    //   })
    // );

    // Add the EventBridge Rules Queue as an event source for the Relay Lambda function
    lambdaAlias.addEventSourceMapping("RelayLambdaEventSource", {
      eventSourceArn: queue.queueArn,
      batchSize: 1, // Number of messages to process at a time
    });

    // Grant the Lambda function permissions to read from the Job Command Queue
    queue.grantConsumeMessages(lambdaAlias);

    const batchJobStateChangeRule = new Rule(
      this,
      `${id}-BatchJobStateChangeRule`,
      {
        eventPattern: {
          source: ["aws.batch"],
          detailType: ["AWS Batch Job State Change"],
        },
        description: "Trigger Lambda for batch job state changes",
      }
    );

    const scheduledBatchEventRule = new Rule(
      this,
      `${id}-ScheduledBatchEventRule`,
      {
        eventPattern: {
          source: ["aws.scheduler"],
          detailType: ["Scheduled Event"],
        },
        description: "Trigger Lambda for scheduled batch jobs",
      }
    );

    // Add targets to the rules separately
    batchJobStateChangeRule.addTarget(new targets.LambdaFunction(lambdaAlias));
    scheduledBatchEventRule.addTarget(new targets.LambdaFunction(lambdaAlias));

    lambdaAlias.addPermission("BatchJobStateChangeRuleInvoke", {
      principal: new iam.ServicePrincipal("events.amazonaws.com"),
      sourceArn: batchJobStateChangeRule.ruleArn,
    });

    lambdaAlias.addPermission("ScheduledBatchEventRuleInvoke", {
      principal: new iam.ServicePrincipal("events.amazonaws.com"),
      sourceArn: scheduledBatchEventRule.ruleArn,
    });
  }
}
