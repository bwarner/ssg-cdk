import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ssm from "aws-cdk-lib/aws-ssm";
import { StackProps } from "aws-cdk-lib";
export class ParametersStack extends cdk.Stack {
  stripeDestinationUrl: ssm.StringParameter;
  stripeTopicArnParam: ssm.StringParameter;
  frontendDomainNameParam: ssm.StringParameter;
  schedulerDestinationUrl: ssm.StringParameter;
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const environment = process.env.ENVIRONMENT || "dev";

    this.stripeDestinationUrl = this.defineParameter({
      name: "StripeDestinationUrl",
      parameterName: "stripe-destination-url",
      value: process.env.STRIPE_DESTINATION_URL || "",
      description: "Location of the Stripe webhook destination",
      tier: ssm.ParameterTier.STANDARD,
      dataType: ssm.ParameterDataType.TEXT,
      exportName: "StripeDestinationUrl",
    });

    this.schedulerDestinationUrl = this.defineParameter({
      name: "SchedulerDestinationUrl",
      parameterName: "scheduler-destination-url",
      value: process.env.SCHEDULER_DESTINATION_URL || "",
      description: "Location of the scheduler destination",
      exportName: "SchedulerDestinationUrl",
    });

    this.frontendDomainNameParam = this.defineParameter({
      name: "FrontendDomainName",
      parameterName: "frontend-domain-name",
      value: process.env.FRONTEND_DOMAIN_NAME || "",
      description: "Domain name of the frontend",
      tier: ssm.ParameterTier.STANDARD,
      dataType: ssm.ParameterDataType.TEXT,
      exportName: "FrontendDomainName",
    });
  }

  private defineParameter(params: {
    name: string;
    parameterName: string;
    value: string;
    description: string;
    tier?: ssm.ParameterTier;
    dataType?: ssm.ParameterDataType;
    environment?: string;
    exportName: string;
  }) {
    const {
      name,
      value,
      description,
      tier = ssm.ParameterTier.STANDARD,
      dataType = ssm.ParameterDataType.TEXT,
      environment,
      exportName,
      parameterName,
    } = params;

    const parameter = new ssm.StringParameter(this, name, {
      parameterName: `/ssg/${environment}/${parameterName}`,
      stringValue: value,
      description: description,
      tier: tier,
      dataType,
    });
    new cdk.CfnOutput(this, `${exportName}-output`, {
      value: parameter.parameterName,
      exportName: exportName,
    });
    return parameter;
  }
}
