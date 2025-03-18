import * as cdk from "aws-cdk-lib";

export const DLQ_RETENTION_DAYS = 14;
export const LOG_RETENTION_DAYS = 14;
export const MAX_CONCURRENCY = 10;
export const MAX_ERRORS = 1;
export const EVALUATION_PERIODS = 1;
export const BATCH_SIZE = 1;
export const MAX_BATCHING_WINDOW = cdk.Duration.seconds(10);
