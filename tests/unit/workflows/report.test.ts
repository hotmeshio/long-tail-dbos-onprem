import { conditional } from '@hotmeshio/long-tail-dbos';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import * as cloudActivities from '../../../src/activities/cloud';
import { sleepSeconds } from '../../../src/lib/durable';
import { ESCALATION_TYPE, ORDER_STATUS, REPORT_STATE, ROLE, reportClosedKey } from '../../../src/modules/constants';
import type { ProductionOutcome } from '../../../src/types/production';
import { reportToCloud } from '../../../src/workflows/report';
import { makeGlassesInput } from '../../helpers/order-fixtures';
import { orderPlan } from '../../helpers/order-plan-fixture';
import { scriptWaits, waitConfig, waitKeys } from '../../helpers/wait-script';

vi.mock('@hotmeshio/long-tail-dbos', () => ({ conditional: vi.fn() }));
vi.mock('../../../src/lib/durable', () => ({
  STEP_ONCE: { retriesAllowed: false },
  proxySteps: vi.fn((activities: unknown) => activities),
  sleepSeconds: vi.fn(),
}));
vi.mock('../../../src/activities/cloud', () => ({ reportOutcome: vi.fn() }));

const waits = conditional as unknown as Mock;
const sleeps = vi.mocked(sleepSeconds);
const reportOutcome = vi.mocked(cloudActivities.reportOutcome);

const input = makeGlassesInput();
const OUTCOME: ProductionOutcome = { completed: true, site: 'site-1', binKey: 'bin-7', destination: 'Portland' };
const UNREACHABLE = { state: REPORT_STATE.UNREACHABLE, detail: 'POST http://cloud.invalid/api/test failed' };
const RESOLVED = { state: REPORT_STATE.RESOLVED };
const CLOSED_WAIT = 'report-closed';

function reportAnswers(...results: Array<{ state: string; detail?: string }>): void {
  for (const result of results) reportOutcome.mockResolvedValueOnce(result as Awaited<ReturnType<typeof cloudActivities.reportOutcome>>);
}

const report = (plan = orderPlan()) => reportToCloud(input, plan, OUTCOME);

beforeEach(() => {
  for (const mock of [waits, sleeps, reportOutcome]) mock.mockReset();
  scriptWaits(waits, { [CLOSED_WAIT]: {} });
});

describe('reportToCloud', () => {
  it('reports once, with no sleep, when the cloud takes the outcome', async () => {
    reportAnswers(RESOLVED);
    expect(await report()).toBe(ORDER_STATUS.REPORTED);
    expect(reportOutcome).toHaveBeenCalledTimes(1);
    expect(reportOutcome).toHaveBeenCalledWith(input.escalationId, input.signalKey, OUTCOME);
    expect(sleeps).not.toHaveBeenCalled();
    expect(waitKeys(waits)).toEqual([]);
  });

  it('sleeps and reports the same outcome again while the cloud is out of reach', async () => {
    reportAnswers(UNREACHABLE, UNREACHABLE, RESOLVED);
    expect(await report()).toBe(ORDER_STATUS.REPORTED);
    expect(reportOutcome.mock.calls).toEqual(Array(3).fill([input.escalationId, input.signalKey, OUTCOME]));
    expect(sleeps.mock.calls).toEqual([[5], [10]]);
  });

  it('doubles the sleep from the base up to the cap', async () => {
    reportAnswers(UNREACHABLE, UNREACHABLE, UNREACHABLE, UNREACHABLE, UNREACHABLE, RESOLVED);
    await report(orderPlan({ report: { baseSeconds: 3, capSeconds: 10 } }));
    expect(sleeps.mock.calls).toEqual([[3], [6], [10], [10], [10]]);
  });

  it('opens a shift-lead row when the cloud row is closed', async () => {
    reportAnswers({ state: REPORT_STATE.CLOSED, detail: 'the cloud row expired' });
    expect(await report()).toBe(ORDER_STATUS.CLOSED);
    expect(waitConfig(waits, CLOSED_WAIT)).toMatchObject({
      role: ROLE.SHIFT_LEAD,
      type: ESCALATION_TYPE.REPORT_CLOSED,
      signalKey: reportClosedKey(input.escalationId),
      metadata: { orderId: input.orderId },
      data: { orderId: input.orderId, outcome: OUTCOME, state: REPORT_STATE.CLOSED, detail: 'the cloud row expired' },
    });
    expect(waitConfig(waits, CLOSED_WAIT).description).toBe(`The cloud did not take the outcome of order ${input.orderId}: the cloud row expired`);
    expect(sleeps).not.toHaveBeenCalled();
  });

  it('opens the same row when the cloud refuses the report, naming the state when there is no detail', async () => {
    reportAnswers({ state: REPORT_STATE.REFUSED });
    expect(await report()).toBe(ORDER_STATUS.CLOSED);
    expect(waitConfig(waits, CLOSED_WAIT).description).toContain(`: ${REPORT_STATE.REFUSED}`);
    expect(reportOutcome).toHaveBeenCalledTimes(1);
  });

  it('opens the row after an outage when the cloud answers closed', async () => {
    reportAnswers(UNREACHABLE, { state: REPORT_STATE.CLOSED });
    expect(await report()).toBe(ORDER_STATUS.CLOSED);
    expect(sleeps.mock.calls).toEqual([[5]]);
  });
});
