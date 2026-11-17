import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { cleanWorkDir, verifyAssets } from '../../../src/activities/assets';
import { ASSET } from '../../../src/modules/constants';
import type { StagedAsset } from '../../../src/types/production';
import { FRAME_BYTES, sha256Of } from '../../helpers/order-fixtures';
import { makeWorkDir, type TempWorkDir } from '../../helpers/temp-work-dir';

let work: TempWorkDir;
let model: StagedAsset;
const earlier = process.env.WORK_DIR;

beforeEach(async () => {
  work = await makeWorkDir();
  process.env.WORK_DIR = work.path;
  const file = await work.writeAsset('esc-1', 'round-48.gcode.3mf', FRAME_BYTES);
  model = { as: ASSET.FRAME, name: 'round-48.gcode.3mf', sha256: file.sha256, size: file.size };
});

afterEach(async () => {
  if (earlier === undefined) delete process.env.WORK_DIR;
  else process.env.WORK_DIR = earlier;
  await work.remove();
});

describe('verifyAssets', () => {
  it('verifies files that match their checksum and size', async () => {
    const prescription = await work.writeAsset('esc-1', 'prescription.json', '{}');
    const assets = [model, { as: ASSET.PRESCRIPTION, name: 'prescription.json', sha256: prescription.sha256, size: prescription.size }];
    expect(await verifyAssets('esc-1', assets)).toEqual({ verified: true });
  });

  it('verifies an order with no assets', async () => {
    expect(await verifyAssets('esc-1', [])).toEqual({ verified: true });
  });

  it('fails for a file that is not on disk, naming it', async () => {
    const check = await verifyAssets('esc-1', [{ ...model, name: 'missing.gcode.3mf' }]);
    expect(check.verified).toBe(false);
    expect(check.detail).toContain("missing.gcode.3mf is not on the site's disk");
  });

  it('fails for an order whose directory is gone', async () => {
    const check = await verifyAssets('esc-2', [model]);
    expect(check).toMatchObject({ verified: false, detail: expect.stringContaining('round-48.gcode.3mf is not on the site') });
  });

  it('fails when the bytes on disk changed', async () => {
    await work.writeAsset('esc-1', 'round-48.gcode.3mf', FRAME_BYTES.replace('G28', 'G29'));
    expect(await verifyAssets('esc-1', [model])).toEqual({ verified: false, detail: 'round-48.gcode.3mf does not match the checksum the order declares' });
  });

  it('fails when the size differs from the one declared', async () => {
    const check = await verifyAssets('esc-1', [{ ...model, size: model.size + 1 }]);
    expect(check).toEqual({ verified: false, detail: 'round-48.gcode.3mf does not match the checksum the order declares' });
  });

  it('stops at the first file that fails', async () => {
    const assets = [{ ...model, sha256: sha256Of('other') }, { ...model, name: 'missing.gcode.3mf' }];
    expect((await verifyAssets('esc-1', assets)).detail).toContain('round-48.gcode.3mf does not match');
  });

  it('fails, without reading it, for a name that leaves the order directory', async () => {
    const check = await verifyAssets('esc-1', [{ ...model, name: '../esc-1/round-48.gcode.3mf' }]);
    expect(check).toMatchObject({ verified: false, detail: expect.stringContaining('asset name is not a file name') });
  });
});

describe('cleanWorkDir', () => {
  it('removes the files of one order and leaves the others', async () => {
    await work.writeAsset('esc-2', 'round-48.gcode.3mf', FRAME_BYTES);
    await cleanWorkDir('esc-1');
    expect(existsSync(join(work.path, 'esc-1'))).toBe(false);
    expect(existsSync(join(work.path, 'esc-2', 'round-48.gcode.3mf'))).toBe(true);
  });

  it('does nothing for an order with no directory', async () => {
    await expect(cleanWorkDir('esc-9')).resolves.toBeUndefined();
    expect(existsSync(join(work.path, 'esc-1', 'round-48.gcode.3mf'))).toBe(true);
  });

  it.each(['..', '.', 'esc-1/..', ''])('refuses "%s", which is not one order', async (id) => {
    await expect(cleanWorkDir(id)).rejects.toThrow('escalation id is not a file name');
    expect(existsSync(join(work.path, 'esc-1', 'round-48.gcode.3mf'))).toBe(true);
  });
});
