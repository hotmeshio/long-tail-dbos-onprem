import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';

import { defineStacks, type DeployStacks } from '../lib/stacks';

export const TEST_ENV = { account: '111111111111', region: 'us-west-2' };
export const TEST_CLOUD_URL = 'https://cloud.example.com';
export const TEST_GITHUB = { owner: 'acme', repo: 'site' };
export const TEST_ALARM_EMAIL = 'ops@example.com';

const BASE_CONTEXT = { cloudUrl: TEST_CLOUD_URL };

export function createApp(context: Record<string, unknown> = {}): cdk.App {
  return new cdk.App({ context: { ...BASE_CONTEXT, ...context } });
}

let cached: DeployStacks | undefined;

/** The full stack set, built once per test run. */
export function synthStacks(): DeployStacks {
  cached ??= defineStacks(
    createApp({ githubOwner: TEST_GITHUB.owner, githubRepo: TEST_GITHUB.repo, alarmEmail: TEST_ALARM_EMAIL }),
    TEST_ENV,
  );
  return cached;
}

export function templateOf(stack: cdk.Stack): Template {
  return Template.fromStack(stack);
}
