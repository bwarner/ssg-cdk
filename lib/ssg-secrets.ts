import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";

export class SsgSecretsStack extends cdk.Stack {
  ssgSecret: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.ssgSecret = new secretsmanager.Secret(this, "SSG Secret", {
      secretName: "ssgSecret",
      secretObjectValue: {
        stripeDestinationUrl: cdk.SecretValue.unsafePlainText(
          "PLACEHOLDER_STRIPE_DESTINATION_URL"
        ),
        stripeTopicArn: cdk.SecretValue.unsafePlainText(
          "PLACEHOLDER_STRIPE_TOPIC_ARN"
        ),
        couchbaseUsername: cdk.SecretValue.unsafePlainText(
          "PLACEHOLDER_USERNAME"
        ),
        couchbasePassword: cdk.SecretValue.unsafePlainText(
          "PLACEHOLDER_PASSWORD"
        ),
        couchbaseConnectionString: cdk.SecretValue.unsafePlainText(
          "PLACEHOLDER_CONNECTION_STRING"
        ),
        couchbaseBucket: cdk.SecretValue.unsafePlainText("PLACEHOLDER_BUCKET"),
        couchbaseGlobalScope:
          cdk.SecretValue.unsafePlainText("PLACEHOLDER_SCOPE"),
        auth0BaseUrl: cdk.SecretValue.unsafePlainText("PLACEHOLDER_BASE_URL"),
        stripeSecretKey: cdk.SecretValue.unsafePlainText(
          "PLACEHOLDER_STRIPE_SECRET_KEY"
        ),
        stripeWebhookSecret: cdk.SecretValue.unsafePlainText(
          "PLACEHOLDER_STRIPE_WEBHOOK_SECRET"
        ),
        stripeCollectionId: cdk.SecretValue.unsafePlainText(
          "PLACEHOLDER_STRIPE_COLLECTION_NAME"
        ),
        stripeScopeName: cdk.SecretValue.unsafePlainText(
          "PLACEHOLDER_STRIPE_SCOPE_NAME"
        ),
        stripeMvsProductId: cdk.SecretValue.unsafePlainText(
          "PLACEHOLDER_STRIPE_MVS_PRODUCT_ID"
        ),
        stripePublishableKey: cdk.SecretValue.unsafePlainText(
          "PLACEHOLDER_STRIPE_PUBLISHABLE_KEY"
        ),
        auth0IssuerBaseUrl: cdk.SecretValue.unsafePlainText(
          "PLACEHOLDER_ISSUER_BASE_URL"
        ),
        auth0ClientId: cdk.SecretValue.unsafePlainText("PLACEHOLDER_CLIENT_ID"),
        auth0ClientSecret: cdk.SecretValue.unsafePlainText(
          "PLACEHOLDER_CLIENT_SECRET"
        ),
        auth0Audience: cdk.SecretValue.unsafePlainText("PLACEHOLDER_AUDIENCE"),
        auth0Domain: cdk.SecretValue.unsafePlainText("PLACEHOLDER_DOMAIN"),
        auth0CallbackUrl: cdk.SecretValue.unsafePlainText(
          "PLACEHOLDER_CALLBACK_URL"
        ),
        auth0ManagementApiAudience: cdk.SecretValue.unsafePlainText(
          "PLACEHOLDER_MANAGEMENT_API_AUDIENCE"
        ),
        auth0ManagementApiClientId: cdk.SecretValue.unsafePlainText(
          "PLACEHOLDER_MANAGEMENT_API_CLIENT_ID"
        ),
        auth0ManagementApiClientSecret: cdk.SecretValue.unsafePlainText(
          "PLACEHOLDER_MANAGEMENT_API_CLIENT_SECRET"
        ),
        auth0ManagementDomain: cdk.SecretValue.unsafePlainText(
          "PLACEHOLDER_MANAGEMENT_DOMAIN"
        ),
      },
      description: "The secrets used for SSG",
    });

    new cdk.CfnOutput(this, "SsgSecretArn", {
      value: this.ssgSecret.secretArn,
      exportName: "SsgSecretArn",
    });
  }
}
