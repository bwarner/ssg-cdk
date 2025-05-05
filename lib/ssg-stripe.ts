import * as cdk from "aws-cdk-lib";
import * as sns from "aws-cdk-lib/aws-sns";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import { SsgStripeTopicStack } from "./ssg-stripe-topic";
import { SsgStripeQueueStack } from "./ssg-stripe-queue";
import { SsgStripeHookStack } from "./ssg-stripe-hook-lambda";
import { SsgRelayLambdaStack } from "./ssg-relay-lambda";
import { SsgLambdaGateway } from "./ssg-lambda-gateway";
import { ParametersStack } from "./ssg-parameters";
import { SsgSecretsStack } from "./ssg-secrets";
import { BATCH_SIZE } from "./const";
import { MAX_BATCHING_WINDOW } from "./const";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { MAX_CONCURRENCY } from "./const";
import Settings from "./settings";
interface SsgStripeStackProps extends cdk.StackProps {
  stripeHookRepository: ecr.Repository;
  relayRepository: ecr.Repository;
  stripeHookLambdaVersion: string;
  relayLambdaVersion: string;
  secrets: SsgSecretsStack;
  parameters: ParametersStack;
}

export class SsgStripeStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: SsgStripeStackProps) {
    super(scope, id, props);
    if (!props) {
      throw new Error("props is required");
    }

    const settings = new Settings(this);
    const parameters = props.parameters;
    const stripeTopic = new SsgStripeTopicStack(this, "SsgStripeTopicStack", {
      topicName: "StripeTopic",
    });

    const stripeQueue = new SsgStripeQueueStack(this, "SsgStripeQueueStack", {
      queueName: "StripeQueue",
      sourceTopic: stripeTopic.topic,
    });

    const stripeHook = new SsgStripeHookStack(this, "SsgStripeLambdaStack", {
      repository: props.stripeHookRepository,
      topic: stripeTopic.topic,
      lambdaName: "StripeHook",
      repositoryVersion: props.stripeHookLambdaVersion,
      ssgSecret: props.secrets.ssgSecret,
      stripeTopicArnParam: parameters.stripeTopicArnParam,
    });

    const relayLambda = new SsgRelayLambdaStack(this, "SsgRelayLambdaStack", {
      repository: props.relayRepository,
      lambdaName: "StripeRelay",
      repositoryVersion: props.relayLambdaVersion,
      environment: {
        DESTINATION_URL: settings.schedulerDestinationUrl,
      },
    });

    relayLambda.lambdaAlias.addPermission(
      "AllowStripeQueueToInvokeLambdaAlias",
      {
        action: "lambda:InvokeFunction",
        principal: new iam.ServicePrincipal("sqs.amazonaws.com"),
        sourceArn: stripeQueue.queue.queueArn,
      }
    );

    stripeQueue.queue.grantConsumeMessages(relayLambda.lambdaFunction);

    relayLambda.lambdaAlias.addEventSource(
      new SqsEventSource(stripeQueue.queue, {
        batchSize: BATCH_SIZE,
        maxConcurrency: MAX_CONCURRENCY,
        maxBatchingWindow: MAX_BATCHING_WINDOW,
        reportBatchItemFailures: true,
      })
    );

    new SsgLambdaGateway(this, "SsgLambdaGateway", {
      lambda: stripeHook.lambdaFunction,
      lambdaAlias: stripeHook.lambdaAlias,
      relayLambda: relayLambda.lambdaFunction,
      relayLambdaAlias: relayLambda.lambdaAlias,
    });
  }
}
