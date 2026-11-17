import { readFile } from 'node:fs/promises';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiRequestError } from '../../../../src/lib/api-request';
import type { CloudFile } from '../../../../src/lib/cloud-client';
import { ASSET } from '../../../../src/modules/constants';
import { stageAssets } from '../../../../src/services/intake/stage';
import { fakeCloudClient } from '../../../helpers/fake-cloud-client';
import { stubFetch } from '../../../helpers/fetch-stub';
import { FRAME_BYTES, orderData, sha256Of } from '../../../helpers/order-fixtures';
import { makeWorkDir, type TempWorkDir } from '../../../helpers/temp-work-dir';

const PRESCRIPTION_BYTES = '{"pd":63}';
const frameFile: CloudFile = { as: ASSET.FRAME, path: 'orders/1/round-48.gcode.3mf', name: 'round-48.gcode.3mf', url: 'http://files.invalid/round-48.gcode.3mf?signature=secret' };
const prescriptionFile: CloudFile = { as: ASSET.PRESCRIPTION, path: 'orders/1/prescription.json', name: 'prescription.json', url: 'http://files.invalid/prescription.json?signature=secret' };
const prescriptionAsset = { as: ASSET.PRESCRIPTION, sha256: sha256Of(PRESCRIPTION_BYTES), size: Buffer.byteLength(PRESCRIPTION_BYTES) };
const routes = { 'GET /round-48.gcode.3mf': { text: FRAME_BYTES }, 'GET /prescription.json': { text: PRESCRIPTION_BYTES } };

let work: TempWorkDir;
const stage = (files: CloudFile[], order = orderData()) =>
  stageAssets(fakeCloudClient({ files: async () => files }), 'esc-1', order, { workDir: work.path, timeoutMs: 1000 });

beforeEach(async () => { work = await makeWorkDir(); });
afterEach(async () => {
  vi.unstubAllGlobals();
  await work.remove();
});

describe('stageAssets', () => {
  it('asks the cloud for the files of the row', async () => {
    stubFetch(routes);
    const cloud = fakeCloudClient({ files: async () => [frameFile] });
    await stageAssets(cloud, 'esc-1', orderData(), { workDir: work.path, timeoutMs: 1000 });
    expect(cloud.files).toHaveBeenCalledWith('esc-1');
  });

  it('downloads each declared asset under its file name and returns it staged', async () => {
    const { calls } = stubFetch(routes);
    const order = orderData({ assets: [...orderData().assets, prescriptionAsset] });
    const staged = await stage([prescriptionFile, frameFile], order);
    expect(staged).toEqual([{ ...order.assets[0], name: 'round-48.gcode.3mf' }, { ...prescriptionAsset, name: 'prescription.json' }]);
    expect(await readFile(`${work.path}/esc-1/round-48.gcode.3mf`, 'utf8')).toBe(FRAME_BYTES);
    expect(await readFile(`${work.path}/esc-1/prescription.json`, 'utf8')).toBe(PRESCRIPTION_BYTES);
    expect(calls.map((call) => call.url)).toEqual([frameFile.url, prescriptionFile.url]);
  });

  it('ignores cloud files the order does not declare', async () => {
    const { calls } = stubFetch(routes);
    const staged = await stage([frameFile, prescriptionFile]);
    expect(staged.map((asset) => asset.as)).toEqual([ASSET.FRAME]);
    expect(calls).toHaveLength(1);
  });

  it('keeps a file already on disk and intact', async () => {
    const { mock } = stubFetch({});
    await work.writeAsset('esc-1', 'round-48.gcode.3mf', FRAME_BYTES);
    const staged = await stage([{ ...frameFile, url: undefined }]);
    expect(staged).toEqual([{ ...orderData().assets[0], name: 'round-48.gcode.3mf' }]);
    expect(mock).not.toHaveBeenCalled();
  });

  it('downloads again over a file that does not match', async () => {
    stubFetch(routes);
    await work.writeAsset('esc-1', 'round-48.gcode.3mf', 'half a mod');
    await stage([frameFile]);
    expect(await readFile(`${work.path}/esc-1/round-48.gcode.3mf`, 'utf8')).toBe(FRAME_BYTES);
  });

  it('throws when the cloud lists no file for a declared asset', async () => {
    stubFetch(routes);
    await expect(stage([prescriptionFile])).rejects.toThrow(`order A-1042: the cloud lists no "${ASSET.FRAME}" file`);
  });

  it('throws with the reason the cloud gave when a file has no link', async () => {
    await expect(stage([{ ...frameFile, url: undefined, error: 'object not found' }])).rejects.toThrow(`order A-1042: no link for "${ASSET.FRAME}": object not found`);
    await expect(stage([{ ...frameFile, url: undefined }])).rejects.toThrow('none given');
  });

  it('throws when the bytes that arrive do not match the declared checksum', async () => {
    stubFetch({ 'GET /round-48.gcode.3mf': { text: 'another frame' } });
    await expect(stage([frameFile])).rejects.toThrow(`"${ASSET.FRAME}" arrived as ${sha256Of('another frame')}, the order declares ${sha256Of(FRAME_BYTES)}`);
  });

  it('passes a download failure to the caller as the typed error', async () => {
    stubFetch({ 'GET /round-48.gcode.3mf': { status: 403, text: 'expired', contentType: 'text/plain' } });
    const err = await stage([frameFile]).catch((caught: unknown) => caught);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect((err as ApiRequestError).status).toBe(403);
  });

  it.each(['../round-48.gcode.3mf', 'sub/round-48.gcode.3mf', '..'])('refuses the cloud file name "%s"', async (name) => {
    const { mock } = stubFetch(routes);
    await expect(stage([{ ...frameFile, name }])).rejects.toThrow('asset name is not a file name');
    expect(mock).not.toHaveBeenCalled();
  });

  it('refuses an escalation id that is not a file name', async () => {
    const cloud = fakeCloudClient({ files: async () => [frameFile] });
    await expect(stageAssets(cloud, '../esc-1', orderData(), { workDir: work.path, timeoutMs: 1000 })).rejects.toThrow('escalation id is not a file name');
  });
});
