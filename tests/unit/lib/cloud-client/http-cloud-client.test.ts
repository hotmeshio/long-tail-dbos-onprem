import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiRequestError } from '../../../../src/lib/api-request';
import { HttpCloudClient } from '../../../../src/lib/cloud-client/http-cloud-client';
import { ESCALATION_STATUS } from '../../../../src/modules/constants';
import { stubFetch } from '../../../helpers/fetch-stub';
import { INTAKE_ROLE, cloudRow } from '../../../helpers/order-fixtures';

const URL_BASE = 'http://cloud.invalid';
const CREDENTIALS = { apiKey: 'lt_bot_test', botId: 'bot-test' };
const AUTH = `Bearer ${CREDENTIALS.apiKey}`;
const LIST = '/api/escalations';

function makeClient(overrides: Partial<ConstructorParameters<typeof HttpCloudClient>[0]> = {}) {
  const sleep = vi.fn(async (_ms: number) => undefined);
  const credentials = vi.fn(async () => CREDENTIALS);
  const client = new HttpCloudClient({
    url: URL_BASE, credentials, timeoutMs: 1000, sleep,
    retry: { retries: 2, baseDelayMs: 10, maxDelayMs: 50 },
    ...overrides,
  });
  return { client, sleep, credentials };
}

afterEach(() => vi.unstubAllGlobals());

describe('HttpCloudClient constructor', () => {
  it('throws without a url, naming the env var', () => {
    expect(() => makeClient({ url: '' })).toThrow('CLOUD_URL');
  });

  it.each([0, -1])('throws for a timeout of %s', (timeoutMs) => {
    expect(() => makeClient({ timeoutMs })).toThrow();
  });

  it('throws for a negative retry count', () => {
    expect(() => makeClient({ retry: { retries: -1, baseDelayMs: 10, maxDelayMs: 50 } })).toThrow();
  });
});

describe('HttpCloudClient', () => {
  it('reports the bot id of its credentials', async () => {
    expect(await makeClient().client.botId()).toBe(CREDENTIALS.botId);
  });

  it('claims by role with one POST and returns the claimed rows', async () => {
    const rows = [cloudRow({ id: 'esc-1' }), cloudRow({ id: 'esc-2' })];
    const { calls } = stubFetch({ 'POST /api/escalations/claim-by-facets': { body: { claimed: rows } } });
    const claimed = await makeClient().client.claim({ role: INTAKE_ROLE, limit: 5, durationMinutes: 60 });
    expect(claimed).toEqual(rows);
    expect(calls).toEqual([{
      method: 'POST', url: `${URL_BASE}/api/escalations/claim-by-facets`, authorization: AUTH,
      body: { query: { role: INTAKE_ROLE }, limit: 5, durationMinutes: 60 },
    }]);
  });

  it('lists its own pending rows, one page', async () => {
    const rows = [cloudRow({ id: 'esc-1' })];
    const { calls } = stubFetch({ [`GET ${LIST}`]: { body: { escalations: rows, total: 1 } } });
    expect(await makeClient().client.listClaimed()).toEqual(rows);
    expect(calls).toHaveLength(1);
    expect(calls[0].authorization).toBe(AUTH);
    const query = new URL(calls[0].url).searchParams;
    expect(Object.fromEntries(query)).toEqual({ assigned_to: CREDENTIALS.botId, status: ESCALATION_STATUS.PENDING, limit: '100', offset: '0' });
  });

  it('pages until it holds every row', async () => {
    const first = [cloudRow({ id: 'esc-1' }), cloudRow({ id: 'esc-2' })];
    const second = [cloudRow({ id: 'esc-3' })];
    const { calls } = stubFetch({ [`GET ${LIST}`]: [{ body: { escalations: first, total: 3 } }, { body: { escalations: second, total: 3 } }] });
    const held = await makeClient().client.listClaimed();
    expect(held.map((row) => row.id)).toEqual(['esc-1', 'esc-2', 'esc-3']);
    expect(calls.map((call) => new URL(call.url).searchParams.get('offset'))).toEqual(['0', '2']);
  });

  it('stops paging at an empty page', async () => {
    const { calls } = stubFetch({ [`GET ${LIST}`]: [{ body: { escalations: [cloudRow()], total: 5 } }, { body: { escalations: [], total: 5 } }] });
    expect(await makeClient().client.listClaimed()).toHaveLength(1);
    expect(calls).toHaveLength(2);
  });

  it('reads the files of a row', async () => {
    const files = [{ as: 'model', path: 'orders/1/model.stl', name: 'model.stl', url: 'http://files.invalid/model.stl?sig=1' }];
    const { calls } = stubFetch({ 'GET /api/escalations/esc%2F1/files': { body: { files } } });
    expect(await makeClient().client.files('esc/1')).toEqual(files);
    expect(calls).toEqual([{ method: 'GET', url: `${URL_BASE}/api/escalations/esc%2F1/files`, body: undefined, authorization: AUTH }]);
  });

  it('reads one row in full', async () => {
    const row = cloudRow({ id: 'esc-9' });
    const { calls } = stubFetch({ 'GET /api/escalations/esc-9': { body: row } });
    expect(await makeClient().client.read('esc-9')).toEqual(row);
    expect(calls).toEqual([{ method: 'GET', url: `${URL_BASE}/api/escalations/esc-9`, body: undefined, authorization: AUTH }]);
  });

  it('resolves by signal key with the outcome as the resolver payload', async () => {
    const { calls } = stubFetch({ 'POST /api/escalations/resolve-by-signal-key': { body: { ok: true } } });
    const outcome = { completed: true, units: 2, site: 'site-1' };
    await makeClient().client.resolve('fabricate-order-1001', outcome);
    expect(calls).toEqual([{
      method: 'POST', url: `${URL_BASE}/api/escalations/resolve-by-signal-key`, authorization: AUTH,
      body: { signalKey: 'fabricate-order-1001', resolverPayload: outcome },
    }]);
  });

  it('retries a server error and then succeeds', async () => {
    const row = cloudRow();
    const { calls } = stubFetch({ 'GET /api/escalations/esc-1': [{ status: 503, text: 'down', contentType: 'text/plain' }, { body: row }] });
    const { client, sleep } = makeClient();
    expect(await client.read('esc-1')).toEqual(row);
    expect(calls).toHaveLength(2);
    expect(sleep.mock.calls).toEqual([[10]]);
  });

  it('throws the typed error once the retries are used', async () => {
    const { calls } = stubFetch({ 'GET /api/escalations/esc-1': { status: 500, body: { error: 'boom' } } });
    const { client, sleep } = makeClient();
    const err = await client.read('esc-1').catch((caught: unknown) => caught);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect((err as ApiRequestError).status).toBe(500);
    expect(calls).toHaveLength(3);
    expect(sleep.mock.calls).toEqual([[10], [20]]);
  });

  it('does not retry a conflict', async () => {
    const { calls } = stubFetch({ 'POST /api/escalations/resolve-by-signal-key': { status: 409, body: { error: 'already resolved' } } });
    const { client, sleep } = makeClient();
    await expect(client.resolve('fabricate-order-1001', {})).rejects.toMatchObject({ status: 409, body: { error: 'already resolved' } });
    expect(calls).toHaveLength(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('passes a credentials failure to the caller without a request', async () => {
    const { mock } = stubFetch({});
    const { client } = makeClient({ credentials: async () => { throw new Error('sign-in failed'); } });
    await expect(client.read('esc-1')).rejects.toThrow('sign-in failed');
    expect(mock).not.toHaveBeenCalled();
  });
});
