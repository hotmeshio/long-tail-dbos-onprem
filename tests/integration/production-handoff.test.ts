import { beforeAll, describe, expect, it } from 'vitest';

import { ROLE, reportClosedKey } from '../../src/modules/constants';
import {
  CLOUD_URL, RESOLVED, SITE_URL, cloudResult, cloudRowStatus, fitAndPack, pauseCloud, pendingRow, restartSite, resumeCloud,
  signIn, startCloudOrder, uniqueOrderId, unloadFrame, type Stack,
} from '../helpers/handoff-stacks';

const CLOUD_STATUS = { EXPIRED: 'expired' } as const;
const CLOUD_PICKUP_ROLE = 'carrier-pickup';

// Needs both compose stacks: the cloud on :3600 and this site, with its mock floor, on :3700.
describe('production handoff, cloud to site and back', () => {
  let cloud: Stack;
  let site: Stack;

  beforeAll(async () => {
    cloud = await signIn(CLOUD_URL);
    site = await signIn(SITE_URL);
  });

  it('makes a cloud order on the site and hands it back for shipping', async () => {
    const orderId = uniqueOrderId();
    const { escalationId } = await startCloudOrder(cloud, orderId);

    await unloadFrame(site, orderId);
    await fitAndPack(site, orderId);

    expect(await cloudRowStatus(cloud, escalationId, RESOLVED)).toBe(RESOLVED);
    expect((await pendingRow(cloud, CLOUD_PICKUP_ROLE, orderId)).role).toBe(CLOUD_PICKUP_ROLE);
  });

  it('resumes an order after the site restarts at the final fit', async () => {
    const orderId = uniqueOrderId();
    const { escalationId } = await startCloudOrder(cloud, orderId);
    await unloadFrame(site, orderId);
    await pendingRow(site, ROLE.FITTER, orderId);

    await restartSite();
    site = await signIn(SITE_URL);

    await fitAndPack(site, orderId);
    expect(await cloudRowStatus(cloud, escalationId, RESOLVED)).toBe(RESOLVED);
  });

  it('reports the outcome once the cloud is reachable again', async () => {
    const orderId = uniqueOrderId();
    const { escalationId } = await startCloudOrder(cloud, orderId);
    await unloadFrame(site, orderId);
    await pendingRow(site, ROLE.FITTER, orderId);

    await pauseCloud();
    try {
      await fitAndPack(site, orderId);
      await new Promise((resolve) => setTimeout(resolve, 8_000));
    } finally {
      await resumeCloud();
    }

    expect(await cloudRowStatus(cloud, escalationId, RESOLVED, 90_000)).toBe(RESOLVED);
  });

  it('hands the order to a shift lead when the cloud stopped waiting', async () => {
    const orderId = uniqueOrderId();
    const { workflowId, escalationId } = await startCloudOrder(cloud, orderId, { timeout: '20s' });
    await unloadFrame(site, orderId);
    await pendingRow(site, ROLE.FITTER, orderId);

    expect((await cloudResult(cloud, workflowId, 90_000)).status).toBe(CLOUD_STATUS.EXPIRED);
    await fitAndPack(site, orderId);

    const closed = await pendingRow(site, ROLE.SHIFT_LEAD, orderId);
    expect(closed.description).toContain(orderId);
    const done = await site.call('POST', '/api/escalations/resolve-by-signal-key', {
      signalKey: reportClosedKey(escalationId), resolverPayload: { acknowledged: true },
    });
    expect(done.status).toBe(200);
  });
});
