import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiRequestError } from '../../../src/lib/api-request';
import { issueBotKey, type BotSpec } from '../../../src/services/bot-key';
import { ROLE_TYPE } from '../../../src/modules/constants';
import { stubFetch } from '../../helpers/fetch-stub';
import { INTAKE_ROLE } from '../../helpers/order-fixtures';

const URL_BASE = 'http://cloud.invalid';
const ADMIN = { username: 'admin', password: 'pw' };
const BOT_SPEC: BotSpec = { name: 'fabrication-site-1', description: 'Site bot', roles: [{ role: INTAKE_ROLE, type: ROLE_TYPE.MEMBER }] };
const KEYS = '/api/bot-accounts/bot-1/api-keys';
const FAST = { attempts: 3, delayMs: 1 };

type Routes = Parameters<typeof stubFetch>[0];
const routes = (overrides: Routes = {}): Routes => ({
  'POST /api/auth/login': { body: { token: 'admin-token' } },
  'GET /api/bot-accounts': { body: { bots: [{ id: 'bot-1', external_id: BOT_SPEC.name }] } },
  'POST /api/bot-accounts': { status: 201, body: { id: 'bot-new', external_id: BOT_SPEC.name } },
  [`POST ${KEYS}`]: { status: 201, body: { id: 'key-2', rawKey: 'lt_bot_fresh' } },
  [`GET ${KEYS}`]: { body: { keys: [{ id: 'key-2' }] } },
  ...overrides,
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('issueBotKey', () => {
  it('signs in with the admin login and no token', async () => {
    const { calls } = stubFetch(routes());
    await issueBotKey(URL_BASE, ADMIN, BOT_SPEC, FAST);
    expect(calls[0]).toEqual({ method: 'POST', url: `${URL_BASE}/api/auth/login`, body: ADMIN, authorization: undefined });
  });

  it('finds the bot by name and returns its id with the new key', async () => {
    const { calls } = stubFetch(routes());
    expect(await issueBotKey(URL_BASE, ADMIN, BOT_SPEC, FAST)).toEqual({ botId: 'bot-1', apiKey: 'lt_bot_fresh' });
    expect(calls.map((call) => `${call.method} ${new URL(call.url).pathname}`)).toEqual([
      'POST /api/auth/login', 'GET /api/bot-accounts', `POST ${KEYS}`, `GET ${KEYS}`,
    ]);
    expect(new URL(calls[1].url).searchParams.get('search')).toBe(BOT_SPEC.name);
    expect(calls.slice(1).every((call) => call.authorization === 'Bearer admin-token')).toBe(true);
  });

  it('names the key after the bot and the time', async () => {
    vi.useFakeTimers({ now: 1_900_000_000_000 });
    const { calls } = stubFetch(routes());
    await issueBotKey(URL_BASE, ADMIN, BOT_SPEC, FAST);
    expect(calls[2].body).toEqual({ name: `${BOT_SPEC.name}-1900000000000` });
  });

  it('creates the bot when the search finds only near matches', async () => {
    const newKeys = '/api/bot-accounts/bot-new/api-keys';
    const { calls } = stubFetch(routes({
      'GET /api/bot-accounts': { body: [{ id: 'bot-9', external_id: `${BOT_SPEC.name}0` }] },
      [`POST ${newKeys}`]: { body: { id: 'key-1', rawKey: 'lt_bot_first' } },
      [`GET ${newKeys}`]: { body: [{ id: 'key-1' }] },
    }));
    expect(await issueBotKey(URL_BASE, ADMIN, BOT_SPEC, FAST)).toEqual({ botId: 'bot-new', apiKey: 'lt_bot_first' });
    expect(calls[2]).toMatchObject({ method: 'POST', url: `${URL_BASE}/api/bot-accounts`, body: BOT_SPEC });
  });

  it('revokes every earlier key and keeps the new one', async () => {
    const { calls } = stubFetch(routes({
      [`GET ${KEYS}`]: { body: { keys: [{ id: 'key-0' }, { id: 'key-1' }, { id: 'key-2' }] } },
      [`DELETE ${KEYS}/key-0`]: { status: 204 },
      [`DELETE ${KEYS}/key-1`]: { status: 204 },
    }));
    await issueBotKey(URL_BASE, ADMIN, BOT_SPEC, FAST);
    const deleted = calls.filter((call) => call.method === 'DELETE').map((call) => new URL(call.url).pathname);
    expect(deleted).toEqual([`${KEYS}/key-0`, `${KEYS}/key-1`]);
  });

  it('waits for the API to come up before signing in', async () => {
    const { calls } = stubFetch(routes({
      'POST /api/auth/login': [new TypeError('fetch failed'), { status: 503, text: 'starting', contentType: 'text/plain' }, { body: { token: 'admin-token' } }],
    }));
    expect((await issueBotKey(URL_BASE, ADMIN, BOT_SPEC, FAST)).apiKey).toBe('lt_bot_fresh');
    expect(calls.filter((call) => call.url.endsWith('/api/auth/login'))).toHaveLength(3);
  });

  it('gives up after the attempts allowed, with the last error', async () => {
    const { calls } = stubFetch(routes({ 'POST /api/auth/login': { status: 502, text: 'bad gateway', contentType: 'text/plain' } }));
    await expect(issueBotKey(URL_BASE, ADMIN, BOT_SPEC, FAST)).rejects.toMatchObject({ status: 502 });
    expect(calls).toHaveLength(3);
  });

  it('does not retry a rejected login', async () => {
    const { calls } = stubFetch(routes({ 'POST /api/auth/login': { status: 401, body: { error: 'bad password' } } }));
    const err = await issueBotKey(URL_BASE, ADMIN, BOT_SPEC, FAST).catch((caught: unknown) => caught);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect((err as ApiRequestError).status).toBe(401);
    expect(calls).toHaveLength(1);
  });

  it('waits the default delay between sign-in attempts', async () => {
    vi.useFakeTimers();
    const { calls } = stubFetch(routes({ 'POST /api/auth/login': [new TypeError('fetch failed'), { body: { token: 'admin-token' } }] }));
    const run = issueBotKey(URL_BASE, ADMIN, BOT_SPEC);
    await vi.advanceTimersByTimeAsync(1999);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await run).botId).toBe('bot-1');
  });

  it('passes a failure after sign-in to the caller', async () => {
    stubFetch(routes({ [`POST ${KEYS}`]: { status: 403, body: { error: 'not allowed' } } }));
    await expect(issueBotKey(URL_BASE, ADMIN, BOT_SPEC, FAST)).rejects.toMatchObject({ status: 403, body: { error: 'not allowed' } });
  });
});
