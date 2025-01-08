import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export class SsgGithubStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create an OpenID Connect provider for GitHub
    const githubOidcProvider = new iam.OpenIdConnectProvider(
      this,
      'GithubOIDC',
      {
        url: 'https://token.actions.githubusercontent.com',
        clientIds: ['sts.amazonaws.com'],
        thumbprints: ['a031c46782e6e6c662c2c87c76da9aa62ccabd8e'],
      },
    );

    // Create an IAM role for GitHub Actions
    const githubActionsRole = new iam.Role(this, 'DeployToECSRole', {
      assumedBy: new iam.FederatedPrincipal(
        githubOidcProvider.openIdConnectProviderArn,
        {
          StringLike: {
            'token.actions.githubusercontent.com:sub':
              'repo:bwarner/scansafeguard:*',
          },
          StringEquals: {
            'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          },
        },
        'sts:AssumeRoleWithWebIdentity',
      ),
      roleName: 'github-actions-role',
      description: 'GitHub actions deployment to ECS',
      maxSessionDuration: cdk.Duration.seconds(3600),
    });

    githubActionsRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonS3FullAccess'),
    );
    githubActionsRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName(
        'AmazonEC2ContainerRegistryReadOnly',
      ),
    );
    githubActionsRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('SecretsManagerReadWrite'),
    );
  }
}
