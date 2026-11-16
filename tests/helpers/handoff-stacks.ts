import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { ApiRequestError, requestApi } from '../../src/lib/api-request';
import { ESCALATION_STATUS, ROLE, inspectionKey } from '../../src/modules/constants';

const run = promisify(execFile);

export const CLOUD_URL = process.env.CLOUD_URL_UNDER_TEST ?? 'http://localhost:3600';
export const SITE_URL = process.env.SITE_URL_UNDER_TEST ?? 'http://localhost:3700';
export const CLOUD_PROJECT = process.env.CLOUD_COMPOSE_PROJECT ?? 'long-tail-temporal-cloud';
export const SITE_PROJECT = process.env.SITE_COMPOSE_PROJECT ?? 'long-tail-dbos-onprem';
const ADMIN = { username: process.env.LT_ADMIN_USER ?? 'superadmin', password: process.env.LT_ADMIN_PASSWORD ?? 'l0ngt@1l' };
const CLOUD_ORDER_WORKFLOW = 'fabricationOrderRequest';
const APP_SERVICE = 'app';

export interface ApiReply<T = any> { status: number; data: T }
type Method = 'GET' | 'POST' | 'DELETE';
export type Caller = <T = any>(method: Method, path: string, body?: unknown) => Promise<ApiReply<T>>;

/** Sign in as the admin of one stack; the caller returns the status with the body. */
export async function signIn(url: string): Promise<Caller> {
  const { token } = await requestApi<{ token: string }>(url, { method: 'POST', path: '/api/auth/login', body: ADMIN });
  return async <T>(method: Method, path: string, body?: unknown) => {
    try {
      return { status: 200, data: await requestApi<T>(url, { method, path, token, body }) };
    } catch (err) {
      if (err instanceof ApiRequestError && err.status) return { status: err.status, data: err.body as T };
      throw err;
    }
  };
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

/** Start a cloud order; returns its workflow id and the id of the row it advertises. */
export async function startCloudOrder(cloud: Caller, orderId: string, extra: Record<string, unknown> = {}) {
  const workflowId = `order-${orderId}`;
  const started = await cloud('POST', `/api/workflows/${CLOUD_ORDER_WORKFLOW}/invoke`, {
    workflowId, data: { orderId, product: 'bracket', quantity: 2, ...extra },
  });
  if (started.status !== 200) throw new Error(`invoke failed: ${started.status} ${JSON.stringify(started.data)}`);
  const row = await waitFor('the cloud fabrication row', async () => {
    const { data } = await cloud('GET', `/api/escalations/by-workflow/${workflowId}`);
    return data.escalations?.find((candidate: any) => candidate.status === ESCALATION_STATUS.PENDING);
  });
  return { workflowId, escalationId: row.id as string };
}

export async function cloudResult(cloud: Caller, workflowId: string, timeoutMs = 60_000) {
  return waitFor('the cloud workflow result', async () => {
    const { data } = await cloud('GET', `/api/workflows/${workflowId}/result`);
    return data?.state === 'completed' ? data.result.data : undefined;
  }, timeoutMs);
}

/** The site's pending row of one role for an order. */
export async function sitePendingRow(site: Caller, role: string, orderId: string, timeoutMs = 60_000) {
  return waitFor(`a pending ${role} row for ${orderId}`, async () => {
    const { data } = await site('GET', `/api/escalations?status=${ESCALATION_STATUS.PENDING}&role=${role}&limit=100`);
    return data.escalations?.find((row: any) => row.metadata?.orderId === orderId);
  }, timeoutMs);
}

/** Wait for the printed order to reach inspection, then pass it. */
export async function passInspection(site: Caller, orderId: string, escalationId: string, units = 2) {
  await sitePendingRow(site, ROLE.INSPECTOR, orderId);
  return site('POST', '/api/escalations/resolve-by-signal-key', {
    signalKey: inspectionKey(escalationId), resolverPayload: { passed: true, units },
  });
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
