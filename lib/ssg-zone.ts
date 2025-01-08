import * as cdk from 'aws-cdk-lib';

import { Construct } from 'constructs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';

export interface SsgZoneStackProps extends cdk.StackProps {
  zoneName: string;
  certificateArn: string;
}

export class SsgZoneStack extends cdk.Stack {
  zone: route53.IHostedZone;
  certificate: acm.ICertificate;

  constructor(scope: Construct, id: string, props?: SsgZoneStackProps) {
    super(scope, id, props);

    if (!props) {
      throw new Error('Missing required props');
    }
    const { zoneName, certificateArn } = props;

    if (!certificateArn) {
      throw new Error('Certificate ARN is required');
    }

    if (!zoneName) {
      throw new Error('Domain name is required');
    }

    // Define your Route53 zone
    const zone = new route53.PublicHostedZone(this, 'SsgZone', {
      zoneName,
    });

    new cdk.CfnOutput(this, 'HostedZoneIdOutput', {
      value: zone.hostedZoneId,
      exportName: 'ZoneId',
    });

    const certificate = new acm.Certificate(this, 'SSG Certificate', {
      domainName: zoneName,
      validation: acm.CertificateValidation.fromDns(zone),
    });

    new cdk.CfnOutput(this, 'CertificateArn', {
      value: certificate.certificateArn,
      exportName: 'CertificateArn',
    });

    this.zone = zone;
    this.certificate = certificate;
  }
}
