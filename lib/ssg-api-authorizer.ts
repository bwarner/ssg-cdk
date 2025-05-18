import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { createLambdaFunction } from "./utils";

interface SsgApiAuthorizerProps extends cdk.StackProps {
  name: string;
  authorizerRepository: ecr.Repository;
}

export default class SsgApiAuthorizer extends cdk.Stack {
  public readonly lambdaFunction: lambda.DockerImageFunction;
  public readonly lambdaAlias: lambda.Alias;

  constructor(scope: Construct, id: string, props: SsgApiAuthorizerProps) {
    super(scope, id, props);

    if (!process.env.AUTHORIZER_LAMBDA_VERSION) {
      throw new Error(
        "Missing required environment variable AUTHORIZER_LAMBDA_VERSION"
      );
    }
    const authorizerRepositoryVersion = process.env.AUTHORIZER_LAMBDA_VERSION;

    // Export the repository ARN as a CloudFormation output
    const { name } = props;

    const policy = new iam.PolicyStatement({
      sid: `Allow${name}ToAccessSecretsManager`,
      effect: iam.Effect.ALLOW,
      actions: ["secretsmanager:GetSecretValue"],
      resources: [
        `arn:aws:secretsmanager:${this.region}:${this.account}:secret:ssg-auth0-secrets-zk3SCz`,
      ],
    });

    const lambdaName = `${name}`;
    const { lambdaFunction, lambdaAlias } = createLambdaFunction({
      stack: this,
      lambdaName,
      repositoryVersion: authorizerRepositoryVersion,
      repository: props.authorizerRepository,
      policies: [policy],
      environment: {
        AUTH0_SECRET_ID: "ssg-auth0-secrets",
      },
    });

    this.lambdaFunction = lambdaFunction;
    this.lambdaAlias = lambdaAlias;
  }
}
