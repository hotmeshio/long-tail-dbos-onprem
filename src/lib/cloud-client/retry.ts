import { ApiRequestError } from '../api-request';
import type { RetryPolicy } from './types';

const TOO_MANY_REQUESTS = 429;

/** A network failure, a timeout, a 5xx or a 429 may pass on a second try; any other status is an answer. */
export function isRetryable(err: unknown): boolean {
  if (!(err instanceof ApiRequestError)) return false;
  return err.status === undefined || err.status >= 500 || err.status === TOO_MANY_REQUESTS;
}

/** Doubling from the base, or the server's Retry-After, never above the cap. */
export function retryDelayMs(err: unknown, attempt: number, policy: RetryPolicy): number {
  const asked = err instanceof ApiRequestError ? err.retryAfterSeconds : undefined;
  const delay = asked !== undefined ? asked * 1000 : policy.baseDelayMs * 2 ** (attempt - 1);
  return Math.min(delay, policy.maxDelayMs);
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Run `op`, retrying retryable failures up to `policy.retries` more times. */
export async function executeWithRetry<T>(op: () => Promise<T>, policy: RetryPolicy, sleep: (ms: number) => Promise<void> = pause): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await op();
    } catch (err) {
      if (attempt > policy.retries || !isRetryable(err)) throw err;
      await sleep(retryDelayMs(err, attempt, policy));
    }
  }
}
