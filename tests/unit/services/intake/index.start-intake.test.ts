import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/services/intake/stage', () => ({ stageAssets: vi.fn(async () => []) }));

import { LOG_EVENTS } from '../../../../src/modules/constants';
import { startIntake, type IntakeOptions } from '../../../../src/services/intake';
import { apiError } from '../../../helpers/api-error-fixture';
import { fakeCloudClient, type FakeCloudClient } from '../../../helpers/fake-cloud-client';
import { spyOnLog } from '../../../helpers/log-spy';
import { INTAKE_ROLE, cloudRow } from '../../../helpers/order-fixtures';

const POLL_MS = 1000;
let cloud: FakeCloudClient;
let logged: ReturnType<typeof spyOnLog>;
const runs = { has: vi.fn(async () => false), start: vi.fn(async () => undefined) };
const options = (): IntakeOptions & { pollMs: number } => ({
  cloud, runs, role: INTAKE_ROLE, batch: 5, claimMinutes: 60, workDir: '/srv/work', downloadTimeoutMs: 1000, pollMs: POLL_MS,
});

beforeEach(() => {
  vi.useFakeTimers();
  cloud = fakeCloudClient();
  logged = spyOnLog();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('startIntake', () => {
  it('logs the start and runs a pass at once', async () => {
    const intake = startIntake(options());
    expect(logged.contexts(LOG_EVENTS.INTAKE_STARTED)).toEqual([{ role: INTAKE_ROLE, pollMs: POLL_MS }]);
    expect(cloud.claim).toHaveBeenCalledTimes(1);
    await intake.stop();
  });

  it('runs the next pass one poll interval after the last one ends', async () => {
    const intake = startIntake(options());
    await vi.advanceTimersByTimeAsync(POLL_MS - 1);
    expect(cloud.claim).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(cloud.claim).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(cloud.claim).toHaveBeenCalledTimes(5);
    await intake.stop();
  });

  it('runs one pass at a time', async () => {
    let release: (rows: never[]) => void = () => undefined;
    cloud.claim.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const intake = startIntake(options());
    await vi.advanceTimersByTimeAsync(POLL_MS * 5);
    expect(cloud.claim).toHaveBeenCalledTimes(1);
    release([]);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(cloud.claim).toHaveBeenCalledTimes(2);
    await intake.stop();
  });

  it.each([[undefined], [500], [503]])('logs an unreachable cloud for status %s and tries again', async (status) => {
    cloud.claim.mockRejectedValueOnce(apiError(status));
    const intake = startIntake(options());
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(logged.contexts(LOG_EVENTS.INTAKE_CLOUD_UNREACHABLE)).toEqual([{ error: expect.any(String) }]);
    expect(logged.contexts(LOG_EVENTS.INTAKE_FAILED)).toEqual([]);
    expect(cloud.claim).toHaveBeenCalledTimes(2);
    await intake.stop();
  });

  it.each([
    ['a refused request', apiError(403), 'returned 403'],
    ['an error of another kind', new Error('bad state'), 'bad state'],
    ['a thrown value', 'boom', 'boom'],
  ])('logs %s as a failed pass and tries again', async (_what, thrown, error) => {
    cloud.claim.mockRejectedValueOnce(thrown);
    const intake = startIntake(options());
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(logged.contexts(LOG_EVENTS.INTAKE_FAILED)).toEqual([{ error: expect.stringContaining(error) }]);
    expect(logged.contexts(LOG_EVENTS.INTAKE_CLOUD_UNREACHABLE)).toEqual([]);
    expect(cloud.claim).toHaveBeenCalledTimes(2);
    await intake.stop();
  });

  it('starts held orders on a later pass', async () => {
    const intake = startIntake(options());
    await vi.advanceTimersByTimeAsync(0);
    expect(logged.contexts(LOG_EVENTS.INTAKE_ORDER_STARTED)).toHaveLength(0);
    cloud.listClaimed.mockResolvedValue([cloudRow({ id: 'esc-1' })]);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(logged.contexts(LOG_EVENTS.INTAKE_ORDER_STARTED)).toHaveLength(1);
    await intake.stop();
  });

  it('runs no pass after stop', async () => {
    const intake = startIntake(options());
    await vi.advanceTimersByTimeAsync(0);
    await intake.stop();
    await vi.advanceTimersByTimeAsync(POLL_MS * 5);
    expect(cloud.claim).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stop waits for the pass in flight and schedules nothing after it', async () => {
    let release: (rows: never[]) => void = () => undefined;
    cloud.claim.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const intake = startIntake(options());
    let stopped = false;
    const stopping = intake.stop().then(() => { stopped = true; });
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(stopped).toBe(false);
    release([]);
    await stopping;
    expect(stopped).toBe(true);
    expect(cloud.listClaimed).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
