import { readFile } from 'node:fs/promises';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiRequestError } from '../../../../src/lib/api-request';
import type { CloudFile } from '../../../../src/lib/cloud-client';
import { ASSET } from '../../../../src/modules/constants';
import { stageAssets } from '../../../../src/services/intake/stage';
import { fakeCloudClient } from '../../../helpers/fake-cloud-client';
import { stubFetch } from '../../../helpers/fetch-stub';
import { MODEL_BYTES, orderData, sha256Of } from '../../../helpers/order-fixtures';
import { makeWorkDir, type TempWorkDir } from '../../../helpers/temp-work-dir';

const TICKET_BYTES = 'ticket for order-1001';
const modelFile: CloudFile = { as: ASSET.MODEL, path: 'orders/1/model.stl', name: 'model.stl', url: 'http://files.invalid/model.stl?signature=secret' };
const ticketFile: CloudFile = { as: ASSET.TICKET, path: 'orders/1/ticket.pdf', name: 'ticket.pdf', url: 'http://files.invalid/ticket.pdf?signature=secret' };
const ticketAsset = { as: ASSET.TICKET, sha256: sha256Of(TICKET_BYTES), size: Buffer.byteLength(TICKET_BYTES) };
const routes = { 'GET /model.stl': { text: MODEL_BYTES }, 'GET /ticket.pdf': { text: TICKET_BYTES } };

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
    const cloud = fakeCloudClient({ files: async () => [modelFile] });
    await stageAssets(cloud, 'esc-1', orderData(), { workDir: work.path, timeoutMs: 1000 });
    expect(cloud.files).toHaveBeenCalledWith('esc-1');
  });

  it('downloads each declared asset under its file name and returns it staged', async () => {
    const { calls } = stubFetch(routes);
    const order = orderData({ assets: [...orderData().assets, ticketAsset] });
    const staged = await stage([ticketFile, modelFile], order);
    expect(staged).toEqual([{ ...order.assets[0], name: 'model.stl' }, { ...ticketAsset, name: 'ticket.pdf' }]);
    expect(await readFile(`${work.path}/esc-1/model.stl`, 'utf8')).toBe(MODEL_BYTES);
    expect(await readFile(`${work.path}/esc-1/ticket.pdf`, 'utf8')).toBe(TICKET_BYTES);
    expect(calls.map((call) => call.url)).toEqual([modelFile.url, ticketFile.url]);
  });

  it('ignores cloud files the order does not declare', async () => {
    const { calls } = stubFetch(routes);
    const staged = await stage([modelFile, ticketFile]);
    expect(staged.map((asset) => asset.as)).toEqual([ASSET.MODEL]);
    expect(calls).toHaveLength(1);
  });

  it('keeps a file already on disk and intact', async () => {
    const { mock } = stubFetch({});
    await work.writeAsset('esc-1', 'model.stl', MODEL_BYTES);
    const staged = await stage([{ ...modelFile, url: undefined }]);
    expect(staged).toEqual([{ ...orderData().assets[0], name: 'model.stl' }]);
    expect(mock).not.toHaveBeenCalled();
  });

  it('downloads again over a file that does not match', async () => {
    stubFetch(routes);
    await work.writeAsset('esc-1', 'model.stl', 'half a mod');
    await stage([modelFile]);
    expect(await readFile(`${work.path}/esc-1/model.stl`, 'utf8')).toBe(MODEL_BYTES);
  });

  it('throws when the cloud lists no file for a declared asset', async () => {
    stubFetch(routes);
    await expect(stage([ticketFile])).rejects.toThrow(`order order-1001: the cloud lists no "${ASSET.MODEL}" file`);
  });

  it('throws with the reason the cloud gave when a file has no link', async () => {
    await expect(stage([{ ...modelFile, url: undefined, error: 'object not found' }])).rejects.toThrow(`order order-1001: no link for "${ASSET.MODEL}": object not found`);
    await expect(stage([{ ...modelFile, url: undefined }])).rejects.toThrow('none given');
  });

  it('throws when the bytes that arrive do not match the declared checksum', async () => {
    stubFetch({ 'GET /model.stl': { text: 'another model' } });
    await expect(stage([modelFile])).rejects.toThrow(`"${ASSET.MODEL}" arrived as ${sha256Of('another model')}, the order declares ${sha256Of(MODEL_BYTES)}`);
  });

  it('passes a download failure to the caller as the typed error', async () => {
    stubFetch({ 'GET /model.stl': { status: 403, text: 'expired', contentType: 'text/plain' } });
    const err = await stage([modelFile]).catch((caught: unknown) => caught);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect((err as ApiRequestError).status).toBe(403);
  });

  it.each(['../model.stl', 'sub/model.stl', '..'])('refuses the cloud file name "%s"', async (name) => {
    const { mock } = stubFetch(routes);
    await expect(stage([{ ...modelFile, name }])).rejects.toThrow('asset name is not a file name');
    expect(mock).not.toHaveBeenCalled();
  });

  it('refuses an escalation id that is not a file name', async () => {
    const cloud = fakeCloudClient({ files: async () => [modelFile] });
    await expect(stageAssets(cloud, '../esc-1', orderData(), { workDir: work.path, timeoutMs: 1000 })).rejects.toThrow('escalation id is not a file name');
  });
});
