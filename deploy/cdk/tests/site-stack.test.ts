import { Match } from 'aws-cdk-lib/assertions';

import { defineStacks } from '../lib/stacks';
import { createApp, synthStacks, templateOf, TEST_CLOUD_URL, TEST_ENV } from './synth';

type Pair = { Name: string; Value?: string; ValueFrom?: unknown };

describe('SiteStack', () => {
  const template = templateOf(synthStacks().site);
  const [taskDefinition] = Object.values(template.findResources('AWS::ECS::TaskDefinition'));
  const [container] = taskDefinition.Properties.ContainerDefinitions;
  const environment = Object.fromEntries((container.Environment as Pair[]).map((pair) => [pair.Name, pair.Value]));

  it('creates a cluster named after the project', () => {
    template.hasResourceProperties('AWS::ECS::Cluster', { ClusterName: 'onpremsite' });
  });

  it('creates no network or load balancer', () => {
    template.resourceCountIs('AWS::EC2::VPC', 0);
    template.resourceCountIs('AWS::ElasticLoadBalancingV2::LoadBalancer', 0);
  });

  it('gives the machine a role Systems Manager can hand out', () => {
    template.hasResourceProperties('AWS::IAM::Role', {
      RoleName: 'OnPremSite-InstanceRole',
      AssumeRolePolicyDocument: {
        Statement: [Match.objectLike({ Principal: { Service: 'ssm.amazonaws.com' }, Action: 'sts:AssumeRole' })],
      },
    });
    const role = Object.values(template.findResources('AWS::IAM::Role'))
      .find((candidate) => candidate.Properties.RoleName === 'OnPremSite-InstanceRole');
    const managed = JSON.stringify(role?.Properties.ManagedPolicyArns);
    expect(managed).toContain('AmazonSSMManagedInstanceCore');
    expect(managed).toContain('AmazonEC2ContainerServiceforEC2Role');
  });

  it('lets the machine pull the image, write backups and logs, and read its secrets', () => {
    const actions = Object.values(template.findResources('AWS::IAM::Policy'))
      .flatMap((policy) => policy.Properties.PolicyDocument.Statement)
      .flatMap((statement) => statement.Action);
    expect(actions).toEqual(expect.arrayContaining([
      'ecr:BatchGetImage',
      's3:PutObject',
      'logs:PutLogEvents',
      'secretsmanager:GetSecretValue',
    ]));
  });

  it('defines the app as an external task on the machine network', () => {
    expect(taskDefinition.Properties).toMatchObject({
      Family: 'onpremsite-app',
      NetworkMode: 'host',
      RequiresCompatibilities: ['EXTERNAL'],
      Volumes: [{ Name: 'work', Host: { SourcePath: '/var/lib/onpremsite/work' } }],
    });
    expect(container.MountPoints).toEqual([{ SourceVolume: 'work', ContainerPath: '/work', ReadOnly: false }]);
  });

  it('points the app at services on the machine and at the cloud', () => {
    expect(environment).toMatchObject({
      PORT: '3000',
      POSTGRES_HOST: '127.0.0.1',
      NATS_URL: 'nats://127.0.0.1:4222',
      MACHINE_MQTT_URL: 'mqtt://127.0.0.1:1883',
      CLOUD_URL: TEST_CLOUD_URL,
      WORK_DIR: '/work',
      DBOS__VMID: 'site-1',
    });
  });

  it('injects every credential as a secret', () => {
    const names = (container.Secrets as Pair[]).map((pair) => pair.Name).sort();
    expect(names).toEqual(['CLOUD_API_KEY', 'CLOUD_BOT_ID', 'JWT_SECRET', 'LT_ADMIN_PASSWORD', 'NATS_TOKEN', 'POSTGRES_PASSWORD']);
    for (const name of names) expect(environment).not.toHaveProperty(name);
  });

  it('reads the cloud key and bot id from fields of one secret', () => {
    const secrets = Object.fromEntries((container.Secrets as Pair[]).map((pair) => [pair.Name, JSON.stringify(pair.ValueFrom)]));
    expect(secrets.CLOUD_API_KEY).toContain(':apiKey::');
    expect(secrets.CLOUD_BOT_ID).toContain(':botId::');
  });

  it('keeps logs on the machine and restarts the app in place', () => {
    expect(container.LogConfiguration).toMatchObject({ LogDriver: 'json-file', Options: { 'max-size': '50m', 'max-file': '5' } });
    expect(container.RestartPolicy).toMatchObject({ Enabled: true });
  });

  it('runs the app as one external service that replaces its task on deploy', () => {
    template.hasResourceProperties('AWS::ECS::Service', {
      ServiceName: 'app',
      LaunchType: 'EXTERNAL',
      DesiredCount: 0,
      DeploymentConfiguration: {
        MinimumHealthyPercent: 0,
        MaximumPercent: 100,
        DeploymentCircuitBreaker: { Enable: true, Rollback: true },
      },
    });
  });

  it('takes the desired count, image tag and asset address as context', () => {
    const { site } = defineStacks(
      createApp({ desiredCount: 1, imageTag: 'v1.2.3', assetBaseUrl: 'http://192.168.1.50:3001' }),
      TEST_ENV,
    );
    const overridden = templateOf(site);
    overridden.hasResourceProperties('AWS::ECS::Service', { DesiredCount: 1 });
    const [definition] = Object.values(overridden.findResources('AWS::ECS::TaskDefinition'));
    const [app] = definition.Properties.ContainerDefinitions;
    expect(JSON.stringify(app.Image)).toContain(':v1.2.3');
    expect(app.Environment).toContainEqual({ Name: 'ASSET_BASE_URL', Value: 'http://192.168.1.50:3001' });
  });
});
