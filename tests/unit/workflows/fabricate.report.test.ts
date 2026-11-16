import { conditional } from '@hotmeshio/long-tail-dbos';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import * as assetActivities from '../../../src/activities/assets';
import * as cloudActivities from '../../../src/activities/cloud';
import * as planActivities from '../../../src/activities/plan';
import { sleepSeconds } from '../../../src/lib/durable';
import { ESCALATION_TYPE, FABRICATE_STATUS, REPORT_STATE, ROLE, reportClosedKey } from '../../../src/modules/constants';
import { fabricate } from '../../../src/workflows/fabricate';
import { fabricateInput } from '../../helpers/order-fixtures';
import { orderPlan } from '../../helpers/order-plan-fixture';
import { scriptWaits, waitConfig, waitKeys } from '../../helpers/wait-script';

vi.mock('@dbos-inc/dbos-sdk', () => ({ DBOS: { registerWorkflow: vi.fn((fn: unknown) => fn) } }));
vi.mock('@hotmeshio/long-tail-dbos', () => ({ conditional: vi.fn() }));
vi.mock('../../../src/lib/durable', () => ({
  STEP_ONCE: { retriesAllowed: false },
  proxySteps: vi.fn((activities: unknown) => activities),
  sleepSeconds: vi.fn(),
}));
vi.mock('../../../src/activities/plan', () => ({ planOrder: vi.fn() }));
vi.mock('../../../src/activities/assets', () => ({ verifyAssets: vi.fn(), cleanWorkDir: vi.fn() }));
vi.mock('../../../src/activities/cloud', () => ({ reportOutcome: vi.fn() }));

const waits = conditional as unknown as Mock;
const sleeps = vi.mocked(sleepSeconds);
const planOrder = vi.mocked(planActivities.planOrder);
const verifyAssets = vi.mocked(assetActivities.verifyAssets);
const cleanWorkDir = vi.mocked(assetActivities.cleanWorkDir);
const reportOutcome = vi.mocked(cloudActivities.reportOutcome);

const input = fabricateInput();
const OUTCOME = { completed: true, units: 2, site: 'site-1' };
const UNREACHABLE = { state: REPORT_STATE.UNREACHABLE, detail: 'POST http://cloud.invalid/api/test failed' };
const RESOLVED = { state: REPORT_STATE.RESOLVED };
const BUILD = { 'print-1': { received: true }, inspect: { passed: true, units: 2 } };

/** Answer the report step with each result in turn. */
function reportAnswers(...results: Array<{ state: string; detail?: string }>): void {
  for (const result of results) reportOutcome.mockResolvedValueOnce(result as Awaited<ReturnType<typeof cloudActivities.reportOutcome>>);
}

beforeEach(() => {
  for (const mock of [waits, sleeps, planOrder, verifyAssets, cleanWorkDir, reportOutcome]) mock.mockReset();
  planOrder.mockResolvedValue(orderPlan());
  verifyAssets.mockResolvedValue({ verified: true });
  scriptWaits(waits, { ...BUILD, 'report-closed': {} });
});

describe('fabricate report', () => {
  it('reports once, with no sleep, when the cloud takes the outcome', async () => {
    reportAnswers(RESOLVED);
    expect((await fabricate(input)).status).toBe(FABRICATE_STATUS.REPORTED);
    expect(reportOutcome).toHaveBeenCalledTimes(1);
    expect(sleeps).not.toHaveBeenCalled();
    expect(waitKeys(waits)).not.toContain('report-closed');
  });

  it('sleeps and reports the same outcome again while the cloud is out of reach', async () => {
    reportAnswers(UNREACHABLE, UNREACHABLE, RESOLVED);
    const result = await fabricate(input);
    expect(result).toEqual({ orderId: input.orderId, status: FABRICATE_STATUS.REPORTED, outcome: OUTCOME });
    expect(reportOutcome.mock.calls).toEqual(Array(3).fill([input.escalationId, input.signalKey, OUTCOME]));
    expect(sleeps.mock.calls).toEqual([[5], [10]]);
    expect(waitKeys(waits)).not.toContain('report-closed');
  });

  it('doubles the sleep from the base up to the cap', async () => {
    planOrder.mockResolvedValue(orderPlan({ report: { baseSeconds: 3, capSeconds: 10 } }));
    reportAnswers(UNREACHABLE, UNREACHABLE, UNREACHABLE, UNREACHABLE, UNREACHABLE, RESOLVED);
    await fabricate(input);
    expect(sleeps.mock.calls).toEqual([[3], [6], [10], [10], [10]]);
  });

  it('sleeps between attempts, never after the last', async () => {
    const order: string[] = [];
    reportOutcome.mockImplementation(async () => {
      order.push('report');
      return order.length === 1 ? UNREACHABLE : RESOLVED;
    });
    sleeps.mockImplementation(async () => { order.push('sleep'); });
    await fabricate(input);
    expect(order).toEqual(['report', 'sleep', 'report']);
  });

  it.each([
    ['closed', { state: REPORT_STATE.CLOSED, detail: 'cloud row is cancelled' }],
    ['refused', { state: REPORT_STATE.REFUSED, detail: 'POST http://cloud.invalid/api/test returned 422' }],
  ])('hands a %s report to a floor lead and ends closed', async (_name, settled) => {
    reportAnswers(settled);
    const result = await fabricate(input);
    expect(result).toEqual({ orderId: input.orderId, status: FABRICATE_STATUS.CLOSED, outcome: OUTCOME });
    const row = waitConfig(waits, 'report-closed');
    expect(row).toMatchObject({
      role: ROLE.LEAD,
      type: ESCALATION_TYPE.REPORT_CLOSED,
      signalKey: reportClosedKey(input.escalationId),
      metadata: { orderId: input.orderId },
      data: { orderId: input.orderId, outcome: OUTCOME, state: settled.state, detail: settled.detail },
    });
    expect(row.description).toContain(settled.detail);
    expect(reportOutcome).toHaveBeenCalledTimes(1);
    expect(sleeps).not.toHaveBeenCalled();
  });

  it('names the state when a closed report carries no detail', async () => {
    reportAnswers({ state: REPORT_STATE.CLOSED });
    await fabricate(input);
    expect(waitConfig(waits, 'report-closed').description).toContain(REPORT_STATE.CLOSED);
  });

  it('ends closed when the cloud stops waiting after being out of reach', async () => {
    reportAnswers(UNREACHABLE, { state: REPORT_STATE.CLOSED, detail: 'cloud row is expired' });
    expect((await fabricate(input)).status).toBe(FABRICATE_STATUS.CLOSED);
    expect(sleeps.mock.calls).toEqual([[5]]);
  });

  it('ends closed when the lead row is closed with no answer', async () => {
    scriptWaits(waits, { ...BUILD, 'report-closed': null });
    reportAnswers({ state: REPORT_STATE.CLOSED });
    expect((await fabricate(input)).status).toBe(FABRICATE_STATUS.CLOSED);
  });

  it('reports an order that was not built the same way', async () => {
    verifyAssets.mockResolvedValue({ verified: false, detail: 'model.stl is missing' });
    reportAnswers(UNREACHABLE, { state: REPORT_STATE.CLOSED });
    const result = await fabricate(input);
    expect(waitKeys(waits)).toEqual(['report-closed']);
    expect(waitConfig(waits, 'report-closed').data.outcome).toEqual({ completed: false, units: 0, notes: 'model.stl is missing', site: 'site-1' });
    expect(result.status).toBe(FABRICATE_STATUS.CLOSED);
  });

  it.each([
    ['reported', RESOLVED, []],
    ['closed', { state: REPORT_STATE.CLOSED }, ['report-closed']],
  ])('releases the disk only after the order is %s', async (_name, settled, handed) => {
    const order: string[] = [];
    reportOutcome.mockImplementation(async () => { order.push('report'); return settled as typeof RESOLVED; });
    waits.mockImplementation(async (key: string) => { if (key === 'report-closed') order.push(key); return BUILD[key as keyof typeof BUILD] ?? {}; });
    cleanWorkDir.mockImplementation(async () => { order.push('clean'); });
    await fabricate(input);
    expect(order).toEqual(['report', ...handed, 'clean']);
    expect(cleanWorkDir).toHaveBeenCalledWith(input.escalationId);
  });

  it('keeps the files when the report step throws', async () => {
    reportOutcome.mockRejectedValue(new TypeError('outcome is not serializable'));
    await expect(fabricate(input)).rejects.toThrow('outcome is not serializable');
    expect(cleanWorkDir).not.toHaveBeenCalled();
  });
});
