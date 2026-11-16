import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

import type { DeployConfig } from './config';

/** Stored until the site's cloud key is written with put-secret-value. */
export const SECRET_PLACEHOLDER = 'placeholder';

/** JSON fields of the cloud bot secret. */
export const CLOUD_BOT_FIELD = { API_KEY: 'apiKey', BOT_ID: 'botId' } as const;

const NONCURRENT_VERSION_DAYS = 30;
const INCOMPLETE_UPLOAD_DAYS = 7;

export interface StorageStackProps extends cdk.StackProps {
  config: DeployConfig;
}

/** The backup bucket and the secrets the machine reads. */
export class StorageStack extends cdk.Stack {
  public readonly backupBucket: s3.Bucket;
  public readonly jwtSecret: secretsmanager.Secret;
  public readonly adminPasswordSecret: secretsmanager.Secret;
  public readonly natsTokenSecret: secretsmanager.Secret;
  public readonly postgresPasswordSecret: secretsmanager.Secret;
  public readonly cloudBotSecret: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props: StorageStackProps) {
    super(scope, id, props);

    const { config } = props;

    // --- Database backups ---

    this.backupBucket = new s3.Bucket(this, 'BackupBucket', {
      bucketName: config.bucketName(this.account, this.region),
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          transitions: [
            {
              storageClass: s3.StorageClass.GLACIER_INSTANT_RETRIEVAL,
              transitionAfter: cdk.Duration.days(config.backupTransitionDays),
            },
          ],
          expiration: cdk.Duration.days(config.backupExpirationDays),
          noncurrentVersionExpiration: cdk.Duration.days(NONCURRENT_VERSION_DAYS),
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(INCOMPLETE_UPLOAD_DAYS),
        },
      ],
    });

    // --- Secrets ---

    const generateSecret = (name: string, passwordLength: number) =>
      new secretsmanager.Secret(this, name, {
        secretName: config.secretName(name),
        generateSecretString: { passwordLength, excludePunctuation: true },
      });

    this.jwtSecret = generateSecret('JwtSigningKey', 64);
    this.adminPasswordSecret = generateSecret('AdminPassword', 32);
    this.natsTokenSecret = generateSecret('NatsToken', 48);
    this.postgresPasswordSecret = generateSecret('PostgresPassword', 32);

    this.cloudBotSecret = new secretsmanager.Secret(this, 'CloudBot', {
      secretName: config.secretName('CloudBot'),
      secretObjectValue: {
        [CLOUD_BOT_FIELD.API_KEY]: cdk.SecretValue.unsafePlainText(SECRET_PLACEHOLDER),
        [CLOUD_BOT_FIELD.BOT_ID]: cdk.SecretValue.unsafePlainText(SECRET_PLACEHOLDER),
      },
    });

    // --- Outputs ---

    new cdk.CfnOutput(this, 'BackupBucketName', { value: this.backupBucket.bucketName });
    new cdk.CfnOutput(this, 'CloudBotSecretName', { value: this.cloudBotSecret.secretName });
    new cdk.CfnOutput(this, 'AdminPasswordSecretName', { value: this.adminPasswordSecret.secretName });
  }
}
