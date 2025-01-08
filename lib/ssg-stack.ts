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
import { SsgStripeTopicStack } from "./ssg-stripe-topic";
import { SsgStripeHookStack } from "./ssg-stripe-hook-lambda";
import { SsgLambdaGateway } from "./ssg-lambda-gateway";
import { SsgStripeQueueStack } from "./ssg-stripe-queue";
import { ParametersStack } from "./ssg-parameters";
import { SsgRelayLambdaStack } from "./ssg-stripe-relay";
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

    const stripeTopic = new SsgStripeTopicStack(this, "SsgStripeTopicStack", {
      topicName: "StripeTopic",
    });

    const stripeQueue = new SsgStripeQueueStack(this, "SsgStripeQueueStack", {
      queueName: "StripeQueue",
      sourceTopic: stripeTopic.topic,
    });

    const parameters = new ParametersStack(this, "SsgParametersStack", {
      stripeTopicArn: stripeTopic.topic.topicArn,
    });

    const stripeHook = new SsgStripeHookStack(this, "SsgStripeLambdaStack", {
      repository: ecr.stripeHookRepository,
      topic: stripeTopic.topic,
      lambdaName: "StripeHook",
      repositoryVersion: stripeHookLambdaVersion,
      ssgSecret: secrets.ssgSecret,
      stripeTopicArnParam: parameters.stripeTopicArnParam,
    });

    const relayLambda = new SsgRelayLambdaStack(this, "SsgRelayLambdaStack", {
      repository: ecr.relayRepository,
      lambdaName: "Relay",
      repositoryVersion: relayLambdaVersion,
      stripeDestinationUrl: parameters.stripeDestinationUrl,
    });

    const lambdaGateway = new SsgLambdaGateway(this, "SsgLambdaGateway", {
      lambda: stripeHook.lambdaFunction,
      lambdaAlias: stripeHook.lambdaAlias,
      relayLambda: relayLambda.lambdaFunction,
      relayLambdaAlias: relayLambda.lambdaAlias,
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

    const cloudWatchScheduler = new CloudWatchSchedulerStack(
      this,
      "CloudWatchSchedulerStack",
      {
        repo: ecr.batchRepository,
        lowPriorityQueue: batch.queues.lowPriorityQueue,
        highPriorityQueue: batch.queues.highPriorityQueue,
      }
    );
    new SsgGithubStack(this, "SsgGithubStack");

    this.addDependency(vpc);
    this.addDependency(ecr);
    this.addDependency(zone);
    this.addDependency(batch);
    this.addDependency(ecs);
    this.addDependency(lambdaGateway);
    this.addDependency(cloudWatchScheduler);
    ecs.addDependency(vpc);
    ecs.addDependency(ecr);
    ecs.addDependency(zone);
    batch.addDependency(vpc);
    batch.addDependency(ecr);
    stripeHook.addDependency(ecr);
    stripeHook.addDependency(stripeTopic);
    stripeQueue.addDependency(stripeTopic);
    stripeHook.addDependency(parameters);
    lambdaGateway.addDependency(stripeHook);
    lambdaGateway.addDependency(relayLambda);
    relayLambda.addDependency(parameters);
    relayLambda.addDependency(ecr);
    relayLambda.addDependency(secrets);
    relayLambda.addDependency(stripeTopic);
    relayLambda.addDependency(stripeQueue);
    parameters.addDependency(stripeTopic);
    parameters.addDependency(secrets);
    cloudWatchScheduler.addDependency(ecr);
    cloudWatchScheduler.addDependency(batch);
  }
}

const app = new cdk.App();

new SsgStack(app, "SSG-Stack");

app.synth();
