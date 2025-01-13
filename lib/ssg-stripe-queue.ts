import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as sns from "aws-cdk-lib/aws-sns";
import * as sns_subscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";

/**
 * Configuration for each SQS metric we want to create and possibly alarm on.
 */
interface SqsMetricConfig {
  metricName: string;
  threshold?: number;
  evaluationPeriods?: number;
  alarmDescription?: string;
}

interface StripeQueueProps extends cdk.StackProps {
  sourceTopic: sns.Topic;
  queueName: string;
}

export class SsgStripeQueueStack extends cdk.Stack {
  queue: sqs.Queue;
  topic: sns.Topic;
  queueForDev: sqs.Queue;

  constructor(scope: Construct, id: string, props?: StripeQueueProps) {
    super(scope, id, props);

    if (!props?.sourceTopic) {
      throw new Error("SourceTopic is required");
    }

    this.topic = props.sourceTopic;

    this.createSQSQueue(props.queueName, this.topic);
  }

  createSQSQueue(name: string, topic: sns.Topic) {
    const queueDLQ = new sqs.Queue(this, `${name}QueueDLQ`, {
      queueName: `DLQ-For-${name}-Queue`,
      retentionPeriod: cdk.Duration.days(7),
    });

    const topicDLQ = new sqs.Queue(this, `${name}TopicDLQ`, {
      queueName: `DLQ-For-${name}-Topic`,
      retentionPeriod: cdk.Duration.days(7),
    });

    this.queueForDev = new sqs.Queue(this, `${name}-For-Dev`, {
      queueName: `${name}-For-Dev`,
      retentionPeriod: cdk.Duration.days(1),
      visibilityTimeout: cdk.Duration.seconds(30),
    });

    const subscriptionForDev = new sns_subscriptions.SqsSubscription(
      this.queueForDev,
      {
        rawMessageDelivery: false,
      }
    );
    topic.addSubscription(subscriptionForDev);

    this.queue = new sqs.Queue(this, name, {
      queueName: name,
      retentionPeriod: cdk.Duration.days(1),
      visibilityTimeout: cdk.Duration.seconds(30),
      deadLetterQueue: {
        maxReceiveCount: 5,
        queue: queueDLQ,
      },
    });

    const subscription = new sns_subscriptions.SqsSubscription(this.queue, {
      deadLetterQueue: topicDLQ,
      rawMessageDelivery: false,
    });
    topic.addSubscription(subscription);

    // Define your array of metric configurations
    const sqsMetricsConfigs: SqsMetricConfig[] = [
      {
        metricName: "ApproximateAgeOfOldestMessage",
        threshold: 300, // e.g., 5 minutes
        evaluationPeriods: 1,
        alarmDescription:
          "Alarm if the oldest message is older than 5 minutes.",
      },
      {
        metricName: "ApproximateNumberOfMessagesVisible",
        threshold: 100,
        evaluationPeriods: 1,
        alarmDescription: "Alarm if there are more than 100 messages visible.",
      },
      {
        metricName: "ApproximateNumberOfMessagesNotVisible",
      },
      {
        metricName: "NumberOfMessagesDeleted",
      },
      {
        metricName: "NumberOfMessagesSent",
      },
      {
        metricName: "NumberOfMessagesReceived",
      },
    ];

    sqsMetricsConfigs.forEach((config) => {
      const metric = new cloudwatch.Metric({
        namespace: "AWS/SQS",
        metricName: config.metricName,
        dimensionsMap: {
          QueueName: this.queue.queueName,
        },
      });

      // If threshold & evaluationPeriods & alarmDescription are provided, create an alarm
      if (
        config.threshold !== undefined &&
        config.evaluationPeriods !== undefined &&
        config.alarmDescription
      ) {
        new cloudwatch.Alarm(this, `${config.metricName}Alarm`, {
          metric,
          threshold: config.threshold,
          evaluationPeriods: config.evaluationPeriods,
          alarmDescription: config.alarmDescription,
          actionsEnabled: true,
        });
      }
    });

    new cdk.CfnOutput(this, "QueueArn", {
      value: this.queue.queueArn,
      exportName: "StripeQueueArn",
    });
    new cdk.CfnOutput(this, "QueueURL", {
      value: this.queue.queueUrl,
      exportName: "StripeQueueUrl",
    });
  }
}
