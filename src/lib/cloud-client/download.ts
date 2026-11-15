import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { ApiRequestError } from '../api-request';

export interface Downloaded {
  sha256: string;
  size: number;
}

/**
 * Stream a signed link to `dest` and return what arrived. The file appears
 * under its name only when complete: it is written beside it and renamed.
 */
export async function downloadFile(url: string, dest: string, timeoutMs: number): Promise<Downloaded> {
  // The link carries a signature in its query, so errors name the path only.
  const context = { url: url.split('?')[0], method: 'GET', timeoutMs };
  const partial = `${dest}.part`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const hash = createHash('sha256');
  let size = 0;
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok || !res.body) {
      throw new ApiRequestError(`GET ${context.url} returned ${res.status}`, { status: res.status, body: await res.text().catch(() => undefined), context });
    }
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        hash.update(chunk);
        size += chunk.length;
        done(null, chunk);
      },
    });
    await mkdir(dirname(dest), { recursive: true });
    await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), meter, createWriteStream(partial));
    await rename(partial, dest);
    return { sha256: hash.digest('hex'), size };
  } catch (err) {
    await rm(partial, { force: true });
    if (err instanceof ApiRequestError) throw err;
    const what = controller.signal.aborted ? `timed out after ${timeoutMs}ms` : 'failed';
    throw new ApiRequestError(`GET ${context.url} ${what}`, { context, cause: err });
  } finally {
    clearTimeout(timer);
  }
}
