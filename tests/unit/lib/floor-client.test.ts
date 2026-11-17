import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiRequestError } from '../../../src/lib/api-request';
import { createFloorClient, signIn } from '../../../src/lib/floor-client';
import { ROLE } from '../../../src/modules/constants';
import { stubFetch } from '../../helpers/fetch-stub';

const BASE = 'http://site.invalid';
const TOKEN = 'token-1';
const BEARER = `Bearer ${TOKEN}`;
const ROW = { id: 'row-1', role: ROLE.FITTER, metadata: { orderId: 'A-1042' } };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('signIn', () => {
  it('posts the credentials and returns the token', async () => {
    const { calls } = stubFetch({ 'POST /api/auth/login': { body: { token: TOKEN } } });
    expect(await signIn(BASE, { username: 'ada', password: 'pw' })).toBe(TOKEN);
    expect(calls[0].body).toEqual({ username: 'ada', password: 'pw' });
  });

  it('throws a typed error when the sign-in is refused', async () => {
    stubFetch({ 'POST /api/auth/login': { status: 401, body: { error: 'bad credentials' } } });
    const err = await signIn(BASE, { username: 'ada', password: 'no' }).catch((caught: unknown) => caught);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect((err as ApiRequestError).status).toBe(401);
  });
});

describe('createFloorClient', () => {
  it('lists pending rows by facet with the caller token', async () => {
    const { calls } = stubFetch({ 'GET /api/escalations': { body: { escalations: [ROW] } } });
    const rows = await createFloorClient(BASE, TOKEN).pendingRows({ orderId: 'A-1042' });
    const query = new URL(calls[0].url).searchParams;
    expect(rows).toEqual([ROW]);
    expect(query.get('status')).toBe('pending');
    expect(JSON.parse(query.get('facets')!)).toEqual({ orderId: 'A-1042' });
    expect(query.get('limit')).toBe('50');
    expect(query.has('role')).toBe(false);
    expect(calls[0].authorization).toBe(BEARER);
  });

  it('narrows the list to one queue', async () => {
    const { calls } = stubFetch({ 'GET /api/escalations': { body: { escalations: [] } } });
    await createFloorClient(BASE, TOKEN).pendingRows({ orderId: 'A-1042' }, ROLE.FITTER);
    expect(new URL(calls[0].url).searchParams.get('role')).toBe(ROLE.FITTER);
  });

  it('returns an empty list when the reply carries no rows', async () => {
    stubFetch({ 'GET /api/escalations': { body: {} } });
    expect(await createFloorClient(BASE, TOKEN).pendingRows({ orderId: 'A-1042' })).toEqual([]);
  });

  it('claims a row, then submits its form', async () => {
    const { calls } = stubFetch({
      'POST /api/escalations/row-1/claim': { body: {} },
      'POST /api/escalations/row-1/resolve': { body: {} },
    });
    await createFloorClient(BASE, TOKEN).resolveRow('row-1', { received: true });
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual(['/api/escalations/row-1/claim', '/api/escalations/row-1/resolve']);
    expect(calls[0].body).toEqual({ durationMinutes: 5 });
    expect(calls[1].body).toEqual({ resolverPayload: { received: true } });
    expect(calls[1].authorization).toBe(BEARER);
  });

  it('leaves the row unresolved when the claim is refused', async () => {
    const { calls } = stubFetch({ 'POST /api/escalations/row-1/claim': { status: 409, body: { error: 'claimed' } } });
    await expect(createFloorClient(BASE, TOKEN).resolveRow('row-1', {})).rejects.toBeInstanceOf(ApiRequestError);
    expect(calls).toHaveLength(1);
  });

  it('adds an order to a bin and names the package row that closes with it', async () => {
    const { calls } = stubFetch({ 'POST /api/escalations/bin-row/accumulate': { body: {} } });
    await createFloorClient(BASE, TOKEN).placeInBin('bin-row', 'package-row', 'A-1042');
    expect(calls[0].body).toEqual({ itemKey: 'A-1042', reciprocal: { id: 'package-row' } });
  });

  it('throws a typed error when the bin refuses the order', async () => {
    stubFetch({ 'POST /api/escalations/bin-row/accumulate': { status: 422, body: { error: 'full' } } });
    const err = await createFloorClient(BASE, TOKEN).placeInBin('bin-row', 'package-row', 'A-1042').catch((caught: unknown) => caught);
    expect((err as ApiRequestError).status).toBe(422);
  });
});
