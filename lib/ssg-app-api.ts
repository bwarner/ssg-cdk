import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as apigatewayv2 from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as apigwv2_authorizers from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as route53Targets from "aws-cdk-lib/aws-route53-targets";
import { createLambdaFunction } from "./utils";

interface SsgAppApiProps extends cdk.StackProps {
  name: string;
  jobApiRepository: ecr.Repository;
  authorizerLambdaAlias: lambda.Alias;
  domainName?: string;
  hostedZone?: route53.IHostedZone;
  certificate?: acm.ICertificate;
}

export default class SsgAppApi extends cdk.Stack {
  public readonly apiUrl: string;
  private customDomain?: apigatewayv2.DomainName;

  constructor(scope: Construct, id: string, props: SsgAppApiProps) {
    super(scope, id, props);

    const { name, domainName, hostedZone, certificate } = props;

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

    // Create HTTP API Gateway with optional custom domain
    const { httpApi, customDomain } = this.createHttpApiGateway(name, domainName, certificate);
    this.customDomain = customDomain;

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

    // Set API URL based on custom domain or default endpoint
    if (domainName && this.customDomain) {
      this.apiUrl = `https://${domainName}`;

      // Create Route53 A record for custom domain if hosted zone is provided
      if (hostedZone) {
        new route53.ARecord(this, `${name}AliasRecord`, {
          zone: hostedZone,
          recordName: domainName.split('.')[0], // Extract subdomain part (e.g., "api" or "staging-api")
          target: route53.RecordTarget.fromAlias(
            new route53Targets.ApiGatewayv2DomainProperties(
              this.customDomain.regionalDomainName,
              this.customDomain.regionalHostedZoneId
            )
          ),
        });
      }
    } else {
      this.apiUrl = httpApi.apiEndpoint;
    }

    // Output the API URL
    new cdk.CfnOutput(this, `${name}ApiUrl`, {
      value: this.apiUrl,
      exportName: `${name}ApiUrl`,
      description: `API Gateway endpoint URL (${domainName || 'default'})`,
    });
  }

  private createHttpApiGateway(
    name: string,
    domainName?: string,
    certificate?: acm.ICertificate
  ): { httpApi: apigatewayv2.HttpApi; customDomain?: apigatewayv2.DomainName } {
    // Build API configuration with optional custom domain
    const apiConfig: apigatewayv2.HttpApiProps = {
      apiName: name,
      corsPreflight: {
        allowHeaders: ["*"],
        allowMethods: [apigatewayv2.CorsHttpMethod.ANY],
        allowOrigins: ["*"],
      },
    };

    // Add custom domain if provided
    if (domainName && certificate) {
      const customDomain = new apigatewayv2.DomainName(this, `${name}DomainName`, {
        domainName: domainName,
        certificate: certificate,
      });

      const httpApi = new apigatewayv2.HttpApi(this, `${name}HttpApi`, {
        ...apiConfig,
        defaultDomainMapping: {
          domainName: customDomain,
        },
      });

      return { httpApi, customDomain };
    }

    const httpApi = new apigatewayv2.HttpApi(this, `${name}HttpApi`, apiConfig);
    return { httpApi };
  }
}
