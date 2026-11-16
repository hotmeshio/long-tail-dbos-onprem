import * as cdk from 'aws-cdk-lib';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import { Construct } from 'constructs';

import type { DeployConfig } from './config';

/** Manifests kept: each release is one index plus one image per architecture. */
const MAX_IMAGES = 60;

export interface RegistryStackProps extends cdk.StackProps {
  config: DeployConfig;
}

/** The repository the deploy workflow pushes the site image to. */
export class RegistryStack extends cdk.Stack {
  public readonly repository: ecr.Repository;

  constructor(scope: Construct, id: string, props: RegistryStackProps) {
    super(scope, id, props);

    this.repository = new ecr.Repository(this, 'Repository', {
      repositoryName: props.config.projectSlug,
      imageScanOnPush: true,
      lifecycleRules: [{ maxImageCount: MAX_IMAGES }],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    new cdk.CfnOutput(this, 'RepositoryUri', { value: this.repository.repositoryUri });
  }
}
