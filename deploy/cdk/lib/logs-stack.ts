import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import { Construct } from 'constructs';

import { LOG_STREAMS, type DeployConfig, type LogStream } from './config';

const LOGS_NAMESPACE = 'AWS/Logs';
const INCOMING_EVENTS = 'IncomingLogEvents';

export interface LogsStackProps extends cdk.StackProps {
  config: DeployConfig;
}

/**
 * The log groups the machine ships to, and an alarm that fires when all of
 * them have been silent for the configured number of hours.
 */
export class LogsStack extends cdk.Stack {
  public readonly logGroups: Record<LogStream, logs.LogGroup>;
  public readonly alarmTopic: sns.Topic;

  constructor(scope: Construct, id: string, props: LogsStackProps) {
    super(scope, id, props);

    const { config } = props;

    this.logGroups = Object.fromEntries(
      LOG_STREAMS.map((stream) => [
        stream,
        new logs.LogGroup(this, `${stream}LogGroup`, {
          logGroupName: config.logGroup(stream),
          retention: toRetention(config.logRetentionDays),
          removalPolicy: cdk.RemovalPolicy.DESTROY,
        }),
      ]),
    ) as Record<LogStream, logs.LogGroup>;

    this.alarmTopic = new sns.Topic(this, 'AlarmTopic', { topicName: `${config.projectSlug}-alarms` });
    if (config.alarmEmail) {
      this.alarmTopic.addSubscription(new subscriptions.EmailSubscription(config.alarmEmail));
    }

    const usingMetrics = Object.fromEntries(
      LOG_STREAMS.map((stream) => [
        stream,
        new cloudwatch.Metric({
          namespace: LOGS_NAMESPACE,
          metricName: INCOMING_EVENTS,
          dimensionsMap: { LogGroupName: this.logGroups[stream].logGroupName },
          statistic: cloudwatch.Stats.SUM,
          period: cdk.Duration.hours(1),
        }),
      ]),
    );

    const silence = new cloudwatch.Alarm(this, 'SilenceAlarm', {
      alarmName: `${config.projectSlug}-silent`,
      alarmDescription: `No log line from the site for ${config.silenceHours} h: the machine is off or offline`,
      metric: new cloudwatch.MathExpression({
        expression: LOG_STREAMS.map((stream) => `FILL(${stream}, 0)`).join(' + '),
        usingMetrics,
        label: 'Log events per hour',
        period: cdk.Duration.hours(1),
      }),
      threshold: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      evaluationPeriods: config.silenceHours,
      treatMissingData: cloudwatch.TreatMissingData.BREACHING,
    });
    silence.addAlarmAction(new cloudwatchActions.SnsAction(this.alarmTopic));
    silence.addOkAction(new cloudwatchActions.SnsAction(this.alarmTopic));

    new cdk.CfnOutput(this, 'AlarmTopicArn', { value: this.alarmTopic.topicArn });
  }
}

/** CloudWatch accepts a fixed set of retention periods. */
function toRetention(days: number): logs.RetentionDays {
  if (!(days in logs.RetentionDays)) {
    throw new Error(`logRetentionDays must be a CloudWatch retention period (7, 14, 30, 60, 90, 365, ...), got ${days}`);
  }
  return days as logs.RetentionDays;
}
