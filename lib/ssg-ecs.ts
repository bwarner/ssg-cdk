import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as iam from 'aws-cdk-lib/aws-iam';

interface ECSProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  zone: route53.IHostedZone;
  frontendRepository: ecr.Repository;
  frontendDomainName: string;
  certificateArn: string;
  desiredCount: number;
  nodeEnv: string;
  memoryLimitMiB: number;
  cpu: number;
  secret: secretsmanager.Secret;
  // auth0: {
  //   auth0BaseUrl: String;
  //   auth0IssuerBaseUrl: String;
  //   auth0ClientId: String;
  //   auth0ClientSecret: String;
  //   auth0Audience: String;
  // };
}

export class SsgEcsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ECSProps) {
    super(scope, id, props);

    cdk.Tags.of(this).add('Service', 'SSG Frontend Cluster');
    const {
      vpc,
      zone,
      frontendRepository,
      certificateArn,
      desiredCount,
      cpu,
      nodeEnv,
      memoryLimitMiB,
      secret,
    } = props;

    // Validate props
    if (!vpc || !zone || !frontendRepository || !certificateArn) {
      throw new Error('Missing required props');
    }

    // Create a DNS record for the ALB
    const ssgCertificate = acm.Certificate.fromCertificateArn(
      this,
      'SsgCertificate',
      certificateArn,
    );

    if (!ssgCertificate) {
      throw new Error(`Could not find certificate ${certificateArn}`);
    }

    // Output the certificate ARN
    new cdk.CfnOutput(this, 'SsgCertificateArn', {
      value: certificateArn,
    });

    // Create the ECS cluster
    const cluster = new ecs.Cluster(this, 'SsgCluster', {
      clusterName: 'SSG-Cluster',
      containerInsights: true,
      vpc,
    });

    // Define the IAM role for ECS task
    const ecsTaskRole = new iam.Role(this, 'EcsTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

    // Attach the necessary policy for pulling images from ECR
    // ecsTaskRole.attachInlinePolicy(frontendTaskPolicy);
    const frontendTaskPolicy =
      iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonS3FullAccess');
    ecsTaskRole.addManagedPolicy(frontendTaskPolicy);
    ecsTaskRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName(
        'AmazonEC2ContainerRegistryReadOnly',
      ),
    );
    ecsTaskRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('SecretsManagerReadWrite'),
    );

    const taskDefinition = new ecs.FargateTaskDefinition(
      this,
      'FrontendTaskDefinition',
      {
        memoryLimitMiB,
        cpu,
        family: 'SSG-Frontend',
        taskRole: ecsTaskRole,
      },
    );

    const container = taskDefinition.addContainer('SSG-Frontend-Container', {
      image: ecs.ContainerImage.fromEcrRepository(frontendRepository),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'SSG-Frontend',
        logRetention: logs.RetentionDays.ONE_WEEK,
      }),
      portMappings: [{ containerPort: 3000 }],
      containerName: 'SSG-Frontend-Container',
      environment: {
        NODE_ENV: nodeEnv,
      },
      healthCheck: {
        command: [
          'CMD-SHELL',
          'wget -q --spider --tries=1 http://127.0.0.1:3000/api/hello || exit 1',
        ],
      },
    });

    container.addSecret(
      'AUTH0_BASE_URL',
      ecs.Secret.fromSecretsManager(secret, 'auth0BaseUrl'),
    );
    container.addSecret(
      'AUTH0_ISSUER_BASE_URL',
      ecs.Secret.fromSecretsManager(secret, 'auth0IssuerBaseUrl'),
    );
    container.addSecret(
      'AUTH0_CLIENT_ID',
      ecs.Secret.fromSecretsManager(secret, 'auth0ClientId'),
    );
    container.addSecret(
      'AUTH0_CLIENT_SECRET',
      ecs.Secret.fromSecretsManager(secret, 'auth0ClientSecret'),
    );
    container.addSecret(
      'AUTH0_AUDIENCE',
      ecs.Secret.fromSecretsManager(secret, 'auth0Audience'),
    );

    const service = new ecsPatterns.ApplicationLoadBalancedFargateService(
      this,
      'SSG-Fargate-Service',
      {
        cluster,
        circuitBreaker: { enable: true, rollback: false },
        serviceName: 'SSG-App-Service',
        desiredCount,
        taskDefinition,
        certificate: ssgCertificate,
        domainZone: zone,
        domainName: props.frontendDomainName,
        enableExecuteCommand: true,
        assignPublicIp: true,
        loadBalancerName: 'SSG-ALB',
        publicLoadBalancer: true,
        redirectHTTP: true,
        healthCheck: {
          command: [
            'CMD-SHELL',
            'wget -q --spider --tries=1 http://127.0.0.1:3000/api/hello || exit 1',
          ],
          interval: cdk.Duration.seconds(30),
          timeout: cdk.Duration.seconds(5),
          retries: 3,
          startPeriod: cdk.Duration.seconds(10),
        },
      },
    );

    service.targetGroup.configureHealthCheck({
      path: '/api/hello',
      interval: cdk.Duration.seconds(300),
      timeout: cdk.Duration.seconds(5),
      healthyHttpCodes: '200',
      healthyThresholdCount: 2,
      unhealthyThresholdCount: 2,
    });
  }
}
