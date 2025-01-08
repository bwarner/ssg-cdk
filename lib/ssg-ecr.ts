import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ecr from 'aws-cdk-lib/aws-ecr';

export class SsgEcrStack extends cdk.Stack {
  nmapRepository: ecr.Repository;
  frontendRepository: ecr.Repository;
  batchRepository: ecr.Repository;
  stripeHookRepository: ecr.Repository;
  relayRepository: ecr.Repository;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Define your ECR repository
    this.nmapRepository = new ecr.Repository(this, 'SsgRepository', {
      repositoryName: 'nmap',
    });

    // Export the repository ARN as a CloudFormation output
    new cdk.CfnOutput(this, 'SsgEcrArn', {
      value: this.nmapRepository.repositoryArn,
      exportName: 'ssg-repo-nmap-arn',
    });

    // Define your ECR repository
    this.frontendRepository = new ecr.Repository(
      this,
      'SsgFrontEndRepository',
      {
        repositoryName: 'frontend',
      },
    );

    // Export the repository ARN as a CloudFormation output
    new cdk.CfnOutput(this, 'SsgFrontendArn', {
      value: this.frontendRepository.repositoryArn,
      exportName: 'ssg-repo-frontend-arn',
    });

    this.stripeHookRepository = new ecr.Repository(
      this,
      'StripeHookRepository',
      {
        repositoryName: 'stripe-hook',
      },
    );
    new cdk.CfnOutput(this, 'SsgStripeHookRepositoryArn', {
      value: this.stripeHookRepository.repositoryArn,
      exportName: 'ssg-repo-stripe-hook-arn',
    });

    this.batchRepository = new ecr.Repository(this, 'SsgBatchRepository', {
      repositoryName: 'ssg-batch',
    });

    // Export the repository ARN as a CloudFormation output
    new cdk.CfnOutput(this, 'SsgBatchEcrArn', {
      value: this.batchRepository.repositoryArn,
      exportName: 'ssg-repo-batch-arn',
    });

    this.relayRepository = new ecr.Repository(this, 'SsgRelayRepository', {
      repositoryName: 'relay',
    });

    new cdk.CfnOutput(this, 'SsgRelayEcrArn', {
      value: this.relayRepository.repositoryArn,
      exportName: 'ssg-repo-relay-arn',
    });
  }
}
