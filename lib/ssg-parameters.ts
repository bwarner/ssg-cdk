import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ssm from "aws-cdk-lib/aws-ssm";

interface ParametersStackProps extends cdk.StackProps {
  stripeTopicArn: string;
  // stripeQueueUrl: string;
}

export class ParametersStack extends cdk.Stack {
  stripeDestinationUrl: ssm.StringParameter;
  stripeTopicArnParam: ssm.StringParameter;
  frontendDomainNameParam: ssm.StringParameter;

  constructor(scope: Construct, id: string, props?: ParametersStackProps) {
    super(scope, id, props);

    if (!props?.stripeTopicArn) {
      throw new Error("Topic ARN is required");
    }

    const environment = process.env.ENVIRONMENT || "dev";

    this.stripeTopicArnParam = new ssm.StringParameter(this, "StripeTopicArn", {
      parameterName: `/ssg/${environment}/stripe-topic-arn`,
      stringValue: props.stripeTopicArn,
      description: "Stripe topic ARN",
      tier: ssm.ParameterTier.STANDARD,
      dataType: ssm.ParameterDataType.TEXT,
    });

    this.stripeDestinationUrl = new ssm.StringParameter(
      this,
      "StripeDestinationUrl",
      {
        parameterName: `/ssg/${environment}/stripe-destination-url`,
        stringValue: process.env.STRIPE_DESTINATION_URL || "",
        description: "Location of the Stripe webhook destination",
        tier: ssm.ParameterTier.STANDARD,
        dataType: ssm.ParameterDataType.TEXT,
      }
    );

    this.frontendDomainNameParam = new ssm.StringParameter(
      this,
      "FrontendDomainName",
      {
        parameterName: `/ssg/${environment}/frontend-domain-name`,
        stringValue: process.env.FRONTEND_DOMAIN_NAME || "",
        description: "Domain name of the frontend",
        tier: ssm.ParameterTier.STANDARD,
        dataType: ssm.ParameterDataType.TEXT,
      }
    );

    new cdk.CfnOutput(this, "StripeTopicArn-output", {
      value: this.stripeTopicArnParam.parameterName,
      exportName: "StripeTopicArn",
    });

    new cdk.CfnOutput(this, "StripeDestinationUrl-output", {
      value: this.stripeDestinationUrl.parameterName,
      exportName: "StripeDestinationUrl",
    });

    new cdk.CfnOutput(this, "FrontendDomainName-output", {
      value: this.frontendDomainNameParam.parameterName,
      exportName: "FrontendDomainName",
    });
  }
}
