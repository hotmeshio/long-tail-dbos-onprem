import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { sha256Of } from './order-fixtures';

export interface TempWorkDir {
  path: string;
  /** Write one file of one order and return what a checksum of it reads. */
  writeAsset(escalationId: string, name: string, content: string): Promise<{ path: string; sha256: string; size: number }>;
  remove(): Promise<void>;
}

/** A work directory under the system temp directory, removed by the test that made it. */
export async function makeWorkDir(): Promise<TempWorkDir> {
  const path = await mkdtemp(join(tmpdir(), 'site-work-'));
  return {
    path,
    async writeAsset(escalationId, name, content) {
      const dir = join(path, escalationId);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, name), content);
      return { path: join(dir, name), sha256: sha256Of(content), size: Buffer.byteLength(content) };
    },
    remove: () => rm(path, { recursive: true, force: true }),
  };
}
