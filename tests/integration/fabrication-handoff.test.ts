import { beforeAll, describe, expect, it } from 'vitest';

import { ESCALATION_STATUS, ROLE, reportClosedKey } from '../../src/modules/constants';
import {
  CLOUD_URL, SITE_URL, cloudResult, passInspection, pauseCloud, restartSite, resumeCloud,
  signIn, sitePendingRow, startCloudOrder, uniqueOrderId, type Caller,
} from '../helpers/handoff-stacks';

const CLOUD_STATUS = { FABRICATED: 'fabricated', EXPIRED: 'expired' } as const;
const SITE_ID = process.env.SITE_ID ?? 'site-1';

// Needs both compose stacks: the cloud on :3600 and this site on :3700.
describe('fabrication handoff, cloud to site and back', () => {
  let cloud: Caller;
  let site: Caller;

  beforeAll(async () => {
    cloud = await signIn(CLOUD_URL);
    site = await signIn(SITE_URL);
  });

  it('builds a cloud order on the site and completes the cloud workflow', async () => {
    const orderId = uniqueOrderId();
    const { workflowId, escalationId } = await startCloudOrder(cloud, orderId);

    expect((await passInspection(site, orderId, escalationId)).status).toBe(200);

    expect(await cloudResult(cloud, workflowId)).toEqual({
      orderId, status: CLOUD_STATUS.FABRICATED, outcome: { completed: true, units: 2, site: SITE_ID },
    });
    const { data: row } = await cloud('GET', `/api/escalations/${escalationId}`);
    expect(row.status).toBe(ESCALATION_STATUS.RESOLVED);
  });

  it('resumes an order after the site restarts during inspection', async () => {
    const orderId = uniqueOrderId();
    const { workflowId, escalationId } = await startCloudOrder(cloud, orderId);
    await sitePendingRow(site, ROLE.INSPECTOR, orderId);

    await restartSite();
    site = await signIn(SITE_URL);

    expect((await passInspection(site, orderId, escalationId)).status).toBe(200);
    expect((await cloudResult(cloud, workflowId)).status).toBe(CLOUD_STATUS.FABRICATED);
  });

  it('reports the outcome once the cloud is reachable again', async () => {
    const orderId = uniqueOrderId();
    const { workflowId, escalationId } = await startCloudOrder(cloud, orderId);
    await sitePendingRow(site, ROLE.INSPECTOR, orderId);

    await pauseCloud();
    try {
      expect((await passInspection(site, orderId, escalationId)).status).toBe(200);
      await new Promise((resolve) => setTimeout(resolve, 8_000));
    } finally {
      await resumeCloud();
    }

    expect((await cloudResult(cloud, workflowId, 90_000)).status).toBe(CLOUD_STATUS.FABRICATED);
  });

  it('hands the order to a floor lead when the cloud stopped waiting', async () => {
    const orderId = uniqueOrderId();
    const { workflowId, escalationId } = await startCloudOrder(cloud, orderId, { timeout: '20s' });
    await sitePendingRow(site, ROLE.INSPECTOR, orderId);

    expect((await cloudResult(cloud, workflowId, 90_000)).status).toBe(CLOUD_STATUS.EXPIRED);
    expect((await passInspection(site, orderId, escalationId)).status).toBe(200);

    const closed = await sitePendingRow(site, ROLE.LEAD, orderId);
    expect(closed.description).toContain(orderId);
    const done = await site('POST', '/api/escalations/resolve-by-signal-key', {
      signalKey: reportClosedKey(escalationId), resolverPayload: { acknowledged: true },
    });
    expect(done.status).toBe(200);
  });
});
