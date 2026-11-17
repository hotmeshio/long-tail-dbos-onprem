import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/services/intake/stage', () => ({ stageAssets: vi.fn() }));

import { LOG_EVENTS } from '../../../../src/modules/constants';
import { runIntakeOnce, type ProductionRuns, type IntakeOptions } from '../../../../src/services/intake';
import { stageAssets } from '../../../../src/services/intake/stage';
import { apiError } from '../../../helpers/api-error-fixture';
import { fakeCloudClient, type FakeCloudClient } from '../../../helpers/fake-cloud-client';
import { spyOnLog } from '../../../helpers/log-spy';
import { INTAKE_ROLE, cloudRow, orderData } from '../../../helpers/order-fixtures';

const stage = vi.mocked(stageAssets);
const STAGED = orderData().assets.map((asset) => ({ ...asset, name: 'round-48.gcode.3mf' }));
// A list row carries no data; the full row comes from cloud.read.
const listed = (id: string, overrides = {}) => cloudRow({ id, escalation_payload: null, ...overrides });

let cloud: FakeCloudClient;
let runs: { has: ReturnType<typeof vi.fn<ProductionRuns['has']>>; start: ReturnType<typeof vi.fn<ProductionRuns['start']>> };
let logged: ReturnType<typeof spyOnLog>;
const options = (): IntakeOptions => ({ cloud, runs, role: INTAKE_ROLE, batch: 5, claimMinutes: 60, workDir: '/srv/work', downloadTimeoutMs: 1000 });

beforeEach(() => {
  cloud = fakeCloudClient();
  runs = { has: vi.fn(async () => false), start: vi.fn(async () => undefined) };
  stage.mockReset().mockResolvedValue(STAGED);
  logged = spyOnLog();
});

afterEach(() => vi.restoreAllMocks());

describe('runIntakeOnce', () => {
  it('claims by role, batch and claim duration', async () => {
    await runIntakeOnce(options());
    expect(cloud.claim).toHaveBeenCalledWith({ role: INTAKE_ROLE, limit: 5, durationMinutes: 60 });
  });

  it('does nothing more when the site holds nothing', async () => {
    expect(await runIntakeOnce(options())).toEqual({ claimed: 0, started: [], skipped: [] });
    expect(logged.spy).not.toHaveBeenCalled();
    expect(runs.start).not.toHaveBeenCalled();
  });

  it('claims, then starts each held order with its staged assets', async () => {
    cloud.claim.mockResolvedValue([listed('esc-1')]);
    cloud.listClaimed.mockResolvedValue([listed('esc-1')]);
    const pass = await runIntakeOnce(options());
    expect(pass).toEqual({ claimed: 1, started: ['esc-1'], skipped: [] });
    expect(stage).toHaveBeenCalledWith(cloud, 'esc-1', orderData(), { workDir: '/srv/work', timeoutMs: 1000 });
    expect(runs.start).toHaveBeenCalledWith({ ...orderData(), escalationId: 'esc-1', assets: STAGED });
    expect(cloud.claim.mock.invocationCallOrder[0]).toBeLessThan(cloud.listClaimed.mock.invocationCallOrder[0]);
    expect(stage.mock.invocationCallOrder[0]).toBeLessThan(runs.start.mock.invocationCallOrder[0]);
  });

  it('logs the claim and each start with named events', async () => {
    cloud.claim.mockResolvedValue([listed('esc-1'), listed('esc-2')]);
    cloud.listClaimed.mockResolvedValue([listed('esc-1')]);
    await runIntakeOnce(options());
    expect(logged.contexts(LOG_EVENTS.INTAKE_CLAIMED)).toEqual([{ count: 2, escalationIds: ['esc-1', 'esc-2'] }]);
    expect(logged.contexts(LOG_EVENTS.INTAKE_ORDER_STARTED)).toEqual([{ escalationId: 'esc-1', orderId: 'A-1042' }]);
  });

  it('starts an order held from an earlier pass that claimed nothing new', async () => {
    cloud.listClaimed.mockResolvedValue([listed('esc-1')]);
    expect(await runIntakeOnce(options())).toEqual({ claimed: 0, started: ['esc-1'], skipped: [] });
    expect(logged.contexts(LOG_EVENTS.INTAKE_CLAIMED)).toEqual([]);
  });

  it('skips a held row that already has a run, without reading or staging it', async () => {
    cloud.listClaimed.mockResolvedValue([listed('esc-1'), listed('esc-2')]);
    runs.has.mockImplementation(async (id) => id === 'esc-1');
    const pass = await runIntakeOnce(options());
    expect(pass).toEqual({ claimed: 0, started: ['esc-2'], skipped: [] });
    expect(cloud.read.mock.calls).toEqual([['esc-2']]);
    expect(stage).toHaveBeenCalledTimes(1);
  });

  it('ignores a row of another role', async () => {
    cloud.listClaimed.mockResolvedValue([listed('esc-1', { role: 'assembly' })]);
    expect(await runIntakeOnce(options())).toEqual({ claimed: 0, started: [], skipped: [] });
    expect(runs.has).not.toHaveBeenCalled();
    expect(cloud.read).not.toHaveBeenCalled();
  });

  it('reads the full row before reading the order from it', async () => {
    cloud.listClaimed.mockResolvedValue([listed('esc-1')]);
    cloud.read.mockResolvedValue(cloudRow({ id: 'esc-1', escalation_payload: JSON.stringify(orderData({ orderId: 'order-2002' })) }));
    await runIntakeOnce(options());
    expect(cloud.read).toHaveBeenCalledWith('esc-1');
    expect(runs.start).toHaveBeenCalledWith(expect.objectContaining({ orderId: 'order-2002', escalationId: 'esc-1' }));
  });

  it('skips and logs a bad row, and the pass continues', async () => {
    cloud.listClaimed.mockResolvedValue([listed('esc-1'), listed('esc-2')]);
    cloud.read.mockImplementation(async (id) => cloudRow({ id, escalation_payload: id === 'esc-1' ? '{}' : JSON.stringify(orderData()) }));
    const pass = await runIntakeOnce(options());
    expect(pass).toEqual({ claimed: 0, started: ['esc-2'], skipped: ['esc-1'] });
    expect(logged.contexts(LOG_EVENTS.INTAKE_ORDER_SKIPPED)).toEqual([
      { escalationId: 'esc-1', error: 'escalation esc-1 is not a production order: orderId is missing' },
    ]);
    expect(runs.start).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['the run lookup fails', () => runs.has.mockRejectedValueOnce(new Error('database is down')), 'database is down'],
    ['the row cannot be read', () => cloud.read.mockRejectedValueOnce(apiError(503)), 'returned 503'],
    ['staging fails', () => stage.mockRejectedValueOnce(new Error('checksum mismatch')), 'checksum mismatch'],
    ['the run cannot start', () => runs.start.mockRejectedValueOnce(new Error('queue is full')), 'queue is full'],
    ['something that is not an Error is thrown', () => stage.mockRejectedValueOnce('disk full'), 'disk full'],
  ])('skips the order when %s and goes on to the next', async (_what, arrange, error) => {
    cloud.listClaimed.mockResolvedValue([listed('esc-1'), listed('esc-2')]);
    arrange();
    const pass = await runIntakeOnce(options());
    expect(pass).toEqual({ claimed: 0, started: ['esc-2'], skipped: ['esc-1'] });
    expect(logged.contexts(LOG_EVENTS.INTAKE_ORDER_SKIPPED)).toEqual([{ escalationId: 'esc-1', error: expect.stringContaining(error) }]);
    expect(logged.contexts(LOG_EVENTS.INTAKE_ORDER_STARTED)).toHaveLength(1);
  });

  it('does not start an order whose staging failed', async () => {
    cloud.listClaimed.mockResolvedValue([listed('esc-1')]);
    stage.mockRejectedValue(new Error('checksum mismatch'));
    await runIntakeOnce(options());
    expect(runs.start).not.toHaveBeenCalled();
  });

  it('throws when the claim fails, before listing', async () => {
    cloud.claim.mockRejectedValue(apiError(503));
    await expect(runIntakeOnce(options())).rejects.toMatchObject({ status: 503 });
    expect(cloud.listClaimed).not.toHaveBeenCalled();
  });

  it('throws when the held rows cannot be listed', async () => {
    cloud.listClaimed.mockRejectedValue(apiError());
    await expect(runIntakeOnce(options())).rejects.toThrow();
  });
});
