import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiRequestError } from '../../../../src/lib/api-request';
import { downloadFile } from '../../../../src/lib/cloud-client/download';
import { stubFetch } from '../../../helpers/fetch-stub';
import { MODEL_BYTES, sha256Of } from '../../../helpers/order-fixtures';
import { makeWorkDir, type TempWorkDir } from '../../../helpers/temp-work-dir';

const LINK = 'http://files.invalid/orders/1/model.stl';
const SIGNED = `${LINK}?signature=secret`;
const ROUTE = 'GET /orders/1/model.stl';

let work: TempWorkDir;
let dest: string;

async function failure(run: Promise<unknown>): Promise<ApiRequestError> {
  const err = await run.then(() => undefined, (caught: unknown) => caught);
  expect(err).toBeInstanceOf(ApiRequestError);
  return err as ApiRequestError;
}

beforeEach(async () => {
  work = await makeWorkDir();
  dest = join(work.path, 'esc-1', 'model.stl');
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await work.remove();
});

describe('downloadFile', () => {
  it('writes the file, creating its directory, and returns its checksum and size', async () => {
    stubFetch({ [ROUTE]: { text: MODEL_BYTES, contentType: 'model/stl' } });
    const got = await downloadFile(SIGNED, dest, 1000);
    expect(got).toEqual({ sha256: sha256Of(MODEL_BYTES), size: Buffer.byteLength(MODEL_BYTES) });
    expect(await readFile(dest, 'utf8')).toBe(MODEL_BYTES);
  });

  it('leaves no partial file after success', async () => {
    stubFetch({ [ROUTE]: { text: MODEL_BYTES } });
    await downloadFile(SIGNED, dest, 1000);
    expect(await readdir(join(work.path, 'esc-1'))).toEqual(['model.stl']);
  });

  it('replaces a file already at the destination', async () => {
    await work.writeAsset('esc-1', 'model.stl', 'stale');
    stubFetch({ [ROUTE]: { text: MODEL_BYTES } });
    await downloadFile(SIGNED, dest, 1000);
    expect(await readFile(dest, 'utf8')).toBe(MODEL_BYTES);
  });

  it('requests the full signed link', async () => {
    const { calls } = stubFetch({ [ROUTE]: { text: MODEL_BYTES } });
    await downloadFile(SIGNED, dest, 1000);
    expect(calls).toEqual([{ method: 'GET', url: SIGNED, body: undefined, authorization: undefined }]);
  });

  it('throws a typed error with the status and body for a non-2xx answer', async () => {
    stubFetch({ [ROUTE]: { status: 403, text: 'link expired', contentType: 'text/plain' } });
    const err = await failure(downloadFile(SIGNED, dest, 1000));
    expect(err.status).toBe(403);
    expect(err.body).toBe('link expired');
    expect(existsSync(dest)).toBe(false);
  });

  it('names the path only, never the signature', async () => {
    stubFetch({ [ROUTE]: { status: 500, text: 'boom' } });
    const err = await failure(downloadFile(SIGNED, dest, 1000));
    expect(err.context).toEqual({ url: LINK, method: 'GET', timeoutMs: 1000 });
    expect(err.message).toBe(`GET ${LINK} returned 500`);
    expect(err.message).not.toContain('secret');
  });

  it('keeps the network error as the cause and has no status', async () => {
    const cause = new TypeError('fetch failed');
    stubFetch({ [ROUTE]: cause });
    const err = await failure(downloadFile(SIGNED, dest, 1000));
    expect(err.status).toBeUndefined();
    expect(err.cause).toBe(cause);
    expect(err.message).toBe(`GET ${LINK} failed`);
  });

  it('aborts at the timeout and says so', async () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      signal = init.signal ?? undefined;
      signal?.addEventListener('abort', () => reject(signal?.reason));
    })));
    const err = await failure(downloadFile(SIGNED, dest, 10));
    expect(signal?.aborted).toBe(true);
    expect(err.status).toBeUndefined();
    expect(err.message).toBe(`GET ${LINK} timed out after 10ms`);
  });

  it('removes the partial file when the stream breaks, leaving the destination absent', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('half')); },
      pull(controller) { controller.error(new Error('connection reset')); },
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body)));
    const err = await failure(downloadFile(SIGNED, dest, 1000));
    expect((err.cause as Error).message).toBe('connection reset');
    expect(await readdir(join(work.path, 'esc-1'))).toEqual([]);
  });
});
