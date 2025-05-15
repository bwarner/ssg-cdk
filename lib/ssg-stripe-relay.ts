import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as iam from "aws-cdk-lib/aws-iam";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as ssm from "aws-cdk-lib/aws-ssm";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { createLambdaFunction, createMetrics } from "./utils";
import { DLQ_RETENTION_DAYS, LOG_RETENTION_DAYS } from "./const";
interface SsgRelayLambdaProps extends cdk.StackProps {
  repository: ecr.Repository;
  lambdaName: string;
  repositoryVersion: string;
  stripeDestinationUrl: ssm.StringParameter;
  stripeQueue: sqs.Queue;
}

const MAX_CONCURRENCY = 2;
const BATCH_SIZE = 1;
const MAX_BATCHING_WINDOW = cdk.Duration.seconds(10);

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
    if (!props?.stripeQueue) {
      throw new Error("stripeQueue is required");
    }
    // this.stripeDestinationUrl = props.stripeDestinationUrl;
    const { lambdaFunction, deadLetterQueue } = createLambdaFunction({
      stack: this,
      lambdaName: props.lambdaName,
      repositoryVersion: props.repositoryVersion,
      repository: props.repository,
    });

    const lambdaAlias = new lambda.Alias(this, `${props.lambdaName}Alias`, {
      aliasName: `${props.lambdaName}Alias`,
      version: lambdaFunction.currentVersion,
    });

    this.deadLetterQueue = deadLetterQueue;
    this.lambdaAlias = lambdaAlias;
    this.lambdaFunction = lambdaFunction;

    // lambdaFunction.addPermission("AllowStripeQueueToInvokeLambda", {
    //   action: "lambda:InvokeFunction",
    //   principal: new iam.ServicePrincipal("sqs.amazonaws.com"),
    //   sourceArn: props.stripeQueue.queueArn,
    // });

    lambdaAlias.addPermission("AllowStripeQueueToInvokeLambdaAlias", {
      action: "lambda:InvokeFunction",
      principal: new iam.ServicePrincipal("sqs.amazonaws.com"),
      sourceArn: props.stripeQueue.queueArn,
    });

    props.stripeQueue.grantConsumeMessages(lambdaFunction);

    lambdaAlias.addEventSource(
      new SqsEventSource(props.stripeQueue, {
        batchSize: BATCH_SIZE,
        maxConcurrency: MAX_CONCURRENCY,
        maxBatchingWindow: MAX_BATCHING_WINDOW,
        reportBatchItemFailures: true,
      })
    );

    createMetrics(
      this,
      this.lambdaFunction,
      props.lambdaName,
      this.deadLetterQueue
    );
  }
}
