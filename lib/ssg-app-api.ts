import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as apigatewayv2 from "aws-cdk-lib/aws-apigatewayv2";
import { createLambdaFunction } from "./utils";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import Settings from "./settings";

interface SsgAppApiProps extends cdk.StackProps {
  name: string;
  jobApiRepository: ecr.Repository;
}

export default class SsgAppApi extends cdk.Stack {
  constructor(scope: Construct, id: string, props: SsgAppApiProps) {
    super(scope, id, props);

    const settings = new Settings(this);

    if (!process.env.JOB_API_LAMBDA_VERSION) {
      throw new Error(
        "Missing required environment variable JOB_API_LAMBDA_VERSION"
      );
    }
    const jobApiRepositoryVersion = process.env.JOB_API_LAMBDA_VERSION;

    // Export the repository ARN as a CloudFormation output
    const { name } = props;

    const lambdaName = `${name}`;
    const { lambdaAlias } = createLambdaFunction({
      stack: this,
      lambdaName,
      repositoryVersion: jobApiRepositoryVersion,
      repository: props.jobApiRepository,
    });

    const httpApi = this.createHttpApiGateway(name);

    const integration = new HttpLambdaIntegration(name, lambdaAlias);

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
    paths.forEach((path) => {
      httpApi.addRoutes({
        path: path.path,
        methods: path.methods,
        integration: integration,
      });
    });

    new cdk.CfnOutput(this, `${name}ApiUrl`, {
      value: httpApi.apiEndpoint,
      exportName: `${name}ApiUrl`,
    });
  }

  createHttpApiGateway(name: string) {
    const httpApi = new apigatewayv2.HttpApi(this, `${name}HttpApi`, {
      apiName: name,
      corsPreflight: {
        allowHeaders: ["*"],
        allowMethods: [apigatewayv2.CorsHttpMethod.ANY],
        allowOrigins: ["*"],
      },
    });
    return httpApi;
  }
}
