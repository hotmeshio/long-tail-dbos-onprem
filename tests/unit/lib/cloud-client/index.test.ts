import { afterEach, describe, expect, it } from 'vitest';

import { configureCloud, getCloud } from '../../../../src/lib/cloud-client';
import { fakeCloudClient } from '../../../helpers/fake-cloud-client';

afterEach(() => configureCloud(undefined));

describe('getCloud', () => {
  it('throws when no client is configured, naming the env var', () => {
    expect(() => getCloud()).toThrow('CLOUD_URL');
  });

  it('returns the configured client', () => {
    const cloud = fakeCloudClient();
    configureCloud(cloud);
    expect(getCloud()).toBe(cloud);
  });

  it('returns the latest client configured', () => {
    const second = fakeCloudClient();
    configureCloud(fakeCloudClient());
    configureCloud(second);
    expect(getCloud()).toBe(second);
  });

  it('throws again once the client is cleared', () => {
    configureCloud(fakeCloudClient());
    configureCloud(undefined);
    expect(() => getCloud()).toThrow('No cloud client is configured');
  });
});
