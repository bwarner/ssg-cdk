import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as apigatewayv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
interface SsgLambdaGatewayProps {
  lambda: lambda.Function;
  lambdaAlias: lambda.Alias;
  relayLambda: lambda.Function;
  relayLambdaAlias: lambda.Alias;
}

export class SsgLambdaGateway extends cdk.Stack {
  httpApi: apigatewayv2.HttpApi;

  constructor(scope: Construct, id: string, props: SsgLambdaGatewayProps) {
    super(scope, id);

    this.httpApi = this.createHttpApiGateway("LambdaGateway");
    this.createHttpApiGatewayIntegration({
      name: "StripeHookIntegration",
      path: "/api/stripe-hook",
      lambdaFunction: props.lambda,
      httpApi: this.httpApi,
    });
    this.createHttpApiGatewayIntegration({
      name: "RelayIntegration",
      path: "/api/relay",
      lambdaFunction: props.relayLambda,
      httpApi: this.httpApi,
    });
  }

  createHttpApiGateway(name: string) {
    const httpApi = new apigatewayv2.HttpApi(this, `${name}HttpApi`, {
      apiName: name,
    });
    return httpApi;
  }

  createHttpApiGatewayIntegration({
    name,
    path,
    lambdaFunction,
    httpApi,
  }: {
    name: string;
    path: string;
    lambdaFunction: lambda.DockerImageFunction;
    httpApi: apigatewayv2.HttpApi;
  }) {
    const integration = new HttpLambdaIntegration(name, lambdaFunction);

    httpApi.addRoutes({
      path: path,
      methods: [apigatewayv2.HttpMethod.ANY],
      integration: integration,
    });

    new cdk.CfnOutput(this, `${name}ApiUrl`, {
      value: httpApi.apiEndpoint,
      exportName: `${name}ApiUrl`,
    });

    return {
      integration,
    };
  }
}
