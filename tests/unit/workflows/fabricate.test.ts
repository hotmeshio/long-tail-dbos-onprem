import { DBOS } from '@dbos-inc/dbos-sdk';
import { Machines } from '@hotmeshio/long-tail';
import { conditional } from '@hotmeshio/long-tail-dbos';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import * as assetActivities from '../../../src/activities/assets';
import * as cloudActivities from '../../../src/activities/cloud';
import * as planActivities from '../../../src/activities/plan';
import { STEP_ONCE, proxySteps } from '../../../src/lib/durable';
import {
  ESCALATION_TYPE, FABRICATE_STATUS, PRINT_ERROR, REPORT_STATE, ROLE, WORKFLOW, inspectionKey, printFailedKey,
} from '../../../src/modules/constants';
import { fabricate, fabricateWorkflow } from '../../../src/workflows/fabricate';
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
const planOrder = vi.mocked(planActivities.planOrder);
const verifyAssets = vi.mocked(assetActivities.verifyAssets);
const cleanWorkDir = vi.mocked(assetActivities.cleanWorkDir);
const reportOutcome = vi.mocked(cloudActivities.reportOutcome);

const input = fabricateInput();
const plan = orderPlan();
const RECEIVED = { received: true };
const PASSED = { passed: true, units: 2 };
const FAILED_PRINT = { received: false, errorCode: 'nozzle-clog', detail: 'the nozzle clogged' };

beforeEach(() => {
  for (const mock of [waits, planOrder, verifyAssets, cleanWorkDir, reportOutcome]) mock.mockReset();
  planOrder.mockResolvedValue(plan);
  verifyAssets.mockResolvedValue({ verified: true });
  reportOutcome.mockResolvedValue({ state: REPORT_STATE.RESOLVED });
  scriptWaits(waits, { 'print-1': RECEIVED, inspect: PASSED });
});

describe('fabricate wiring', () => {
  it('registers the workflow under its name', () => {
    expect(DBOS.registerWorkflow).toHaveBeenCalledWith(fabricate, { name: WORKFLOW.FABRICATE });
    expect(fabricateWorkflow).toBe(fabricate);
  });

  it('runs the report as a step with one attempt and the others with the default', () => {
    expect(proxySteps).toHaveBeenCalledWith(cloudActivities, STEP_ONCE);
    expect(proxySteps).toHaveBeenCalledWith(planActivities);
    expect(proxySteps).toHaveBeenCalledWith(assetActivities);
  });
});

describe('fabricate', () => {
  it('prints, inspects, reports and releases the disk', async () => {
    const result = await fabricate(input);
    const outcome = { completed: true, units: 2, site: plan.site };
    expect(result).toEqual({ orderId: input.orderId, status: FABRICATE_STATUS.REPORTED, outcome });
    expect(planOrder).toHaveBeenCalledWith(input);
    expect(verifyAssets).toHaveBeenCalledWith(input.escalationId, input.assets);
    expect(waitKeys(waits)).toEqual(['print-1', 'inspect']);
    expect(reportOutcome).toHaveBeenCalledWith(input.escalationId, input.signalKey, outcome);
    expect(cleanWorkDir).toHaveBeenCalledWith(input.escalationId);
  });

  it('parks the print on the machine row of the planned printer', async () => {
    await fabricate(input);
    const row = waitConfig(waits, 'print-1');
    expect(row).toMatchObject({ role: plan.print.role, type: Machines.ROW_TYPE.HANDOFF, subtype: plan.print.process, timeout: plan.print.timeout, accumulate: {} });
    expect(row.metadata).toEqual({
      orderId: input.orderId,
      siteId: plan.print.siteId,
      lineId: plan.print.lineId,
      units: [{ unitId: 'order-1001-1', carrierId: null }, { unitId: 'order-1001-2', carrierId: null }],
      jobId: 'order-1001-print',
      senderJobId: null,
      orderRef: input.orderId,
      fromMachine: null,
      toMachine: plan.print.toMachine,
      recipeId: plan.print.recipeId,
      recipeVersion: plan.print.recipeVersion,
      process: plan.print.process,
      artifactUrl: plan.print.artifactUrl,
      artifactSha256: plan.print.artifactSha256,
      attempt: 1,
    });
  });

  it('asks an inspector about the printed parts', async () => {
    await fabricate(input);
    expect(waitConfig(waits, 'inspect')).toMatchObject({
      role: ROLE.INSPECTOR,
      type: ESCALATION_TYPE.INSPECTION,
      signalKey: inspectionKey(input.escalationId),
      metadata: { orderId: input.orderId },
      data: { orderId: input.orderId, product: input.product, quantity: input.quantity },
    });
  });

  it('reports the order as not built when the files fail verification', async () => {
    verifyAssets.mockResolvedValue({ verified: false, detail: 'model.stl does not match the checksum the order declares' });
    const result = await fabricate(input);
    expect(result.status).toBe(FABRICATE_STATUS.REPORTED);
    expect(result.outcome).toEqual({ completed: false, units: 0, notes: 'model.stl does not match the checksum the order declares', site: plan.site });
    expect(waits).not.toHaveBeenCalled();
    expect(reportOutcome).toHaveBeenCalledWith(input.escalationId, input.signalKey, result.outcome);
    expect(cleanWorkDir).toHaveBeenCalledWith(input.escalationId);
  });

  it('prints again under a new job id when a floor lead retries a failed print', async () => {
    scriptWaits(waits, { 'print-1': FAILED_PRINT, 'print-failed-1': { retry: true }, 'print-2': RECEIVED, inspect: PASSED });
    const result = await fabricate(input);
    expect(waitKeys(waits)).toEqual(['print-1', 'print-failed-1', 'print-2', 'inspect']);
    expect(waitConfig(waits, 'print-failed-1')).toMatchObject({
      role: ROLE.LEAD,
      type: ESCALATION_TYPE.PRINT_FAILED,
      signalKey: printFailedKey(input.escalationId, 1),
      metadata: { orderId: input.orderId },
      data: { orderId: input.orderId, attempt: 1, errorCode: FAILED_PRINT.errorCode, detail: FAILED_PRINT.detail },
    });
    expect(waitConfig(waits, 'print-2').metadata).toMatchObject({ jobId: 'order-1001-print-a2', attempt: 2 });
    expect(result.outcome).toEqual({ completed: true, units: 2, site: plan.site });
  });

  it('retries when the lead answers without a retry field', async () => {
    scriptWaits(waits, { 'print-1': FAILED_PRINT, 'print-failed-1': {}, 'print-2': RECEIVED, inspect: PASSED });
    expect((await fabricate(input)).outcome.completed).toBe(true);
  });

  it('keeps asking after each failed attempt, with a key per attempt', async () => {
    scriptWaits(waits, {
      'print-1': FAILED_PRINT, 'print-failed-1': { retry: true }, 'print-2': FAILED_PRINT, 'print-failed-2': { retry: false },
    });
    const result = await fabricate(input);
    expect(waitConfig(waits, 'print-failed-2').signalKey).toBe(printFailedKey(input.escalationId, 2));
    expect(result.outcome).toEqual({ completed: false, units: 0, notes: FAILED_PRINT.detail, site: plan.site });
  });

  it.each([
    ['the notes of a lead who ends the order', { retry: false, notes: 'out of filament' }, 'out of filament'],
    ['the print failure when the lead leaves no notes', { retry: false }, FAILED_PRINT.detail],
    ['the print failure when the lead row is closed with no decision', null, FAILED_PRINT.detail],
  ])('reports %s', async (_name, decision, notes) => {
    scriptWaits(waits, { 'print-1': FAILED_PRINT, 'print-failed-1': decision });
    const result = await fabricate(input);
    expect(waitKeys(waits)).toEqual(['print-1', 'print-failed-1']);
    expect(result).toMatchObject({ status: FABRICATE_STATUS.REPORTED, outcome: { completed: false, units: 0, notes, site: plan.site } });
  });

  it.each([
    ['a cancelled print row', null, PRINT_ERROR.CANCELLED, 'the print row was cancelled'],
    ['a print row that timed out', { $trigger: 'timeout' }, PRINT_ERROR.TIMEOUT, 'no receipt before the timeout'],
    ['a refusal with only a reason', { received: false, reason: 'machine is faulted' }, PRINT_ERROR.UNKNOWN, 'machine is faulted'],
    ['a failure with a code and detail', { received: false, errorCode: 'jam', detail: 'jammed', reason: 'other' }, 'jam', 'jammed'],
  ])('tells the lead about %s', async (_name, receipt, errorCode, detail) => {
    scriptWaits(waits, { 'print-1': receipt, 'print-failed-1': { retry: false } });
    const result = await fabricate(input);
    expect(waitConfig(waits, 'print-failed-1').data).toEqual({ orderId: input.orderId, attempt: 1, errorCode, detail });
    expect(result.outcome.notes).toBe(detail);
  });

  it.each([
    ['a rejected inspection', { passed: false, units: 1, notes: 'warped' }, { completed: false, units: 1, notes: 'warped' }],
    ['an inspection with no unit count', { passed: true }, { completed: true, units: 0 }],
    ['an inspection closed without a decision', null, { completed: false, units: 0, notes: 'the inspection was closed without a decision' }],
  ])('reports %s', async (_name, inspection, built) => {
    scriptWaits(waits, { 'print-1': RECEIVED, inspect: inspection });
    const result = await fabricate(input);
    expect(result.outcome).toEqual({ ...built, site: plan.site });
    expect(reportOutcome).toHaveBeenCalledWith(input.escalationId, input.signalKey, result.outcome);
  });

  it('stops before any wait when the order cannot be planned', async () => {
    planOrder.mockRejectedValue(new Error('order order-1001 has no "model" file to print'));
    await expect(fabricate(input)).rejects.toThrow('has no "model" file');
    expect(verifyAssets).not.toHaveBeenCalled();
    expect(waits).not.toHaveBeenCalled();
    expect(reportOutcome).not.toHaveBeenCalled();
  });
});
