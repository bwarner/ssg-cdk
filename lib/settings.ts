import * as cdk from "aws-cdk-lib";
import { RetentionDays } from "aws-cdk-lib/aws-logs";

const LOG_RETENTION = {
  ONE_WEEK: RetentionDays.ONE_WEEK,
  THREE_MONTHS: RetentionDays.THREE_MONTHS,
  SIX_MONTHS: RetentionDays.SIX_MONTHS,
  ONE_YEAR: RetentionDays.ONE_YEAR,
  FIVE_YEARS: RetentionDays.FIVE_YEARS,
} as const;

export default class Settings {
  private environment: string;

  constructor(private readonly stack: cdk.Stack) {
    this.environment = process.env.ENVIRONMENT || "dev"; // Default to 'dev' if ENVIRONMENT is not set
  }

  // Helper method to retrieve nested context values based on environment
  private getContext<T>(key: string, defaultValue: T): T {
    const environmentContext = this.stack.node.tryGetContext(this.environment);
    const value = environmentContext ? environmentContext[key] : undefined;

    if (value !== undefined) {
      return value;
    }

    // If no specific context value is found for the environment, fallback to default context
    const defaultValueFromContext = this.stack.node.tryGetContext(key);
    return defaultValueFromContext !== undefined
      ? defaultValueFromContext
      : defaultValue;
  }

  get env(): string {
    return this.getContext("env", "preprod");
  }

  get lambdaMemorySize(): number {
    return this.getContext("lambdaMemorySize", 1024);
  }

  get lambdaTimeout(): cdk.Duration {
    return this.getContext("lambdaTimeout", cdk.Duration.seconds(30));
  }

  get queueRetentionPeriod(): cdk.Duration {
    const retentionPeriodInDays = this.getContext(
      "queueRetentionPeriod",
      cdk.Duration.days(3)
    );
    return retentionPeriodInDays;
  }

  get logRetentionPeriod(): RetentionDays {
    const retentionPeriodInDays = this.getContext(
      "logRetentionPeriod",
      "ONE_WEEK"
    );
    return LOG_RETENTION[retentionPeriodInDays];
  }

  get removalPolicy(): cdk.RemovalPolicy {
    const value = this.getContext("removalPolicy", "DESTROY");
    return value === "DESTROY"
      ? cdk.RemovalPolicy.DESTROY
      : cdk.RemovalPolicy.RETAIN;
  }

  get visibilityTimeout(): number {
    return this.getContext("visibilityTimeout", 60); // Default: 60 seconds
  }

  get maxReceiveCount(): number {
    return this.getContext("maxReceiveCount", 5); // Default: 5
  }

  get deadLetterQueueMaxReceiveCount(): number {
    return this.getContext("deadLetterQueueMaxReceiveCount", 5); // Default: 5
  }

  get deadLetterQueueVisibilityTimeout(): number {
    return this.getContext("deadLetterQueueVisibilityTimeout", 60); // Default: 60 seconds
  }

  get lambdaAlarmEvaluationPeriod(): number {
    return this.getContext("lambdaAlarmEvaluationPeriod", 5); // Default: 5
  }

  get lambdaAlarmThreshold(): number {
    return this.getContext("lambdaAlarmThreshold", 1000); // Default: 1000
  }

  get lambdaAlarmActionsEnabled(): boolean {
    return this.getContext("lambdaAlarmActionsEnabled", true); // Default: true
  }

  get lambdaAlarmNamespace(): string {
    return this.getContext("lambdaAlarmNamespace", "AWS/Lambda");
  }

  get lambdaAlarmPeriod(): cdk.Duration {
    return this.getContext("lambdaAlarmPeriod", cdk.Duration.minutes(1)); // Default: 1 minute
  }

  get queueAlarmEvaluationPeriod(): number {
    return this.getContext("queueAlarmEvaluationPeriod", 5); // Default: 5
  }

  get queueAlarmThreshold(): number {
    return this.getContext("queueAlarmThreshold", 1000); // Default: 1000
  }

  get queueAlarmNamespace(): string {
    return this.getContext("queueAlarmNamespace", "AWS/SQS");
  }

  get queueAlarmPeriod(): cdk.Duration {
    return this.getContext("queueAlarmPeriod", cdk.Duration.minutes(1)); // Default: 1 minute
  }

  get queueAlarmActionsEnabled(): boolean {
    return this.getContext("queueAlarmActionsEnabled", true); // Default: true
  }
}
