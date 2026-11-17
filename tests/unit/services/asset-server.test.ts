import { request } from 'node:http';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { assetUrl, startAssetServer, type AssetServer } from '../../../src/services/asset-server';
import { FRAME_BYTES } from '../../helpers/order-fixtures';
import { makeWorkDir, type TempWorkDir } from '../../helpers/temp-work-dir';

let work: TempWorkDir;
let server: AssetServer;
let base: string;

/** A file beside the work directory, which no request may reach. */
const outsideFile = () => `${work.path}-outside.txt`;

/** A request whose path goes out as written; fetch would normalize dot segments. */
function rawRequest(method: string, path: string): Promise<{ status: number; headers: Record<string, unknown>; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: server.port, method, path }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

beforeAll(async () => {
  work = await makeWorkDir();
  await work.writeAsset('esc-1', 'round-48.gcode.3mf', FRAME_BYTES);
  await work.writeAsset('esc-1', 'job prescription.json', '{}');
  await writeFile(outsideFile(), 'outside');
  await mkdir(join(work.path, 'esc-1', 'folder'));
  server = await startAssetServer(work.path, 0);
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(async () => {
  await server.close();
  await work.remove();
  await rm(outsideFile(), { force: true });
});

describe('assetUrl', () => {
  it('joins the base url, the escalation id and the file name', () => {
    expect(assetUrl('http://site.invalid:3001', 'esc-1', 'round-48.gcode.3mf')).toBe('http://site.invalid:3001/esc-1/round-48.gcode.3mf');
  });

  it('encodes both segments', () => {
    expect(assetUrl('http://site.invalid', 'esc/1', 'job prescription.json')).toBe('http://site.invalid/esc%2F1/job%20prescription.json');
  });
});

describe('startAssetServer', () => {
  it('listens on an ephemeral port and reports it', () => {
    expect(server.port).toBeGreaterThan(0);
  });

  it('serves a staged file with its length', async () => {
    const res = await fetch(assetUrl(base, 'esc-1', 'round-48.gcode.3mf'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
    expect(res.headers.get('content-length')).toBe(String(Buffer.byteLength(FRAME_BYTES)));
    expect(await res.text()).toBe(FRAME_BYTES);
  });

  it('answers 404 for a name with a space, which the work directory does not hold as a file name', async () => {
    const res = await fetch(assetUrl(base, 'esc-1', 'job prescription.json'));
    expect(res.status).toBe(404);
  });

  it('ignores the query string', async () => {
    const res = await fetch(`${assetUrl(base, 'esc-1', 'round-48.gcode.3mf')}?attempt=2`);
    expect(res.status).toBe(200);
  });

  it('answers HEAD with the headers and no body', async () => {
    const res = await rawRequest('HEAD', '/esc-1/round-48.gcode.3mf');
    expect(res.status).toBe(200);
    expect(res.headers['content-length']).toBe(String(Buffer.byteLength(FRAME_BYTES)));
    expect(res.body).toBe('');
  });

  it.each([
    ['a file that is not staged', '/esc-1/missing.stl'],
    ['an order that is not staged', '/esc-2/round-48.gcode.3mf'],
    ['a directory', '/esc-1/folder'],
    ['the root', '/'],
    ['one segment', '/esc-1'],
    ['three segments', '/esc-1/folder/round-48.gcode.3mf'],
  ])('answers 404 for %s', async (_what, path) => {
    expect((await rawRequest('GET', path)).status).toBe(404);
  });

  it.each([
    ['an encoded parent as the file name', '/esc-1/..%2F..%2Fetc%2Fpasswd'],
    ['a dot-dot order', '/%2E%2E/round-48.gcode.3mf'],
    ['a dot-dot file', '/esc-1/%2E%2E'],
    ['an encoded slash in the order', '/esc-1%2Fround-48.gcode.3mf/x'],
    ['a hidden file name', '/esc-1/.env'],
    ['a malformed escape', '/esc-1/%E0%A4%A'],
  ])('refuses path traversal: %s', async (_what, path) => {
    const res = await rawRequest('GET', path);
    expect(res.status).toBe(404);
    expect(res.body).toBe('');
  });

  it('does not serve a file outside the work directory', async () => {
    const outside = basename(outsideFile());
    expect((await rawRequest('GET', `/..%2F${outside}/x`)).status).toBe(404);
    expect((await rawRequest('GET', `/esc-1/..%2F..%2F${outside}`)).status).toBe(404);
    expect((await rawRequest('GET', `/../${outside}`)).status).toBe(404);
  });

  it.each(['POST', 'PUT', 'DELETE'])('answers 405 to %s', async (method) => {
    expect((await rawRequest(method, '/esc-1/round-48.gcode.3mf')).status).toBe(405);
  });

  it('rejects when the port is taken', async () => {
    await expect(startAssetServer(work.path, server.port)).rejects.toMatchObject({ code: 'EADDRINUSE' });
  });

  it('stops answering once closed', async () => {
    const second = await startAssetServer(work.path, 0);
    await second.close();
    await expect(fetch(`http://127.0.0.1:${second.port}/esc-1/round-48.gcode.3mf`)).rejects.toThrow();
  });
});
