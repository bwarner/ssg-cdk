import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as sns from "aws-cdk-lib/aws-sns";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";

interface StripeHookProps extends cdk.StackProps {
  topicName: string;
}

function createMetrics(
  topic: sns.Topic
): Array<{ metric: cloudwatch.Metric; alarm?: cloudwatch.Alarm }> {
  const metricsConfig = [
    {
      metricName: "NumberOfMessagesPublished",
      threshold: 100,
      evaluationPeriods: 1,
      alarmDescription: "Alarm if too many messages are published to the topic",
    },
    {
      metricName: "NumberOfNotificationsDelivered",
      threshold: 90,
      evaluationPeriods: 1,
      alarmDescription:
        "Alarm if fewer notifications are delivered than expected",
    },
    {
      metricName: "NumberOfNotificationsFailed",
      threshold: 10,
      evaluationPeriods: 1,
      alarmDescription: "Alarm if notifications fail",
    },
    {
      metricName: "NumberOfNotificationsFilteredOut-NoMessageAttributes",
    },
    {
      metricName: "NumberOfNotificationsFilteredOut-InvalidAttributes",
    },
  ];

  return metricsConfig.map(
    ({ metricName, threshold, evaluationPeriods, alarmDescription }) => {
      const metric = new cloudwatch.Metric({
        namespace: "AWS/SNS",
        metricName,
        dimensionsMap: {
          TopicName: topic.topicName,
        },
      });
      const alarm = threshold
        ? new cloudwatch.Alarm(topic.stack, `Alarm-${metricName}`, {
            metric,
            threshold: threshold,
            evaluationPeriods: evaluationPeriods,
            alarmDescription: alarmDescription,
          })
        : undefined;

      return { metric, alarm };
    }
  );
}

export class SsgStripeTopicStack extends cdk.Stack {
  topic: sns.Topic;
  constructor(scope: Construct, id: string, props?: StripeHookProps) {
    super(scope, id, props);

    if (!props?.topicName) {
      throw new Error("Topic name is required");
    }
    this.topic = this.createSnsTopic(props.topicName);
  }
  createSnsTopic(topicName: string) {
    const topic = new sns.Topic(this, topicName, {
      topicName: topicName,
      displayName: `${topicName} SNS Topic`,
    });

    const metricsWithAlarms = createMetrics(topic);
    metricsWithAlarms.forEach(({ metric, alarm }) => {
      if (alarm) {
        new cdk.CfnOutput(
          this,
          `${metric.metricName}-${topicName}AlarmOutput`,
          {
            value: alarm.alarmArn,
            exportName: `${metric.metricName}-${topicName}AlarmArn`,
          }
        );
      }
    });

    new cdk.CfnOutput(this, `${topicName}TopicArn`, {
      value: topic.topicArn,
      exportName: `${topicName}TopicArn`,
    });

    return topic;
  }
}
