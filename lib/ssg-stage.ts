import { Stage, StageProps } from "aws-cdk-lib";

import { Construct } from "constructs";
import { SsgStack } from "./ssg-stack";

// Define the stage
export class SsgStage extends Stage {
  constructor(scope: Construct, id: string, props?: StageProps) {
    super(scope, id, props);
    // Add both stacks to the stage
    new SsgStack(this, "SsgStack");
  }
}
