import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function assertSegment(what: string, value: string): void {
  if (!SEGMENT.test(value)) throw new Error(`${what} is not a file name: "${value}"`);
}

/** The directory one claimed order keeps its files in. */
export function orderDir(workDir: string, escalationId: string): string {
  assertSegment('escalation id', escalationId);
  return resolve(workDir, escalationId);
}

/** One file of a claimed order. Ids and names are single path segments, so the path stays inside the work directory. */
export function assetPath(workDir: string, escalationId: string, name: string): string {
  assertSegment('asset name', name);
  const path = resolve(orderDir(workDir, escalationId), name);
  if (!path.startsWith(resolve(workDir) + sep)) throw new Error(`asset path leaves the work directory: "${name}"`);
  return path;
}

export async function hashFile(path: string): Promise<{ sha256: string; size: number }> {
  const hash = createHash('sha256');
  let size = 0;
  await pipeline(createReadStream(path), async (chunks) => {
    for await (const chunk of chunks) {
      hash.update(chunk as Buffer);
      size += (chunk as Buffer).length;
    }
  });
  return { sha256: hash.digest('hex'), size };
}
