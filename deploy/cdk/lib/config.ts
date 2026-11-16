import * as cdk from 'aws-cdk-lib';

export const CONTAINER_PORT = 3000;
export const ASSET_PORT = 3001;
export const NATS_PORT = 4222;
export const NATS_WS_PORT = 9222;
export const POSTGRES_PORT = 5432;
export const MQTT_PORT = 1883;
export const GITHUB_OIDC_HOST = 'token.actions.githubusercontent.com';

/** Postgres, NATS and Mosquitto run on the machine itself; the app shares its network. */
const HOST = '127.0.0.1';

/** Log groups the machine ships to: the app, the services beside it, and the system journal. */
export const LOG_STREAMS = ['app', 'services', 'host'] as const;
export type LogStream = (typeof LOG_STREAMS)[number];

/**
 * Deployment settings. The cloud address is required and comes from CDK
 * context or the environment:
 *   CLOUD_URL=https://cloud.example.com npx cdk deploy --all
 * The rest have defaults and take context overrides (-c name=value).
 */
export function loadConfig(app: cdk.App) {
  /** Prefix for stack names, secrets and roles. */
  const projectName: string = app.node.tryGetContext('projectName') || 'OnPremSite';

  /** Lowercase form, for names AWS requires in lowercase. */
  const projectSlug: string = app.node.tryGetContext('projectSlug') || projectName.toLowerCase().replace(/[^a-z0-9]/g, '-');

  /** The cloud Long Tail this site takes work from. */
  const cloudUrl = required(app, 'cloudUrl', 'CLOUD_URL').replace(/\/+$/, '');

  /** Image tag the service runs. The deploy workflow passes the release tag. */
  const imageTag: string = app.node.tryGetContext('imageTag') || process.env.SITE_IMAGE_TAG || 'latest';

  /** 0 until the machine is registered and an image is pushed, then 1. */
  const desiredCount = wholeNumber('desiredCount', app.node.tryGetContext('desiredCount') ?? process.env.SITE_DESIRED_COUNT ?? 0, 0, 1);

  /** DBOS executor id. It stays the same so the site recovers its own orders. */
  const siteId: string = app.node.tryGetContext('siteId') || 'site-1';

  /** Changes only when workflow code changes shape. */
  const dbosAppVersion: string = app.node.tryGetContext('dbosAppVersion') || 'onprem-v1';

  /** Where machines on the LAN fetch order files: the machine's LAN address. */
  const assetBaseUrl: string = app.node.tryGetContext('assetBaseUrl') || process.env.SITE_ASSET_BASE_URL || `http://${HOST}:${ASSET_PORT}`;

  /** Directory on the machine that holds the files of claimed orders. */
  const workHostPath: string = app.node.tryGetContext('workHostPath') || `/var/lib/${projectSlug}/work`;

  const adminUser: string = app.node.tryGetContext('adminUser') || 'superadmin';
  const dbName: string = app.node.tryGetContext('dbName') || 'longtail';
  const dbUsername: string = app.node.tryGetContext('dbUsername') || 'postgres';
  const memoryReservationMiB = wholeNumber('memoryReservationMiB', app.node.tryGetContext('memoryReservationMiB') ?? 1024, 256, 65_536);

  /** Backups move to Glacier Instant Retrieval after this many days. */
  const backupTransitionDays = wholeNumber('backupTransitionDays', app.node.tryGetContext('backupTransitionDays') ?? 30, 1, 3650);

  /** Backups are deleted after this many days. */
  const backupExpirationDays = wholeNumber('backupExpirationDays', app.node.tryGetContext('backupExpirationDays') ?? 365, 2, 3650);
  if (backupExpirationDays <= backupTransitionDays) {
    throw new Error(`backupExpirationDays (${backupExpirationDays}) must be greater than backupTransitionDays (${backupTransitionDays})`);
  }

  const logRetentionDays = wholeNumber('logRetentionDays', app.node.tryGetContext('logRetentionDays') ?? 30, 1, 3653);

  /** Hours with no log line from the machine before the alarm fires. */
  const silenceHours = wholeNumber('silenceHours', app.node.tryGetContext('silenceHours') ?? 3, 1, 168);

  /** Receives the silence alarm when set. */
  const alarmEmail: string | undefined = app.node.tryGetContext('alarmEmail') || process.env.SITE_ALARM_EMAIL || undefined;

  return {
    projectName,
    projectSlug,
    cloudUrl,
    imageTag,
    desiredCount,
    siteId,
    dbosAppVersion,
    assetBaseUrl: assetBaseUrl.replace(/\/+$/, ''),
    workHostPath,
    adminUser,
    dbName,
    dbUsername,
    memoryReservationMiB,
    backupTransitionDays,
    backupExpirationDays,
    logRetentionDays,
    silenceHours,
    alarmEmail,

    stackName: (suffix: string) => `${projectName}-${suffix}`,
    logGroup: (stream: LogStream) => `/site/${projectSlug}/${stream}`,
    secretName: (name: string) => `${projectName}/${name}`,
    bucketName: (account: string, region: string) => `${projectSlug}-backups-${account}-${region}`,

    postgresHost: HOST,
    natsUrl: `nats://${HOST}:${NATS_PORT}`,
    natsWsUrl: `ws://${HOST}:${NATS_WS_PORT}`,
    mqttUrl: `mqtt://${HOST}:${MQTT_PORT}`,
    instanceRoleName: `${projectName}-InstanceRole`,
    deployRoleName: `${projectName}-GithubActionsDeployRole`,
  };
}

export type DeployConfig = ReturnType<typeof loadConfig>;

/** A value from CDK context or the environment; throws when neither is set. */
function required(app: cdk.App, contextKey: string, envKey: string): string {
  const value = app.node.tryGetContext(contextKey) || process.env[envKey];
  if (!value) throw new Error(`Missing ${contextKey}: pass -c ${contextKey}=... or set ${envKey}`);
  return value;
}

function wholeNumber(name: string, raw: unknown, min: number, max: number): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be a whole number from ${min} to ${max}, got "${raw}"`);
  }
  return value;
}
