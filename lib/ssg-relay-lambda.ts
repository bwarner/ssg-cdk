import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as iam from "aws-cdk-lib/aws-iam";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as ssm from "aws-cdk-lib/aws-ssm";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { createLambdaFunction, createMetrics } from "./utils";
interface SsgRelayLambdaProps extends cdk.StackProps {
  repository: ecr.Repository;
  lambdaName: string;
  repositoryVersion: string;
  policies?: iam.PolicyStatement[];
  environment?: Record<string, string>;
}

export class SsgRelayLambdaStack extends cdk.Stack {
  lambdaFunction: lambda.DockerImageFunction;
  lambdaAlias: lambda.Alias;
  deadLetterQueue: sqs.IQueue;
  constructor(scope: Construct, id: string, props?: SsgRelayLambdaProps) {
    super(scope, id, props);

    if (!props?.repository) {
      throw new Error("repository is required");
    }
    if (!props?.repositoryVersion) {
      throw new Error("stripeHookVersion is required");
    }

    // this.stripeDestinationUrl = props.stripeDestinationUrl;
    const { lambdaFunction, deadLetterQueue } = createLambdaFunction({
      stack: this,
      lambdaName: props.lambdaName,
      repositoryVersion: props.repositoryVersion,
      repository: props.repository,
      policies: props.policies,
      environment: props.environment,
    });

    const lambdaAlias = new lambda.Alias(this, `${props.lambdaName}Alias`, {
      aliasName: props.lambdaName,
      version: lambdaFunction.currentVersion,
    });
    this.deadLetterQueue = deadLetterQueue;
    this.lambdaFunction = lambdaFunction;
    this.lambdaAlias = lambdaAlias;
    createMetrics(this, lambdaFunction, props.lambdaName, deadLetterQueue);
  }
}
