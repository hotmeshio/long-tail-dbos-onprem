import { loadConfig } from '../lib/config';
import { createApp, TEST_CLOUD_URL } from './synth';

const ENV_NAMES = ['CLOUD_URL', 'SITE_IMAGE_TAG', 'SITE_DESIRED_COUNT', 'SITE_ASSET_BASE_URL', 'SITE_ALARM_EMAIL'];

describe('loadConfig', () => {
  beforeEach(() => {
    for (const name of ENV_NAMES) vi.stubEnv(name, '');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('derives names from the project name', () => {
    const config = loadConfig(createApp());
    expect(config.projectName).toBe('OnPremSite');
    expect(config.projectSlug).toBe('onpremsite');
    expect(config.stackName('Site')).toBe('OnPremSite-Site');
    expect(config.secretName('NatsToken')).toBe('OnPremSite/NatsToken');
    expect(config.logGroup('app')).toBe('/site/onpremsite/app');
    expect(config.bucketName('111111111111', 'us-west-2')).toBe('onpremsite-backups-111111111111-us-west-2');
    expect(config.instanceRoleName).toBe('OnPremSite-InstanceRole');
    expect(config.workHostPath).toBe('/var/lib/onpremsite/work');
  });

  it('addresses Postgres, NATS and MQTT on the machine itself', () => {
    const config = loadConfig(createApp());
    expect(config.postgresHost).toBe('127.0.0.1');
    expect(config.natsUrl).toBe('nats://127.0.0.1:4222');
    expect(config.natsWsUrl).toBe('ws://127.0.0.1:9222');
    expect(config.mqttUrl).toBe('mqtt://127.0.0.1:1883');
  });

  it('starts with no running task and the latest image', () => {
    const config = loadConfig(createApp());
    expect(config.desiredCount).toBe(0);
    expect(config.imageTag).toBe('latest');
    expect(config.alarmEmail).toBeUndefined();
  });

  it('takes a project name override', () => {
    const config = loadConfig(createApp({ projectName: 'Fab Site' }));
    expect(config.projectSlug).toBe('fab-site');
    expect(config.deployRoleName).toBe('Fab Site-GithubActionsDeployRole');
  });

  it('trims trailing slashes from addresses', () => {
    const config = loadConfig(createApp({ cloudUrl: `${TEST_CLOUD_URL}//`, assetBaseUrl: 'http://192.168.1.50:3001/' }));
    expect(config.cloudUrl).toBe(TEST_CLOUD_URL);
    expect(config.assetBaseUrl).toBe('http://192.168.1.50:3001');
  });

  it('reads values from the environment when context is absent', () => {
    vi.stubEnv('CLOUD_URL', 'https://from-env.example.com');
    vi.stubEnv('SITE_DESIRED_COUNT', '1');
    vi.stubEnv('SITE_IMAGE_TAG', 'v1.2.3');
    const config = loadConfig(createApp({ cloudUrl: undefined }));
    expect(config.cloudUrl).toBe('https://from-env.example.com');
    expect(config.desiredCount).toBe(1);
    expect(config.imageTag).toBe('v1.2.3');
  });

  it('throws when the cloud address is missing, naming CLOUD_URL', () => {
    expect(() => loadConfig(createApp({ cloudUrl: undefined }))).toThrow(/cloudUrl.*CLOUD_URL/);
  });

  it.each([
    ['desiredCount', 2],
    ['desiredCount', 'one'],
    ['silenceHours', 0],
    ['backupTransitionDays', 1.5],
    ['memoryReservationMiB', 64],
  ])('throws when %s is %s', (key, value) => {
    expect(() => loadConfig(createApp({ [key]: value }))).toThrow(new RegExp(key));
  });

  it('throws when backups would expire before they move to Glacier', () => {
    expect(() => loadConfig(createApp({ backupTransitionDays: 90, backupExpirationDays: 60 }))).toThrow(/backupExpirationDays/);
  });
});
