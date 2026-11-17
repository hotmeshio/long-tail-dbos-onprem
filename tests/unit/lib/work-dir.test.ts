import { resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { assetPath, hashFile, orderDir } from '../../../src/lib/work-dir';
import { sha256Of } from '../../helpers/order-fixtures';
import { makeWorkDir, type TempWorkDir } from '../../helpers/temp-work-dir';

describe('orderDir', () => {
  it('is the escalation id under the work directory', () => {
    expect(orderDir('/srv/work', 'esc-1')).toBe(resolve('/srv/work', 'esc-1'));
  });

  it.each(['..', '.', '', 'a/b', '../esc-1', '.hidden', 'esc 1'])('refuses "%s" as an escalation id', (id) => {
    expect(() => orderDir('/srv/work', id)).toThrow('escalation id is not a file name');
  });
});

describe('assetPath', () => {
  it('is the file name under the order directory', () => {
    expect(assetPath('/srv/work', 'esc-1', 'model.v2_final.stl')).toBe(resolve('/srv/work', 'esc-1', 'model.v2_final.stl'));
  });

  it('resolves a relative work directory', () => {
    expect(assetPath('./work', 'esc-1', 'round-48.gcode.3mf')).toBe(resolve('work', 'esc-1', 'round-48.gcode.3mf'));
  });

  it.each(['..', '../round-48.gcode.3mf', 'sub/round-48.gcode.3mf', '/etc/passwd', '', '.env'])('refuses "%s" as an asset name', (name) => {
    expect(() => assetPath('/srv/work', 'esc-1', name)).toThrow('asset name is not a file name');
  });

  it('refuses an escalation id that leaves the work directory', () => {
    expect(() => assetPath('/srv/work', '..', 'round-48.gcode.3mf')).toThrow('escalation id is not a file name');
  });
});

describe('hashFile', () => {
  let work: TempWorkDir;
  beforeAll(async () => { work = await makeWorkDir(); });
  afterAll(() => work.remove());

  it('returns the sha256 and the size of a file', async () => {
    const file = await work.writeAsset('esc-1', 'round-48.gcode.3mf', 'solid part');
    expect(await hashFile(file.path)).toEqual({ sha256: sha256Of('solid part'), size: 10 });
  });

  it('hashes an empty file', async () => {
    const file = await work.writeAsset('esc-1', 'empty.bin', '');
    expect(await hashFile(file.path)).toEqual({ sha256: sha256Of(''), size: 0 });
  });

  it('rejects for a file that is not there', async () => {
    await expect(hashFile(resolve(work.path, 'esc-1', 'missing.stl'))).rejects.toThrow('ENOENT');
  });
});
