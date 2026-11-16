import * as cdk from 'aws-cdk-lib';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

import { ASSET_PORT, CONTAINER_PORT, POSTGRES_PORT, type DeployConfig } from './config';
import { CLOUD_BOT_FIELD } from './storage-stack';

const LAUNCH_TYPE = 'EXTERNAL';
const SERVICE_NAME = 'app';
const WORK_VOLUME = 'work';
const WORK_CONTAINER_PATH = '/work';
const LINE_FILE = 'lines/site-line.json';

export interface SiteStackProps extends cdk.StackProps {
  repository: ecr.IRepository;
  backupBucket: s3.IBucket;
  logGroups: logs.ILogGroup[];
  jwtSecret: secretsmanager.ISecret;
  adminPasswordSecret: secretsmanager.ISecret;
  natsTokenSecret: secretsmanager.ISecret;
  postgresPasswordSecret: secretsmanager.ISecret;
  cloudBotSecret: secretsmanager.ISecret;
  config: DeployConfig;
}

/**
 * The site as ECS sees it: a cluster the machine registers into through
 * Systems Manager, the role the machine holds, and the app as one service on
 * that machine. The app shares the machine's network, where Postgres, NATS
 * and Mosquitto listen.
 */
export class SiteStack extends cdk.Stack {
  public readonly instanceRole: iam.Role;

  constructor(scope: Construct, id: string, props: SiteStackProps) {
    super(scope, id, props);

    const { config } = props;
    const secrets = [props.jwtSecret, props.adminPasswordSecret, props.natsTokenSecret, props.postgresPasswordSecret, props.cloudBotSecret];

    const cluster = new ecs.CfnCluster(this, 'Cluster', { clusterName: config.projectSlug });

    // --- Role the machine holds once registered ---

    this.instanceRole = new iam.Role(this, 'InstanceRole', {
      roleName: config.instanceRoleName,
      assumedBy: new iam.ServicePrincipal('ssm.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonEC2ContainerServiceforEC2Role'),
      ],
    });
    props.repository.grantPull(this.instanceRole);
    props.backupBucket.grantReadWrite(this.instanceRole);
    for (const secret of secrets) secret.grantRead(this.instanceRole);
    for (const logGroup of props.logGroups) logGroup.grantWrite(this.instanceRole);

    // --- App ---

    const taskDefinition = new ecs.ExternalTaskDefinition(this, 'AppTaskDef', {
      family: `${config.projectSlug}-${SERVICE_NAME}`,
      networkMode: ecs.NetworkMode.HOST,
    });
    taskDefinition.addVolume({ name: WORK_VOLUME, host: { sourcePath: config.workHostPath } });

    const container = taskDefinition.addContainer(SERVICE_NAME, {
      image: ecs.ContainerImage.fromEcrRepository(props.repository, config.imageTag),
      memoryReservationMiB: config.memoryReservationMiB,
      portMappings: [{ containerPort: CONTAINER_PORT }, { containerPort: ASSET_PORT }],
      environment: {
        PORT: String(CONTAINER_PORT),
        LT_BASE_URL: `http://localhost:${CONTAINER_PORT}`,
        LT_ADMIN_USER: config.adminUser,
        POSTGRES_HOST: config.postgresHost,
        POSTGRES_PORT: String(POSTGRES_PORT),
        POSTGRES_USER: config.dbUsername,
        POSTGRES_DB: config.dbName,
        NATS_URL: config.natsUrl,
        NATS_WS_TARGET: config.natsWsUrl,
        DBOS__VMID: config.siteId,
        DBOS__APPVERSION: config.dbosAppVersion,
        CLOUD_URL: config.cloudUrl,
        WORK_DIR: WORK_CONTAINER_PATH,
        ASSET_PORT: String(ASSET_PORT),
        ASSET_BASE_URL: config.assetBaseUrl,
        LINE_FILE,
        MACHINE_TRANSPORT: 'mqtt',
        MACHINE_MQTT_URL: config.mqttUrl,
      },
      secrets: {
        JWT_SECRET: ecs.Secret.fromSecretsManager(props.jwtSecret),
        LT_ADMIN_PASSWORD: ecs.Secret.fromSecretsManager(props.adminPasswordSecret),
        NATS_TOKEN: ecs.Secret.fromSecretsManager(props.natsTokenSecret),
        POSTGRES_PASSWORD: ecs.Secret.fromSecretsManager(props.postgresPasswordSecret),
        CLOUD_API_KEY: ecs.Secret.fromSecretsManager(props.cloudBotSecret, CLOUD_BOT_FIELD.API_KEY),
        CLOUD_BOT_ID: ecs.Secret.fromSecretsManager(props.cloudBotSecret, CLOUD_BOT_FIELD.BOT_ID),
      },
      // Kept on the machine's disk; its log shipper forwards them when online.
      logging: ecs.LogDrivers.jsonFile({ maxSize: '50m', maxFile: 5 }),
      // The agent restarts the app on the machine, with no call to AWS.
      enableRestartPolicy: true,
      stopTimeout: cdk.Duration.seconds(60),
    });
    container.addMountPoints({ sourceVolume: WORK_VOLUME, containerPath: WORK_CONTAINER_PATH, readOnly: false });

    // One machine with fixed ports: a deploy stops the running task, then starts the next.
    const service = new ecs.CfnService(this, 'AppService', {
      serviceName: SERVICE_NAME,
      cluster: cluster.ref,
      taskDefinition: taskDefinition.taskDefinitionArn,
      launchType: LAUNCH_TYPE,
      desiredCount: config.desiredCount,
      deploymentConfiguration: {
        minimumHealthyPercent: 0,
        maximumPercent: 100,
        deploymentCircuitBreaker: { enable: true, rollback: true },
      },
    });

    // --- Outputs ---

    new cdk.CfnOutput(this, 'ClusterName', { value: cluster.ref });
    new cdk.CfnOutput(this, 'ServiceName', { value: service.attrName });
    new cdk.CfnOutput(this, 'InstanceRoleName', { value: this.instanceRole.roleName });
  }
}
