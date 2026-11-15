import { requestApi, type ApiRequest } from '../api-request';
import { ESCALATION_STATUS } from '../../modules/constants';
import { executeWithRetry } from './retry';
import type { ClaimQuery, CloudClient, CloudCredentials, CloudEscalation, CloudFile, RetryPolicy } from './types';

export interface HttpCloudClientOptions {
  url: string;
  /** Resolved on each call, so a site that boots offline signs in once the cloud answers. */
  credentials: () => Promise<CloudCredentials>;
  retry: RetryPolicy;
  timeoutMs: number;
  sleep?: (ms: number) => Promise<void>;
}

const PAGE = 100;

/** The cloud Long Tail over its HTTP API, as the site's bot. */
export class HttpCloudClient implements CloudClient {
  constructor(private readonly options: HttpCloudClientOptions) {
    if (!options.url) throw new Error('HttpCloudClient needs the cloud url (CLOUD_URL)');
    if (options.timeoutMs <= 0) throw new Error(`HttpCloudClient timeoutMs must be greater than 0, got ${options.timeoutMs}`);
    if (options.retry.retries < 0) throw new Error(`HttpCloudClient retries must be 0 or more, got ${options.retry.retries}`);
  }

  async botId(): Promise<string> {
    return (await this.options.credentials()).botId;
  }

  async claim(query: ClaimQuery): Promise<CloudEscalation[]> {
    const { claimed } = await this.call<{ claimed: CloudEscalation[] }>({
      method: 'POST',
      path: '/api/escalations/claim-by-facets',
      body: { query: { role: query.role }, limit: query.limit, durationMinutes: query.durationMinutes },
    });
    return claimed;
  }

  async listClaimed(): Promise<CloudEscalation[]> {
    const botId = await this.botId();
    const rows: CloudEscalation[] = [];
    for (;;) {
      const params = new URLSearchParams({ assigned_to: botId, status: ESCALATION_STATUS.PENDING, limit: String(PAGE), offset: String(rows.length) });
      const page = await this.call<{ escalations: CloudEscalation[]; total: number }>({ method: 'GET', path: `/api/escalations?${params}` });
      rows.push(...page.escalations);
      if (page.escalations.length === 0 || rows.length >= page.total) return rows;
    }
  }

  async files(escalationId: string): Promise<CloudFile[]> {
    const { files } = await this.call<{ files: CloudFile[] }>({ method: 'GET', path: `/api/escalations/${encodeURIComponent(escalationId)}/files` });
    return files;
  }

  read(escalationId: string): Promise<CloudEscalation> {
    return this.call<CloudEscalation>({ method: 'GET', path: `/api/escalations/${encodeURIComponent(escalationId)}` });
  }

  async resolve(signalKey: string, payload: Record<string, unknown>): Promise<void> {
    await this.call({ method: 'POST', path: '/api/escalations/resolve-by-signal-key', body: { signalKey, resolverPayload: payload } });
  }

  private async call<T>(request: Omit<ApiRequest, 'token' | 'timeoutMs'>): Promise<T> {
    const { url, credentials, retry, timeoutMs, sleep } = this.options;
    const { apiKey } = await credentials();
    return executeWithRetry(() => requestApi<T>(url, { ...request, token: apiKey, timeoutMs }), retry, sleep);
  }
}
