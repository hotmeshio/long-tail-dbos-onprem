import { describe, expect, it, vi } from 'vitest';

import { executeWithRetry, isRetryable, retryDelayMs } from '../../../../src/lib/cloud-client/retry';
import type { RetryPolicy } from '../../../../src/lib/cloud-client/types';
import { apiError } from '../../../helpers/api-error-fixture';

const POLICY: RetryPolicy = { retries: 2, baseDelayMs: 100, maxDelayMs: 1000 };
const noSleep = () => vi.fn(async (_ms: number) => undefined);

describe('isRetryable', () => {
  it.each([undefined, 500, 503, 429])('retries status %s', (status) => {
    expect(isRetryable(apiError(status))).toBe(true);
  });

  it.each([400, 401, 404, 409, 422])('takes status %s as an answer', (status) => {
    expect(isRetryable(apiError(status))).toBe(false);
  });

  it('does not retry an error of another kind', () => {
    expect(isRetryable(new Error('boom'))).toBe(false);
    expect(isRetryable('boom')).toBe(false);
  });
});

describe('retryDelayMs', () => {
  it('doubles from the base delay', () => {
    expect([1, 2, 3].map((attempt) => retryDelayMs(apiError(503), attempt, POLICY))).toEqual([100, 200, 400]);
  });

  it('caps the computed delay', () => {
    expect(retryDelayMs(apiError(503), 10, POLICY)).toBe(1000);
  });

  it('uses Retry-After when the server gives one', () => {
    expect(retryDelayMs(apiError(429, 0.5), 1, POLICY)).toBe(500);
    expect(retryDelayMs(apiError(429, 0), 3, POLICY)).toBe(0);
  });

  it('caps Retry-After too', () => {
    expect(retryDelayMs(apiError(429, 60), 1, POLICY)).toBe(1000);
  });
});

describe('executeWithRetry', () => {
  it('returns the first success without sleeping', async () => {
    const sleep = noSleep();
    expect(await executeWithRetry(async () => 'done', POLICY, sleep)).toBe('done');
    expect(sleep).not.toHaveBeenCalled();
  });

  it('succeeds after a transient failure', async () => {
    const sleep = noSleep();
    const op = vi.fn<() => Promise<string>>().mockRejectedValueOnce(apiError(503)).mockRejectedValueOnce(apiError()).mockResolvedValue('done');
    expect(await executeWithRetry(op, POLICY, sleep)).toBe('done');
    expect(op).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[100], [200]]);
  });

  it('throws the last error once the retries are used', async () => {
    const sleep = noSleep();
    const last = apiError(502);
    const op = vi.fn<() => Promise<string>>().mockRejectedValueOnce(apiError(500)).mockRejectedValueOnce(apiError(500)).mockRejectedValue(last);
    await expect(executeWithRetry(op, POLICY, sleep)).rejects.toBe(last);
    expect(op).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('waits what a 429 asks for', async () => {
    const sleep = noSleep();
    const op = vi.fn<() => Promise<string>>().mockRejectedValueOnce(apiError(429, 0.7)).mockResolvedValue('done');
    await executeWithRetry(op, POLICY, sleep);
    expect(sleep.mock.calls).toEqual([[700]]);
  });

  it('never waits longer than the cap', async () => {
    const sleep = noSleep();
    const op = vi.fn<() => Promise<string>>().mockRejectedValue(apiError(503));
    await expect(executeWithRetry(op, { retries: 6, baseDelayMs: 100, maxDelayMs: 300 }, sleep)).rejects.toThrow();
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([100, 200, 300, 300, 300, 300]);
  });

  it('throws a non-retryable error at once', async () => {
    const sleep = noSleep();
    const refused = apiError(422);
    const op = vi.fn<() => Promise<string>>().mockRejectedValue(refused);
    await expect(executeWithRetry(op, POLICY, sleep)).rejects.toBe(refused);
    expect(op).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('runs once when the policy allows no retries', async () => {
    const op = vi.fn<() => Promise<string>>().mockRejectedValue(apiError(503));
    await expect(executeWithRetry(op, { ...POLICY, retries: 0 }, noSleep())).rejects.toThrow();
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('sleeps on a real timer by default', async () => {
    vi.useFakeTimers();
    try {
      const op = vi.fn<() => Promise<string>>().mockRejectedValueOnce(apiError(503)).mockResolvedValue('done');
      const run = executeWithRetry(op, POLICY);
      await vi.advanceTimersByTimeAsync(99);
      expect(op).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(await run).toBe('done');
    } finally {
      vi.useRealTimers();
    }
  });
});
