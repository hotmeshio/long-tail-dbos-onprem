import { ApiRequestError } from '../../src/lib/api-request';

/** An ApiRequestError as requestApi throws it; no status means a timeout or network failure. */
export function apiError(status?: number, retryAfterSeconds?: number): ApiRequestError {
  const context = { url: 'http://cloud.invalid/api/test', method: 'POST', timeoutMs: 1000 };
  const what = status === undefined ? 'failed' : `returned ${status}`;
  return new ApiRequestError(`POST ${context.url} ${what}`, { status, retryAfterSeconds, context });
}
