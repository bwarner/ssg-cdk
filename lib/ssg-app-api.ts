import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as apigatewayv2 from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as apigwv2_authorizers from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { createLambdaFunction } from "./utils";
import Settings from "./settings";

interface SsgAppApiProps extends cdk.StackProps {
  name: string;
  jobApiRepository: ecr.Repository;
  authorizerLambdaAlias: lambda.Alias;
}

export default class SsgAppApi extends cdk.Stack {
  constructor(scope: Construct, id: string, props: SsgAppApiProps) {
    super(scope, id, props);

    const settings = new Settings(this);
    const { name } = props;

    if (!process.env.JOB_API_LAMBDA_VERSION) {
      throw new Error(
        "Missing required environment variable JOB_API_LAMBDA_VERSION"
      );
    }

    const jobApiRepositoryVersion = process.env.JOB_API_LAMBDA_VERSION;

    // Create the Lambda from ECR and get the alias
    const { lambdaAlias } = createLambdaFunction({
      stack: this,
      lambdaName: name,
      repositoryVersion: jobApiRepositoryVersion,
      repository: props.jobApiRepository,
    });

    // Create HTTP API Gateway
    const httpApi = this.createHttpApiGateway(name);

    // ✅ Correct Lambda authorizer for HTTP API using SIMPLE response
    const httpAuthorizer = new apigwv2_authorizers.HttpLambdaAuthorizer(
      `${name}LambdaAuthorizer`,
      props.authorizerLambdaAlias,
      {
        responseTypes: [apigwv2_authorizers.HttpLambdaResponseType.SIMPLE],
        identitySource: ["$request.header.Authorization"],
      }
    );

    // Lambda integration for your service
    const integration = new HttpLambdaIntegration(name, lambdaAlias);

    // Route definitions
    const paths = [
      {
        path: "/api/job",
        methods: [apigatewayv2.HttpMethod.GET, apigatewayv2.HttpMethod.POST],
      },
      {
        path: "/api/job/{id}",
        methods: [
          apigatewayv2.HttpMethod.GET,
          apigatewayv2.HttpMethod.PUT,
          apigatewayv2.HttpMethod.DELETE,
        ],
      },
      {
        path: "/api/schedule",
        methods: [apigatewayv2.HttpMethod.GET, apigatewayv2.HttpMethod.POST],
      },
      {
        path: "/api/schedule/{id}",
        methods: [
          apigatewayv2.HttpMethod.GET,
          apigatewayv2.HttpMethod.PUT,
          apigatewayv2.HttpMethod.DELETE,
        ],
      },
    ];

    // Add routes to HTTP API
    for (const route of paths) {
      httpApi.addRoutes({
        path: route.path,
        methods: route.methods,
        integration: integration,
        authorizer: httpAuthorizer,
      });
    }

    // Output the HTTP API endpoint
    new cdk.CfnOutput(this, `${name}ApiUrl`, {
      value: httpApi.apiEndpoint,
      exportName: `${name}ApiUrl`,
    });
  }

  private createHttpApiGateway(name: string) {
    return new apigatewayv2.HttpApi(this, `${name}HttpApi`, {
      apiName: name,
      corsPreflight: {
        allowHeaders: ["*"],
        allowMethods: [apigatewayv2.CorsHttpMethod.ANY],
        allowOrigins: ["*"],
      },
    });
  }
}
