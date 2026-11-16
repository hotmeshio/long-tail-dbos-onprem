import * as cdk from 'aws-cdk-lib';

import { loadConfig, type DeployConfig } from './config';
import { GithubOidcStack } from './github-oidc-stack';
import { LogsStack } from './logs-stack';
import { RegistryStack } from './registry-stack';
import { SiteStack } from './site-stack';
import { StorageStack } from './storage-stack';

export interface DeployStacks {
  config: DeployConfig;
  registry: RegistryStack;
  storage: StorageStack;
  logs: LogsStack;
  site: SiteStack;
  /** Present when githubOwner and githubRepo are given as context. */
  githubOidc?: GithubOidcStack;
}

export function defineStacks(app: cdk.App, env: cdk.Environment): DeployStacks {
  const config = loadConfig(app);

  // 1. Image repository
  const registry = new RegistryStack(app, config.stackName('Registry'), { env, config });

  // 2. Backup bucket and secrets
  const storage = new StorageStack(app, config.stackName('Storage'), { env, config });

  // 3. Log groups and the silence alarm
  const logs = new LogsStack(app, config.stackName('Logs'), { env, config });

  // 4. Cluster, machine role and the app service
  const site = new SiteStack(app, config.stackName('Site'), {
    env,
    repository: registry.repository,
    backupBucket: storage.backupBucket,
    logGroups: Object.values(logs.logGroups),
    jwtSecret: storage.jwtSecret,
    adminPasswordSecret: storage.adminPasswordSecret,
    natsTokenSecret: storage.natsTokenSecret,
    postgresPasswordSecret: storage.postgresPasswordSecret,
    cloudBotSecret: storage.cloudBotSecret,
    config,
  });

  // 5. GitHub Actions deploy role
  const githubOwner = app.node.tryGetContext('githubOwner');
  const githubRepo = app.node.tryGetContext('githubRepo');
  const githubOidc = githubOwner && githubRepo
    ? new GithubOidcStack(app, config.stackName('GithubOidc'), { env, config, githubOwner, githubRepo })
    : undefined;

  return { config, registry, storage, logs, site, githubOidc };
}
