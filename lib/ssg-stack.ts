import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { SsgVpcStack } from "./ssg-vpc";
import { SsgEcrStack } from "./ssg-ecr";
import { SsgZoneStack } from "./ssg-zone";
import { SsgEcsStack } from "./ssg-ecs";
import { SsgBatchStack } from "./ssg-batch";
import { SsgSecretsStack } from "./ssg-secrets";
import { SsgGithubStack } from "./ssg-github";
import { CloudWatchSchedulerStack } from "./ssg-cloudwatch-scheduler";
import { ParametersStack } from "./ssg-parameters";
import { SsgRelayLambdaStack } from "./ssg-relay-lambda";
import { SsgStripeStack } from "./ssg-stripe";
import { SsgEbRulesStack } from "./ssg-eb-rules";
import { SsgEbRulesLambdaStack } from "./ssg-eb-rules-lambda";
export class SsgStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Applying tags to all resources in this stack
    cdk.Tags.of(this).add("Project", "ScanSafeGuard");
    cdk.Tags.of(this).add("Environment", process.env.ENVIRONMENT || "dev");
    cdk.Tags.of(this).add(
      "Owner",
      process.env.OWNER || "byron.warner@farvisionllc.com"
    );

    const certificateArn = process.env.CERTIFICATE_ARN;
    const zoneName = process.env.ZONE_NAME;
    if (!certificateArn || !zoneName) {
      throw new Error("Missing required environment variables");
    }
    const relayLambdaVersion = process.env.RELAY_LAMBDA_VERSION;
    if (!relayLambdaVersion) {
      throw new Error("Missing required environment variables");
    }
    const stripeHookLambdaVersion = process.env.STRIPE_HOOK_LAMBDA_VERSION;
    if (!stripeHookLambdaVersion) {
      throw new Error("Missing required environment variables");
    }
    const ebRulesLambdaVersion = process.env.EB_RULES_LAMBDA_VERSION;
    if (!ebRulesLambdaVersion) {
      throw new Error(
        "Missing required environment variables EB_RULES_LAMBDA_VERSION"
      );
    }

    // Create VPC
    const vpc = new SsgVpcStack(this, "SsgVpc");

    // Create ECR stack with VPC dependency
    const ecr = new SsgEcrStack(this, "SsgEcrStack");

    // Create Zone stack with VPC dependency
    const zone = new SsgZoneStack(this, "SsgZoneStack", {
      zoneName,
      certificateArn,
    });

    const secrets = new SsgSecretsStack(this, "SsgSecretsStack");

    const parameters = new ParametersStack(this, "SsgParametersStack");

    const stripe = new SsgStripeStack(this, "SsgStripeStack", {
      stripeHookRepository: ecr.stripeHookRepository,
      relayRepository: ecr.relayRepository,
      stripeHookLambdaVersion,
      relayLambdaVersion,
      secrets,
      parameters,
    });

    // Create ECS stack with VPC dependency
    const ecs = new SsgEcsStack(this, "SsgEcsStack", {
      vpc: vpc.vpc,
      frontendRepository: ecr.frontendRepository,
      zone: zone.zone,
      certificateArn: zone.certificate.certificateArn,
      desiredCount: 2,
      frontendDomainName: process.env.FRONTEND_DOMAIN_NAME || "",
      nodeEnv: process.env.NODE_ENV || "production",
      memoryLimitMiB: 2048,
      cpu: 1024,
      secret: secrets.ssgSecret,
      // auth0: {
      //   auth0BaseUrl: process.env.AUTH0_BASE_URL || '',
      //   auth0IssuerBaseUrl: process.env.AUTH0_ISSUER_BASE_URL || '',
      //   auth0ClientId: process.env.AUTH0_CLIENT_ID || '',
      //   auth0ClientSecret: process.env.AUTH0_CLIENT_SECRET || '',
      //   auth0Audience: process.env.AUTH0_AUDIENCE || '',
      // },
    });
    // Create Batch stack with VPC dependency
    const batch = new SsgBatchStack(this, "SsgBatch", {
      vpc: vpc.vpc,
      nmapRepository: ecr.nmapRepository,
      envName: process.env.ENVIRONMENT || "dev",
    });

    const schedulerRelayLambda = new SsgRelayLambdaStack(
      this,
      "SchedulerRelayLambdaStack",
      {
        repository: ecr.relayRepository,
        lambdaName: "SchedulerRelay",
        repositoryVersion: relayLambdaVersion,
        destinationUrl: parameters.schedulerDestinationUrl,
      }
    );

    const cloudWatchScheduler = new CloudWatchSchedulerStack(
      this,
      "CloudWatchSchedulerStack",
      {
        repo: ecr.batchRepository,
        lowPriorityQueue: batch.queues.lowPriorityQueue,
        highPriorityQueue: batch.queues.highPriorityQueue,
        relayLambda: schedulerRelayLambda.lambdaFunction,
        relayLambdaAlias: schedulerRelayLambda.lambdaAlias,
      }
    );

    const ebRulesLambda = new SsgEbRulesLambdaStack(
      this,
      "SsgEbRulesLambdaStack",
      {
        repository: ecr.eventBridgeConsumerRepository,
        lambdaName: "EventBridgeRulesHandler",
        repositoryVersion: ebRulesLambdaVersion,
      }
    );
    ebRulesLambda.addDependency(ecr);

    const ebRules = new SsgEbRulesStack(this, "SsgEbRulesStack", {
      relayLambdaAlias: schedulerRelayLambda.lambdaAlias,
      lambdaFunction: ebRulesLambda.lambdaFunction,
      topic: ebRulesLambda.ebRuleTopic,
    });

    ebRules.addDependency(ebRulesLambda);

    new SsgGithubStack(this, "SsgGithubStack");

    this.addDependency(vpc);
    this.addDependency(ecr);
    this.addDependency(zone);
    this.addDependency(batch);
    this.addDependency(ecs);
    this.addDependency(stripe);
    this.addDependency(cloudWatchScheduler);
    ecs.addDependency(vpc);
    ecs.addDependency(ecr);
    ecs.addDependency(zone);
    batch.addDependency(vpc);
    batch.addDependency(ecr);
    parameters.addDependency(secrets);
    cloudWatchScheduler.addDependency(ecr);
    cloudWatchScheduler.addDependency(batch);
  }
}

const app = new cdk.App();

new SsgStack(app, "SSG-Stack");

app.synth();
