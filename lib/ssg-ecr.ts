import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ecr from "aws-cdk-lib/aws-ecr";

export class SsgEcrStack extends cdk.Stack {
  nmapRepository: ecr.Repository;
  frontendRepository: ecr.Repository;
  batchRepository: ecr.Repository;
  stripeHookRepository: ecr.Repository;
  relayRepository: ecr.Repository;
  ebRulesRepository: ecr.Repository;
  ebScheduleRepository: ecr.Repository;
  jobApiRepository: ecr.Repository;
  authorizerRepository: ecr.Repository;
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.authorizerRepository = new ecr.Repository(
      this,
      "SsgAuthorizerRepository",
      {
        repositoryName: "auth0-authorizer",
      }
    );

    new cdk.CfnOutput(this, "SsgAuthorizerEcrArn", {
      value: this.authorizerRepository.repositoryArn,
      exportName: "ssg-repo-authorizer-arn",
    });

    this.jobApiRepository = new ecr.Repository(this, "SsgJobRepository", {
      repositoryName: "job-api-lambda",
    });

    // Export the repository ARN as a CloudFormation output
    new cdk.CfnOutput(this, "SsgJobEcrArn", {
      value: this.jobApiRepository.repositoryArn,
      exportName: "ssg-repo-job-api-arn",
    });

    this.nmapRepository = new ecr.Repository(this, "SsgRepository", {
      repositoryName: "nmap",
    });

    // Export the repository ARN as a CloudFormation output
    new cdk.CfnOutput(this, "SsgEcrArn", {
      value: this.nmapRepository.repositoryArn,
      exportName: "ssg-repo-nmap-arn",
    });

    // Define your ECR repository
    this.frontendRepository = new ecr.Repository(
      this,
      "SsgFrontEndRepository",
      {
        repositoryName: "frontend",
      }
    );

    new cdk.CfnOutput(this, "SsgFrontendArn", {
      value: this.frontendRepository.repositoryArn,
      exportName: "ssg-repo-frontend-arn",
    });

    this.stripeHookRepository = new ecr.Repository(
      this,
      "StripeHookRepository",
      {
        repositoryName: "stripe-hook",
      }
    );
    new cdk.CfnOutput(this, "SsgStripeHookRepositoryArn", {
      value: this.stripeHookRepository.repositoryArn,
      exportName: "ssg-repo-stripe-hook-arn",
    });

    this.batchRepository = new ecr.Repository(this, "SsgBatchRepository", {
      repositoryName: "ssg-batch",
    });

    // Export the repository ARN as a CloudFormation output
    new cdk.CfnOutput(this, "SsgBatchEcrArn", {
      value: this.batchRepository.repositoryArn,
      exportName: "ssg-repo-batch-arn",
    });

    this.ebRulesRepository = new ecr.Repository(this, "SsgEbRulesRepository", {
      repositoryName: "eb-rules-lambda",
    });

    new cdk.CfnOutput(this, "SsgEbRulesEcrArn", {
      value: this.ebRulesRepository.repositoryArn,
      exportName: "ssg-repo-eb-rules-arn",
    });

    this.ebScheduleRepository = new ecr.Repository(
      this,
      "SsgEbScheduleRepository",
      {
        repositoryName: "eb-schedule-lambda",
      }
    );
    new cdk.CfnOutput(this, "SsgScheduleEcrArn", {
      value: this.ebScheduleRepository.repositoryArn,
      exportName: "ssg-repo-schedule-arn",
    });

    this.relayRepository = new ecr.Repository(this, "SsgRelayRepository", {
      repositoryName: "relay",
    });

    new cdk.CfnOutput(this, "SsgRelayEcrArn", {
      value: this.relayRepository.repositoryArn,
      exportName: "ssg-repo-relay-arn",
    });
  }
}
