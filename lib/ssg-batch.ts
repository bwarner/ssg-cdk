import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { Vpc } from 'aws-cdk-lib/aws-ec2';
import * as batch from 'aws-cdk-lib/aws-batch';
import { Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as logs from 'aws-cdk-lib/aws-logs';

interface SsgBatchProps extends cdk.StackProps {
  vpc: Vpc;
  nmapRepository: ecr.Repository;
  envName: string;
}

const NAME_PREFIX = 'Ssg';

type ImageTypes = 'nmap';
type JobImages = Record<ImageTypes, ecr.Repository>;

export class SsgBatchStack extends cdk.Stack {
  computeEnvironment: batch.FargateComputeEnvironment;
  jobDefinition: batch.CfnJobDefinition;
  envName: string;
  queues: {
    lowPriorityQueue: batch.JobQueue;
    highPriorityQueue: batch.JobQueue;
  };

  constructor(scope: Construct, id: string, props?: SsgBatchProps) {
    super(scope, id, props);
    if (!props || !props.vpc) {
      throw new Error('Missing required VPC prop');
    }
    const { vpc, nmapRepository, envName } = props;
    this.envName = envName;

    cdk.Tags.of(this).add('Service', 'Batch');

    const computeEnvRole = new Role(
      this,
      `${NAME_PREFIX}-batch-comp-env-role-${envName}`,
      {
        roleName: `${NAME_PREFIX}-batch-comp-env-role-${envName}`,
        assumedBy: new ServicePrincipal('batch.amazonaws.com'),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName(
            'service-role/AWSBatchServiceRole',
          ),
        ],
      },
    );

    const eventBridgeExecutionRole = new Role(
      this,
      `${NAME_PREFIX}-event-bridge-role-${envName}`,
      {
        roleName: `${NAME_PREFIX}-event-bridge-role-${envName}`,
        assumedBy: new ServicePrincipal('events.amazonaws.com'),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName(
            'service-role/AWSBatchServiceRole',
          ),
        ],
      },
    );

    eventBridgeExecutionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'BatchSubmitJob',
        actions: ['batch:SubmitJob'],
        resources: ['*'],
      }),
    );

    const batchjobSecurityGroup = new ec2.SecurityGroup(
      this,
      'BatchSecurityGroup',
      {
        vpc,
        description: 'SG for the batch job',
        allowAllOutbound: true, // Allows all outbound traffic
      },
    );

    const computeEnvironmentName = `${NAME_PREFIX}-batch-compute-environment-${envName}`;
    this.computeEnvironment = new batch.FargateComputeEnvironment(
      this,
      computeEnvironmentName,
      {
        vpc,
        serviceRole: computeEnvRole,
        updateToLatestImageVersion: true,
        computeEnvironmentName,
        vpcSubnets: { subnets: vpc.publicSubnets },
        securityGroups: [batchjobSecurityGroup],
        spot: true,
      },
    );

    this.createBatchJobQueue();
    this.createBatchJobDefinition({ nmap: nmapRepository });

    new cdk.CfnOutput(this, 'SsgComputingEnvironmentName', {
      value: this.computeEnvironment.computeEnvironmentName,
      exportName: 'SsgComputingEnvironmentName',
    });

    new cdk.CfnOutput(this, 'SsgComputingEnvironmentArn', {
      value: this.computeEnvironment.computeEnvironmentArn,
      exportName: 'SsgComputingEnvironmentArn',
    });
  }

  createBatchJobQueue() {
    const sharePolicy = new batch.FairshareSchedulingPolicy(
      this,
      'sharePolicy',
    );

    sharePolicy.addShare({
      shareIdentifier: 'basic',
      weightFactor: 1,
    });
    sharePolicy.addShare({
      shareIdentifier: 'professional',
      weightFactor: 2,
    });
    sharePolicy.addShare({
      shareIdentifier: 'enterprise',
      weightFactor: 4,
    });

    const lowPriorityQueueName = `${NAME_PREFIX}-batch-job-queue-low-${this.envName}`;
    const lowPriorityQueue = new batch.JobQueue(this, lowPriorityQueueName, {
      jobQueueName: lowPriorityQueueName,
      schedulingPolicy: sharePolicy,
      computeEnvironments: [
        { computeEnvironment: this.computeEnvironment, order: 1 },
      ],
    });

    const highPriorityQueueName = `${NAME_PREFIX}-batch-job-queue-high-${this.envName}`;
    const highPriorityQueue = new batch.JobQueue(this, highPriorityQueueName, {
      jobQueueName: highPriorityQueueName,
      priority: 10,
      schedulingPolicy: sharePolicy,
      computeEnvironments: [
        { computeEnvironment: this.computeEnvironment, order: 2 },
      ],
    });

    this.queues = {
      lowPriorityQueue,
      highPriorityQueue,
    };

    new cdk.CfnOutput(this, 'SsgJobQueueLowArn', {
      value: this.queues.lowPriorityQueue.jobQueueArn,
      exportName: 'SsgJobQueueLowArn',
    });

    new cdk.CfnOutput(this, 'SsgJobQueueHighArn', {
      value: this.queues.highPriorityQueue.jobQueueArn,
      exportName: 'SsgJobQueueHighArn',
    });
  }

  createBatchJobDefinition(jobImages: JobImages) {
    const logGroup = new logs.LogGroup(
      this,
      `${NAME_PREFIX}-batch-log-group-${this.envName}`,
      {
        logGroupName: `/aws/batch/job/${NAME_PREFIX}-batch-job-${this.envName}`,
        removalPolicy: cdk.RemovalPolicy.DESTROY, // Set to RETAIN if you don't want logs to be deleted when the stack is deleted
        retention: logs.RetentionDays.ONE_WEEK,
      },
    );

    const ecsRole = new Role(
      this,
      `${NAME_PREFIX}-batch-ecs-role-${this.envName}`,
      {
        roleName: `${NAME_PREFIX}-batch-ecs-role-${this.envName}`,
        assumedBy: new ServicePrincipal('ecs-tasks.amazonaws.com'),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName(
            'service-role/AmazonECSTaskExecutionRolePolicy',
          ),
          iam.ManagedPolicy.fromAwsManagedPolicyName(
            'CloudWatchLogsFullAccess',
          ),
        ],
      },
    );

    this.jobDefinition = new batch.CfnJobDefinition(
      this,
      `${NAME_PREFIX}-batch-job-definition-${this.envName}`,
      {
        jobDefinitionName: `${NAME_PREFIX}-batch-job-definition-${this.envName}-nmap`,
        type: 'container',
        platformCapabilities: ['FARGATE'],
        schedulingPriority: 50,
        containerProperties: {
          image: `${jobImages.nmap.repositoryUri}:7.95`,
          jobRoleArn: ecsRole.roleArn,
          executionRoleArn: ecsRole.roleArn,
          command: ['nmap', '-v', '-A', 'scanme.nmap.org'],
          networkConfiguration: {
            assignPublicIp: 'ENABLED',
          },
          environment: [
            {
              name: 'Environment',
              value: this.envName,
            },
          ],
          resourceRequirements: [
            {
              value: '1',
              type: 'VCPU',
            },
            {
              value: '2048',
              type: 'MEMORY',
            },
          ],
          fargatePlatformConfiguration: {
            platformVersion: 'LATEST',
          },
          // NOTE: This should send logs automatically to CloudWatch
          logConfiguration: {
            logDriver: 'awslogs',
            options: {
              'awslogs-group': logGroup.logGroupName,
              'awslogs-region': this.region,
              'awslogs-stream-prefix': 'batch',
            },
          },
        },
      },
    );
  }
}
