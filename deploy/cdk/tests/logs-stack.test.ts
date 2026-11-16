import { defineStacks } from '../lib/stacks';
import { createApp, synthStacks, templateOf, TEST_ALARM_EMAIL, TEST_ENV } from './synth';

describe('LogsStack', () => {
  const template = templateOf(synthStacks().logs);

  it('creates a log group for the app, the services and the host', () => {
    const names = Object.values(template.findResources('AWS::Logs::LogGroup'))
      .map((group) => group.Properties.LogGroupName)
      .sort();
    expect(names).toEqual(['/site/onpremsite/app', '/site/onpremsite/host', '/site/onpremsite/services']);
  });

  it('keeps logs for 30 days', () => {
    for (const group of Object.values(template.findResources('AWS::Logs::LogGroup'))) {
      expect(group.Properties.RetentionInDays).toBe(30);
    }
  });

  it('alarms after three silent hours, counting missing data as silence', () => {
    template.resourceCountIs('AWS::CloudWatch::Alarm', 1);
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'onpremsite-silent',
      ComparisonOperator: 'LessThanThreshold',
      Threshold: 1,
      EvaluationPeriods: 3,
      TreatMissingData: 'breaching',
    });
  });

  it('sums hourly log events across the three groups', () => {
    const [alarm] = Object.values(template.findResources('AWS::CloudWatch::Alarm'));
    const metrics = alarm.Properties.Metrics as Array<Record<string, any>>;
    const expression = metrics.find((metric) => metric.Expression);
    expect(expression?.Expression).toBe('FILL(app, 0) + FILL(services, 0) + FILL(host, 0)');
    const inputs = metrics.filter((metric) => metric.MetricStat);
    expect(inputs).toHaveLength(3);
    for (const input of inputs) {
      expect(input.MetricStat).toMatchObject({ Period: 3600, Stat: 'Sum', Metric: { Namespace: 'AWS/Logs', MetricName: 'IncomingLogEvents' } });
    }
  });

  it('notifies the alarm topic on alarm and on recovery', () => {
    const [alarm] = Object.values(template.findResources('AWS::CloudWatch::Alarm'));
    expect(alarm.Properties.AlarmActions).toHaveLength(1);
    expect(alarm.Properties.OKActions).toEqual(alarm.Properties.AlarmActions);
  });

  it('subscribes the alarm email when one is given', () => {
    template.hasResourceProperties('AWS::SNS::Subscription', { Protocol: 'email', Endpoint: TEST_ALARM_EMAIL });
    const { logs } = defineStacks(createApp(), TEST_ENV);
    templateOf(logs).resourceCountIs('AWS::SNS::Subscription', 0);
  });

  it('takes retention and silence overrides, and rejects a retention CloudWatch lacks', () => {
    const { logs } = defineStacks(createApp({ logRetentionDays: 90, silenceHours: 12 }), TEST_ENV);
    templateOf(logs).hasResourceProperties('AWS::Logs::LogGroup', { RetentionInDays: 90 });
    templateOf(logs).hasResourceProperties('AWS::CloudWatch::Alarm', { EvaluationPeriods: 12 });
    expect(() => defineStacks(createApp({ logRetentionDays: 45 }), TEST_ENV)).toThrow(/logRetentionDays/);
  });
});
