import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Vpc, SubnetType } from 'aws-cdk-lib/aws-ec2';
export class SsgVpcStack extends cdk.Stack {
  vpc: Vpc;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.vpc = new Vpc(this, 'SSGVpc', {
      vpcName: 'SSGVpc',
      natGateways: 1,
      maxAzs: 3,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'public',
          subnetType: SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'application',
          subnetType: SubnetType.PRIVATE_WITH_EGRESS,
        },
        {
          cidrMask: 24,
          name: 'data',
          subnetType: SubnetType.PRIVATE_ISOLATED,
        },
      ],
    });
    new cdk.CfnOutput(this, 'SSGVpcId', {
      value: this.vpc.vpcId,
      exportName: 'SSGVpcId',
    });
  }
}
