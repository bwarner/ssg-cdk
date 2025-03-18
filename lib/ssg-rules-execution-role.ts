import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
interface SsgRulesExecutionRoleProps extends cdk.StackProps {
  roleName: string;
}

export class SsgRulesExecutionRole extends cdk.Stack {
  executionRole: iam.Role;
  constructor(scope: Construct, id: string, props: SsgRulesExecutionRoleProps) {
    super(scope, id, props);
    // Create an IAM role for the Lambda function
    const executionRole = new iam.Role(this, props.roleName, {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      roleName: props.roleName,
      description: `EventBridgeRuleHandler Execution Role`,
    });

    // Add the necessary policies to the Lambda execution role
    executionRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName(
        "service-role/AWSLambdaBasicExecutionRole"
      )
    );

    executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: `AllowEventBridgeRuleHandlerToAccessSSM`,
        effect: iam.Effect.ALLOW,
        actions: ["ssm:GetParameter"],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter/ssg/*`,
        ],
      })
    );

    this.executionRole = executionRole;
  }
}
