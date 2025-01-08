import { App } from 'aws-cdk-lib';
import { SsgVpcStack } from '../lib/ssg-vpc';
import { Template } from 'aws-cdk-lib/assertions';

test('VPC Created with Correct Configuration', () => {
  const app = new App();
  // Instantiate the SsgVpcStack
  const stack = new SsgVpcStack(app, 'TestStack');

  // Prepare the assertions template
  const template = Template.fromStack(stack);

  // Check if a VPC is created with the specified configuration
  template.hasResourceProperties('AWS::EC2::VPC', {
    InstanceTenancy: 'default',
  });

  // Check for public subnet creation
  template.hasResourceProperties('AWS::EC2::Subnet', {
    MapPublicIpOnLaunch: true,
  });

  // Check for private subnet with NAT configuration
  template.hasResourceProperties('AWS::EC2::Subnet', {
    MapPublicIpOnLaunch: false,
  });

  // Check for private isolated subnet
  template.hasResourceProperties('AWS::EC2::Subnet', {
    MapPublicIpOnLaunch: false,
  });

  // Check for the output export of the VPC ID
  template.hasOutput('SSGVpcId', {
    Export: {
      Name: 'SSGVpcId',
    },
  });
});
