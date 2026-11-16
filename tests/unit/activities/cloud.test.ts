import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { reportOutcome } from '../../../src/activities/cloud';
import { configureCloud } from '../../../src/lib/cloud-client';
import { ESCALATION_STATUS, LOG_EVENTS, REPORT_STATE } from '../../../src/modules/constants';
import { apiError } from '../../helpers/api-error-fixture';
import { TEST_BOT_ID, fakeCloudClient, type FakeCloudClient } from '../../helpers/fake-cloud-client';
import { spyOnLog } from '../../helpers/log-spy';
import { cloudRow } from '../../helpers/order-fixtures';

const OUTCOME = { completed: true, units: 2, site: 'site-1' };
const SIGNAL_KEY = 'fabricate-order-1001';
const report = () => reportOutcome('esc-1', SIGNAL_KEY, OUTCOME);
const settledRow = (status: string, resolvedBy?: string) => cloudRow({ id: 'esc-1', status, metadata: resolvedBy ? { resolved_by: resolvedBy } : null });

let cloud: FakeCloudClient;
let logged: ReturnType<typeof spyOnLog>;

beforeEach(() => {
  cloud = fakeCloudClient();
  configureCloud(cloud);
  logged = spyOnLog();
});

afterEach(() => {
  configureCloud(undefined);
  vi.restoreAllMocks();
});

describe('reportOutcome', () => {
  it('resolves the cloud wait with the outcome', async () => {
    expect(await report()).toEqual({ state: REPORT_STATE.RESOLVED });
    expect(cloud.resolve).toHaveBeenCalledWith(SIGNAL_KEY, OUTCOME);
    expect(cloud.read).not.toHaveBeenCalled();
    expect(logged.spy.mock.calls).toEqual([[LOG_EVENTS.REPORT_SETTLED, { escalationId: 'esc-1', state: REPORT_STATE.RESOLVED }]]);
  });

  it.each([[undefined], [500], [503], [401], [429]])('answers unreachable for status %s', async (status) => {
    const err = apiError(status);
    cloud.resolve.mockRejectedValue(err);
    expect(await report()).toEqual({ state: REPORT_STATE.UNREACHABLE, detail: err.message });
    expect(cloud.read).not.toHaveBeenCalled();
    expect(logged.spy.mock.calls).toEqual([[LOG_EVENTS.REPORT_UNREACHABLE, { escalationId: 'esc-1', state: REPORT_STATE.UNREACHABLE, detail: err.message }]]);
  });

  it.each([400, 403, 422])('answers refused for status %s without reading the row', async (status) => {
    const err = apiError(status);
    cloud.resolve.mockRejectedValue(err);
    expect(await report()).toEqual({ state: REPORT_STATE.REFUSED, detail: err.message });
    expect(cloud.read).not.toHaveBeenCalled();
    expect(logged.events()).toEqual([LOG_EVENTS.REPORT_SETTLED]);
  });

  it('rethrows an error that is not an API error', async () => {
    cloud.resolve.mockRejectedValue(new TypeError('outcome is not serializable'));
    await expect(report()).rejects.toThrow('outcome is not serializable');
    expect(logged.spy).not.toHaveBeenCalled();
  });

  it('throws when no cloud client is configured', async () => {
    configureCloud(undefined);
    await expect(report()).rejects.toThrow('No cloud client is configured');
  });

  describe.each([409, 404])('after a %s', (status) => {
    beforeEach(() => { cloud.resolve.mockRejectedValue(apiError(status)); });

    it('reads the row to see what happened', async () => {
      cloud.read.mockResolvedValue(settledRow(ESCALATION_STATUS.RESOLVED, TEST_BOT_ID));
      await report();
      expect(cloud.read).toHaveBeenCalledWith('esc-1');
    });

    it('answers resolved when this site already resolved the row', async () => {
      cloud.read.mockResolvedValue(settledRow(ESCALATION_STATUS.RESOLVED, TEST_BOT_ID));
      expect(await report()).toEqual({ state: REPORT_STATE.RESOLVED });
      expect(logged.events()).toEqual([LOG_EVENTS.REPORT_SETTLED]);
    });

    it('answers closed when someone else resolved the row', async () => {
      cloud.read.mockResolvedValue(settledRow(ESCALATION_STATUS.RESOLVED, 'user-7'));
      expect(await report()).toEqual({ state: REPORT_STATE.CLOSED, detail: `cloud row is ${ESCALATION_STATUS.RESOLVED} by someone else` });
    });

    it('answers closed when the row was resolved with no resolver recorded', async () => {
      cloud.read.mockResolvedValue(settledRow(ESCALATION_STATUS.RESOLVED));
      expect((await report()).state).toBe(REPORT_STATE.CLOSED);
    });

    it.each([ESCALATION_STATUS.CANCELLED, ESCALATION_STATUS.EXPIRED])('answers closed when the row is %s', async (rowStatus) => {
      cloud.read.mockResolvedValue(settledRow(rowStatus));
      expect(await report()).toEqual({ state: REPORT_STATE.CLOSED, detail: `cloud row is ${rowStatus}` });
      expect(logged.events()).toEqual([LOG_EVENTS.REPORT_SETTLED]);
    });

    it('answers unreachable when the row is still pending', async () => {
      cloud.read.mockResolvedValue(settledRow(ESCALATION_STATUS.PENDING));
      expect(await report()).toEqual({ state: REPORT_STATE.UNREACHABLE, detail: 'cloud row is still pending' });
      expect(logged.events()).toEqual([LOG_EVENTS.REPORT_UNREACHABLE]);
    });

    it.each([[undefined], [502], [401], [429]])('answers unreachable when the read fails with status %s', async (readStatus) => {
      const err = apiError(readStatus);
      cloud.read.mockRejectedValue(err);
      expect(await report()).toEqual({ state: REPORT_STATE.UNREACHABLE, detail: err.message });
    });

    it('answers closed when the cloud refuses the read', async () => {
      const err = apiError(404);
      cloud.read.mockRejectedValue(err);
      expect(await report()).toEqual({ state: REPORT_STATE.CLOSED, detail: err.message });
    });

    it('rethrows a read failure that is not an API error', async () => {
      cloud.read.mockRejectedValue(new Error('bad state'));
      await expect(report()).rejects.toThrow('bad state');
    });

    it('answers unreachable when the bot id cannot be read', async () => {
      cloud.read.mockResolvedValue(settledRow(ESCALATION_STATUS.RESOLVED, TEST_BOT_ID));
      cloud.botId.mockRejectedValue(apiError());
      expect((await report()).state).toBe(REPORT_STATE.UNREACHABLE);
    });
  });
});
