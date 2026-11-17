import { ESCALATION_STATUS } from '../modules/constants';
import { requestApi } from './api-request';

/** One pending row on the site, as the escalations API lists it. */
export interface FloorRow {
  id: string;
  role: string;
  type?: string;
  subtype?: string | null;
  description?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** The floor as a person at a station works it: find a row, then answer it. */
export interface FloorClient {
  /** Pending rows whose facets match, optionally in one queue. */
  pendingRows(facets: Record<string, string>, role?: string): Promise<FloorRow[]>;
  /** Claim the row, then submit its form. */
  resolveRow(id: string, resolverPayload: Record<string, unknown>): Promise<void>;
  /** Place one boxed order's package row in a bin row; the package row closes with the add. */
  placeInBin(binId: string, packageId: string, orderId: string): Promise<void>;
}

const CLAIM_MINUTES = 5;
const PAGE = 50;

export async function signIn(baseUrl: string, credentials: { username: string; password: string }): Promise<string> {
  const { token } = await requestApi<{ token: string }>(baseUrl, { method: 'POST', path: '/api/auth/login', body: credentials });
  return token;
}

export function createFloorClient(baseUrl: string, token: string): FloorClient {
  const post = (path: string, body: unknown) => requestApi<unknown>(baseUrl, { method: 'POST', path, token, body });
  return {
    async pendingRows(facets, role) {
      const query = new URLSearchParams({ status: ESCALATION_STATUS.PENDING, facets: JSON.stringify(facets), limit: String(PAGE) });
      if (role) query.set('role', role);
      const { escalations } = await requestApi<{ escalations?: FloorRow[] }>(baseUrl, { method: 'GET', path: `/api/escalations?${query}`, token });
      return escalations ?? [];
    },
    async resolveRow(id, resolverPayload) {
      await post(`/api/escalations/${id}/claim`, { durationMinutes: CLAIM_MINUTES });
      await post(`/api/escalations/${id}/resolve`, { resolverPayload });
    },
    async placeInBin(binId, packageId, orderId) {
      await post(`/api/escalations/${binId}/accumulate`, { itemKey: orderId, reciprocal: { id: packageId } });
    },
  };
}
