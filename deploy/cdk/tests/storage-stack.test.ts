import { Match } from 'aws-cdk-lib/assertions';

import { defineStacks } from '../lib/stacks';
import { createApp, synthStacks, templateOf, TEST_ENV } from './synth';

describe('StorageStack', () => {
  const template = templateOf(synthStacks().storage);

  it('keeps the backup bucket private, encrypted and versioned', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketName: 'onpremsite-backups-111111111111-us-west-2',
      VersioningConfiguration: { Status: 'Enabled' },
      BucketEncryption: Match.objectLike({}),
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
    template.hasResource('AWS::S3::Bucket', { DeletionPolicy: 'Retain' });
  });

  it('moves backups to Glacier Instant Retrieval at 30 days and deletes them at one year', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      LifecycleConfiguration: {
        Rules: [
          Match.objectLike({
            Status: 'Enabled',
            Transitions: [{ StorageClass: 'GLACIER_IR', TransitionInDays: 30 }],
            ExpirationInDays: 365,
            NoncurrentVersionExpiration: { NoncurrentDays: 30 },
            AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 },
          }),
        ],
      },
    });
  });

  it('takes lifecycle overrides', () => {
    const { storage } = defineStacks(createApp({ backupTransitionDays: 14, backupExpirationDays: 90 }), TEST_ENV);
    templateOf(storage).hasResourceProperties('AWS::S3::Bucket', {
      LifecycleConfiguration: {
        Rules: [Match.objectLike({ Transitions: [{ StorageClass: 'GLACIER_IR', TransitionInDays: 14 }], ExpirationInDays: 90 })],
      },
    });
  });

  it('names each secret under the project', () => {
    const names = Object.values(template.findResources('AWS::SecretsManager::Secret'))
      .map((secret) => secret.Properties.Name)
      .sort();
    expect(names).toEqual([
      'OnPremSite/AdminPassword',
      'OnPremSite/CloudBot',
      'OnPremSite/JwtSigningKey',
      'OnPremSite/NatsToken',
      'OnPremSite/PostgresPassword',
    ]);
  });

  it('generates four secrets without punctuation', () => {
    const generated = Object.values(template.findResources('AWS::SecretsManager::Secret'))
      .filter((secret) => secret.Properties.GenerateSecretString);
    expect(generated).toHaveLength(4);
    for (const secret of generated) expect(secret.Properties.GenerateSecretString.ExcludePunctuation).toBe(true);
  });

  it('creates the cloud bot secret with placeholder fields', () => {
    template.hasResourceProperties('AWS::SecretsManager::Secret', {
      Name: 'OnPremSite/CloudBot',
      SecretString: JSON.stringify({ apiKey: 'placeholder', botId: 'placeholder' }),
    });
  });
});
