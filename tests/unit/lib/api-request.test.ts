import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiRequestError, requestApi } from '../../../src/lib/api-request';
import { stubFetch } from '../../helpers/fetch-stub';

const BASE = 'http://cloud.invalid';

async function failure(run: Promise<unknown>): Promise<ApiRequestError> {
  const err = await run.then(() => undefined, (caught: unknown) => caught);
  expect(err).toBeInstanceOf(ApiRequestError);
  return err as ApiRequestError;
}

function stubResponse(body: string, init: ResponseInit) {
  const mock = vi.fn(async () => new Response(body, init));
  vi.stubGlobal('fetch', mock);
  return mock;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('requestApi', () => {
  it('parses a 2xx JSON body', async () => {
    stubFetch({ 'GET /api/things': { body: { things: [1, 2] } } });
    const body = await requestApi<{ things: number[] }>(BASE, { method: 'GET', path: '/api/things' });
    expect(body).toEqual({ things: [1, 2] });
  });

  it('returns a non-JSON body as a string', async () => {
    stubFetch({ 'GET /health': { text: 'ok', contentType: 'text/plain' } });
    expect(await requestApi<string>(BASE, { method: 'GET', path: '/health' })).toBe('ok');
  });

  it('returns undefined for an empty body', async () => {
    stubFetch({ 'DELETE /api/things/1': { status: 204 } });
    expect(await requestApi(BASE, { method: 'DELETE', path: '/api/things/1' })).toBeUndefined();
  });

  it('sends the method, the JSON body and the bearer token', async () => {
    const { calls, mock } = stubFetch({ 'POST /api/things': { body: { id: 'a' } } });
    await requestApi(BASE, { method: 'POST', path: '/api/things', token: 'lt_bot_test', body: { name: 'a' } });
    expect(calls).toEqual([{ method: 'POST', url: `${BASE}/api/things`, body: { name: 'a' }, authorization: 'Bearer lt_bot_test' }]);
    const init = mock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
  });

  it('sends no authorization header and no body when none is given', async () => {
    const { calls, mock } = stubFetch({ 'GET /api/things': { body: {} } });
    await requestApi(BASE, { method: 'GET', path: '/api/things' });
    expect(calls[0].authorization).toBeUndefined();
    expect(mock.mock.calls[0][1]).not.toHaveProperty('body');
  });

  it('throws a typed error with status, body and context for a non-2xx status', async () => {
    stubFetch({ 'POST /api/things': { status: 422, body: { error: 'bad name' } } });
    const err = await failure(requestApi(BASE, { method: 'POST', path: '/api/things', body: {}, timeoutMs: 500 }));
    expect(err.name).toBe('ApiRequestError');
    expect(err.status).toBe(422);
    expect(err.body).toEqual({ error: 'bad name' });
    expect(err.context).toEqual({ url: `${BASE}/api/things`, method: 'POST', timeoutMs: 500 });
    expect(err.message).toContain('returned 422');
  });

  it('keeps a non-JSON error body as text and uses the default timeout', async () => {
    stubFetch({ 'GET /api/things': { status: 502, text: 'bad gateway', contentType: 'text/html' } });
    const err = await failure(requestApi(BASE, { method: 'GET', path: '/api/things' }));
    expect(err.status).toBe(502);
    expect(err.body).toBe('bad gateway');
    expect(err.context.timeoutMs).toBe(15_000);
    expect(err.retryAfterSeconds).toBeUndefined();
  });

  it('reads Retry-After in seconds', async () => {
    stubResponse('{"error":"slow down"}', { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '7' } });
    const err = await failure(requestApi(BASE, { method: 'GET', path: '/api/things' }));
    expect(err.status).toBe(429);
    expect(err.retryAfterSeconds).toBe(7);
  });

  it('reads Retry-After as a date', async () => {
    vi.useFakeTimers({ now: new Date('2030-01-01T00:00:00Z') });
    stubResponse('', { status: 503, headers: { 'retry-after': 'Tue, 01 Jan 2030 00:00:30 GMT' } });
    const err = await failure(requestApi(BASE, { method: 'GET', path: '/api/things' }));
    expect(err.retryAfterSeconds).toBe(30);
  });

  it('ignores a Retry-After it cannot read and never returns a negative wait', async () => {
    stubResponse('', { status: 503, headers: { 'retry-after': 'soon' } });
    expect((await failure(requestApi(BASE, { method: 'GET', path: '/a' }))).retryAfterSeconds).toBeUndefined();
    stubResponse('', { status: 503, headers: { 'retry-after': '-5' } });
    expect((await failure(requestApi(BASE, { method: 'GET', path: '/a' }))).retryAfterSeconds).toBe(0);
  });

  it('aborts the request at the timeout and throws an error with no status', async () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      signal = init.signal ?? undefined;
      signal?.addEventListener('abort', () => reject(signal?.reason));
    })));
    const err = await failure(requestApi(BASE, { method: 'GET', path: '/api/slow', timeoutMs: 10 }));
    expect(signal?.aborted).toBe(true);
    expect(err.status).toBeUndefined();
    expect(err.body).toBeUndefined();
    expect(err.message).toContain('timed out after 10ms');
    expect(err.context).toEqual({ url: `${BASE}/api/slow`, method: 'GET', timeoutMs: 10 });
    expect(err.cause).toBe(signal?.reason);
  });

  it('keeps the network error as the cause', async () => {
    const cause = new TypeError('fetch failed');
    stubFetch({ 'GET /api/things': cause });
    const err = await failure(requestApi(BASE, { method: 'GET', path: '/api/things' }));
    expect(err.status).toBeUndefined();
    expect(err.cause).toBe(cause);
    expect(err.message).toBe(`GET ${BASE}/api/things failed`);
  });

  it('clears the timeout timer after success and after failure', async () => {
    vi.useFakeTimers();
    stubFetch({ 'GET /ok': { body: {} }, 'GET /down': new Error('down') });
    await requestApi(BASE, { method: 'GET', path: '/ok' });
    await failure(requestApi(BASE, { method: 'GET', path: '/down' }));
    expect(vi.getTimerCount()).toBe(0);
  });
});
