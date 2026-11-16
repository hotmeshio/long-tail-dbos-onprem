import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { assetPath } from '../lib/work-dir';

export interface AssetServer {
  port: number;
  close(): Promise<void>;
}

const NOT_FOUND = 404;
const METHOD_NOT_ALLOWED = 405;

function end(res: ServerResponse, status: number): void {
  res.writeHead(status).end();
}

/** Where a machine fetches one staged file. */
export function assetUrl(baseUrl: string, escalationId: string, name: string): string {
  return `${baseUrl}/${encodeURIComponent(escalationId)}/${encodeURIComponent(name)}`;
}

/**
 * Serve staged files to machines on the LAN: GET or HEAD /<escalationId>/<name>.
 * Anything that is not one file of one order is a 404.
 */
export function startAssetServer(workDir: string, port: number): Promise<AssetServer> {
  const server: Server = createServer(async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return end(res, METHOD_NOT_ALLOWED);
    try {
      const segments = new URL(req.url ?? '/', 'http://site').pathname.split('/').filter(Boolean).map(decodeURIComponent);
      if (segments.length !== 2) return end(res, NOT_FOUND);
      const path = assetPath(workDir, segments[0], segments[1]);
      const info = await stat(path);
      if (!info.isFile()) return end(res, NOT_FOUND);
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': info.size });
      if (req.method === 'HEAD') return void res.end();
      createReadStream(path).on('error', () => res.destroy()).pipe(res);
    } catch {
      end(res, NOT_FOUND);
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => {
      resolve({
        port: (server.address() as AddressInfo).port,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}
