import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { ApiRequestError, requestApi } from '../../src/lib/api-request';
import { createFloorClient, signIn as signInTo, type FloorClient, type FloorRow } from '../../src/lib/floor-client';
import { CLOUD_ROLE, ESCALATION_STATUS, ROLE } from '../../src/modules/constants';

const run = promisify(execFile);

export const CLOUD_URL = process.env.CLOUD_URL_UNDER_TEST ?? 'http://localhost:3600';
export const SITE_URL = process.env.SITE_URL_UNDER_TEST ?? 'http://localhost:3700';
export const CLOUD_PROJECT = process.env.CLOUD_COMPOSE_PROJECT ?? 'long-tail-temporal-cloud';
export const SITE_PROJECT = process.env.SITE_COMPOSE_PROJECT ?? 'long-tail-dbos-onprem';
const ADMIN = { username: process.env.LT_ADMIN_USER ?? 'superadmin', password: process.env.LT_ADMIN_PASSWORD ?? 'l0ngt@1l' };
const CLOUD_ORDER_WORKFLOW = 'eyeglassOrderRequest';
const APP_SERVICE = 'app';
const UNLOADED = { unitsGood: 1, unitsScrap: 0 };
const FITTED = { received: true };

export interface ApiReply<T = any> { status: number; data: T }
type Method = 'GET' | 'POST' | 'DELETE';
export type Caller = <T = any>(method: Method, path: string, body?: unknown) => Promise<ApiReply<T>>;
export interface Stack { call: Caller; floor: FloorClient }

/** Sign in as the admin of one stack. `call` returns the status with the body. */
export async function signIn(url: string): Promise<Stack> {
  const token = await signInTo(url, ADMIN);
  const call: Caller = async <T>(method: Method, path: string, body?: unknown) => {
    try {
      return { status: 200, data: await requestApi<T>(url, { method, path, token, body }) };
    } catch (err) {
      if (err instanceof ApiRequestError && err.status) return { status: err.status, data: err.body as T };
      throw err;
    }
  };
  return { call, floor: createFloorClient(url, token) };
}

export async function waitFor<T>(what: string, read: () => Promise<T | undefined | null | false>, timeoutMs = 60_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read().catch(() => undefined);
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

export function uniqueOrderId(): string {
  return `T-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** A pending row of one queue for an order, on either stack. */
export function pendingRow(stack: Stack, role: string, orderId: string, timeoutMs = 60_000): Promise<FloorRow> {
  return waitFor(`a pending ${role} row for ${orderId}`, async () => (await stack.floor.pendingRows({ orderId }, role))[0], timeoutMs);
}

/** Start a cloud order; returns its workflow id and the id of the row the site claims. */
export async function startCloudOrder(cloud: Stack, orderId: string, extra: Record<string, unknown> = {}) {
  const workflowId = `order-${orderId}`;
  const started = await cloud.call('POST', `/api/workflows/${CLOUD_ORDER_WORKFLOW}/invoke`, { workflowId, data: { orderId, ...extra } });
  if (started.status !== 200) throw new Error(`invoke failed: ${started.status} ${JSON.stringify(started.data)}`);
  const row = await pendingRow(cloud, CLOUD_ROLE.PRODUCTION, orderId);
  return { workflowId, escalationId: row.id };
}

export async function cloudRowStatus(cloud: Stack, escalationId: string, status: string, timeoutMs = 60_000): Promise<string> {
  return waitFor(`cloud row ${escalationId} to be ${status}`, async () => {
    const { data } = await cloud.call('GET', `/api/escalations/${escalationId}`);
    return data?.status === status ? status : undefined;
  }, timeoutMs);
}

export async function cloudResult(cloud: Stack, workflowId: string, timeoutMs = 60_000) {
  return waitFor('the cloud workflow result', async () => {
    const { data } = await cloud.call('GET', `/api/workflows/${workflowId}/result`);
    return data?.state === 'completed' ? data.result.data : undefined;
  }, timeoutMs);
}

/** Take the printed frame off its printer. */
export async function unloadFrame(site: Stack, orderId: string): Promise<void> {
  const row = await pendingRow(site, ROLE.PRINT_UNLOAD, orderId);
  await site.floor.resolveRow(row.id, UNLOADED);
}

/** Do the final fit, then scan the boxed order into its bin. */
export async function fitAndPack(site: Stack, orderId: string): Promise<void> {
  const fit = await pendingRow(site, ROLE.FITTER, orderId);
  await site.floor.resolveRow(fit.id, FITTED);
  const boxed = await pendingRow(site, ROLE.PACKAGE, orderId);
  const binKey = String(boxed.metadata?.binKey);
  const bin = await waitFor(`the open bin ${binKey}`, async () => (await site.floor.pendingRows({ binKey }, ROLE.BIN))[0]);
  await site.floor.placeInBin(bin.id, boxed.id, orderId);
}

async function compose(project: string, ...args: string[]): Promise<void> {
  await run('docker', ['compose', '-p', project, ...args]);
}

export async function restartSite(): Promise<void> {
  await compose(SITE_PROJECT, 'restart', APP_SERVICE);
  await waitFor('the site to answer', async () => (await fetch(`${SITE_URL}/health`)).ok);
}

export const pauseCloud = () => compose(CLOUD_PROJECT, 'pause', APP_SERVICE);
export const resumeCloud = () => compose(CLOUD_PROJECT, 'unpause', APP_SERVICE);
export const RESOLVED = ESCALATION_STATUS.RESOLVED;
