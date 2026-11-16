import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { cleanWorkDir, verifyAssets } from '../../../src/activities/assets';
import { ASSET } from '../../../src/modules/constants';
import type { StagedAsset } from '../../../src/types/fabrication';
import { MODEL_BYTES, sha256Of } from '../../helpers/order-fixtures';
import { makeWorkDir, type TempWorkDir } from '../../helpers/temp-work-dir';

let work: TempWorkDir;
let model: StagedAsset;
const earlier = process.env.WORK_DIR;

beforeEach(async () => {
  work = await makeWorkDir();
  process.env.WORK_DIR = work.path;
  const file = await work.writeAsset('esc-1', 'model.stl', MODEL_BYTES);
  model = { as: ASSET.MODEL, name: 'model.stl', sha256: file.sha256, size: file.size };
});

afterEach(async () => {
  if (earlier === undefined) delete process.env.WORK_DIR;
  else process.env.WORK_DIR = earlier;
  await work.remove();
});

describe('verifyAssets', () => {
  it('verifies files that match their checksum and size', async () => {
    const ticket = await work.writeAsset('esc-1', 'ticket.pdf', 'ticket');
    const assets = [model, { as: ASSET.TICKET, name: 'ticket.pdf', sha256: ticket.sha256, size: ticket.size }];
    expect(await verifyAssets('esc-1', assets)).toEqual({ verified: true });
  });

  it('verifies an order with no assets', async () => {
    expect(await verifyAssets('esc-1', [])).toEqual({ verified: true });
  });

  it('fails for a file that is not on disk, naming it', async () => {
    const check = await verifyAssets('esc-1', [{ ...model, name: 'missing.stl' }]);
    expect(check.verified).toBe(false);
    expect(check.detail).toContain("missing.stl is not on the site's disk");
  });

  it('fails for an order whose directory is gone', async () => {
    const check = await verifyAssets('esc-2', [model]);
    expect(check).toMatchObject({ verified: false, detail: expect.stringContaining('model.stl is not on the site') });
  });

  it('fails when the bytes on disk changed', async () => {
    await work.writeAsset('esc-1', 'model.stl', MODEL_BYTES.replace('solid', 'sol1d'));
    expect(await verifyAssets('esc-1', [model])).toEqual({ verified: false, detail: 'model.stl does not match the checksum the order declares' });
  });

  it('fails when the size differs from the one declared', async () => {
    const check = await verifyAssets('esc-1', [{ ...model, size: model.size + 1 }]);
    expect(check).toEqual({ verified: false, detail: 'model.stl does not match the checksum the order declares' });
  });

  it('stops at the first file that fails', async () => {
    const assets = [{ ...model, sha256: sha256Of('other') }, { ...model, name: 'missing.stl' }];
    expect((await verifyAssets('esc-1', assets)).detail).toContain('model.stl does not match');
  });

  it('fails, without reading it, for a name that leaves the order directory', async () => {
    const check = await verifyAssets('esc-1', [{ ...model, name: '../esc-1/model.stl' }]);
    expect(check).toMatchObject({ verified: false, detail: expect.stringContaining('asset name is not a file name') });
  });
});

describe('cleanWorkDir', () => {
  it('removes the files of one order and leaves the others', async () => {
    await work.writeAsset('esc-2', 'model.stl', MODEL_BYTES);
    await cleanWorkDir('esc-1');
    expect(existsSync(join(work.path, 'esc-1'))).toBe(false);
    expect(existsSync(join(work.path, 'esc-2', 'model.stl'))).toBe(true);
  });

  it('does nothing for an order with no directory', async () => {
    await expect(cleanWorkDir('esc-9')).resolves.toBeUndefined();
    expect(existsSync(join(work.path, 'esc-1', 'model.stl'))).toBe(true);
  });

  it.each(['..', '.', 'esc-1/..', ''])('refuses "%s", which is not one order', async (id) => {
    await expect(cleanWorkDir(id)).rejects.toThrow('escalation id is not a file name');
    expect(existsSync(join(work.path, 'esc-1', 'model.stl'))).toBe(true);
  });
});
