import { synthStacks, templateOf } from './synth';

describe('RegistryStack', () => {
  const template = templateOf(synthStacks().registry);

  it('creates one repository named after the project, scanned on push', () => {
    template.resourceCountIs('AWS::ECR::Repository', 1);
    template.hasResourceProperties('AWS::ECR::Repository', {
      RepositoryName: 'onpremsite',
      ImageScanningConfiguration: { ScanOnPush: true },
    });
  });

  it('caps the number of stored images', () => {
    const [repository] = Object.values(template.findResources('AWS::ECR::Repository'));
    const policy = JSON.parse(repository.Properties.LifecyclePolicy.LifecyclePolicyText);
    expect(policy.rules).toHaveLength(1);
    expect(policy.rules[0].selection).toMatchObject({ countType: 'imageCountMoreThan', countNumber: 60 });
  });

  it('keeps the repository when the stack is deleted', () => {
    template.hasResource('AWS::ECR::Repository', { DeletionPolicy: 'Retain' });
  });
});
