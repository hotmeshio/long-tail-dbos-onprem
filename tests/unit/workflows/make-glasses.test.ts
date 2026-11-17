import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as assetActivities from '../../../src/activities/assets';
import * as planActivities from '../../../src/activities/plan';
import { ORDER_STATUS, WORKFLOW } from '../../../src/modules/constants';
import { runLensLine } from '../../../src/workflows/lens-line';
import { makeGlasses } from '../../../src/workflows/make-glasses';
import { packOrder } from '../../../src/workflows/pack';
import { printFrame } from '../../../src/workflows/print';
import { reportToCloud } from '../../../src/workflows/report';
import { makeGlassesInput } from '../../helpers/order-fixtures';
import { orderPlan } from '../../helpers/order-plan-fixture';

const registered = vi.hoisted(() => [] as Array<{ name: string }>);
vi.mock('@dbos-inc/dbos-sdk', () => ({
  DBOS: { registerWorkflow: vi.fn((fn: unknown, options: { name: string }) => { registered.push(options); return fn; }) },
}));
vi.mock('../../../src/lib/durable', () => ({ proxySteps: vi.fn((activities: unknown) => activities) }));
vi.mock('../../../src/activities/plan', () => ({ planOrder: vi.fn() }));
vi.mock('../../../src/activities/assets', () => ({ verifyAssets: vi.fn(), cleanWorkDir: vi.fn() }));
vi.mock('../../../src/workflows/print', () => ({ printFrame: vi.fn() }));
vi.mock('../../../src/workflows/lens-line', () => ({ runLensLine: vi.fn() }));
vi.mock('../../../src/workflows/pack', () => ({ packOrder: vi.fn() }));
vi.mock('../../../src/workflows/report', () => ({ reportToCloud: vi.fn() }));

const planOrder = vi.mocked(planActivities.planOrder);
const verifyAssets = vi.mocked(assetActivities.verifyAssets);
const cleanWorkDir = vi.mocked(assetActivities.cleanWorkDir);
const print = vi.mocked(printFrame);
const lens = vi.mocked(runLensLine);
const pack = vi.mocked(packOrder);
const report = vi.mocked(reportToCloud);

const input = makeGlassesInput();
const plan = orderPlan();
const MADE = { completed: true, site: 'site-1', binKey: 'bin-7', destination: 'Portland' };

beforeEach(() => {
  for (const mock of [planOrder, verifyAssets, cleanWorkDir, print, lens, pack, report]) mock.mockReset();
  planOrder.mockResolvedValue(plan);
  verifyAssets.mockResolvedValue({ verified: true });
  for (const stage of [print, lens, pack]) stage.mockResolvedValue({ done: true });
  report.mockResolvedValue(ORDER_STATUS.REPORTED);
});

describe('makeGlasses', () => {
  it('registers under the workflow name the intake starts', () => {
    expect(registered).toContainEqual({ name: WORKFLOW.MAKE_GLASSES });
  });

  it('prints, runs the lens line, packs and reports a made order', async () => {
    expect(await makeGlasses(input)).toEqual({ orderId: input.orderId, status: ORDER_STATUS.REPORTED, outcome: MADE });
    expect(print).toHaveBeenCalledWith(input.orderId, input.frameStyle, plan.print);
    expect(lens).toHaveBeenCalledWith(input.orderId, plan.lens);
    expect(pack).toHaveBeenCalledWith(input.orderId, plan.pack);
    expect(report).toHaveBeenCalledWith(input, plan, MADE);
  });

  it('runs the stages in order', async () => {
    await makeGlasses(input);
    const order = [planOrder, verifyAssets, print, lens, pack, report, cleanWorkDir].map((mock) => mock.mock.invocationCallOrder[0]);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('verifies the files the order declares', async () => {
    await makeGlasses(input);
    expect(verifyAssets).toHaveBeenCalledWith(input.escalationId, input.assets);
  });

  it('builds nothing and reports why when the files do not verify', async () => {
    verifyAssets.mockResolvedValue({ verified: false, detail: 'round-48.gcode.3mf does not match the checksum the order declares' });
    const result = await makeGlasses(input);
    expect(print).not.toHaveBeenCalled();
    expect(result.outcome).toEqual({ completed: false, site: 'site-1', notes: 'round-48.gcode.3mf does not match the checksum the order declares' });
  });

  it('stops at a print that did not finish', async () => {
    print.mockResolvedValue({ done: false, notes: 'spool ran out' });
    expect((await makeGlasses(input)).outcome).toEqual({ completed: false, site: 'site-1', notes: 'spool ran out' });
    expect(lens).not.toHaveBeenCalled();
    expect(pack).not.toHaveBeenCalled();
  });

  it('stops at a lens line that did not finish', async () => {
    lens.mockResolvedValue({ done: false, notes: 'left lens loose' });
    expect((await makeGlasses(input)).outcome.notes).toBe('left lens loose');
    expect(pack).not.toHaveBeenCalled();
  });

  it('reports a pack that did not finish, with no notes key when none are given', async () => {
    pack.mockResolvedValue({ done: false });
    expect((await makeGlasses(input)).outcome).toEqual({ completed: false, site: 'site-1' });
  });

  it('returns the status the report settled on', async () => {
    report.mockResolvedValue(ORDER_STATUS.CLOSED);
    expect((await makeGlasses(input)).status).toBe(ORDER_STATUS.CLOSED);
  });

  it('releases the disk after the report, whatever the outcome', async () => {
    print.mockResolvedValue({ done: false });
    await makeGlasses(input);
    expect(cleanWorkDir).toHaveBeenCalledWith(input.escalationId);
  });
});
