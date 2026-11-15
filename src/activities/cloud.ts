import { ApiRequestError } from '../lib/api-request';
import { getCloud } from '../lib/cloud-client';
import { log } from '../lib/logger';
import { ESCALATION_STATUS, LOG_EVENTS, REPORT_STATE, type ReportState } from '../modules/constants';
import type { FabricationOutcome } from '../types/fabrication';

export interface ReportResult {
  state: ReportState;
  detail?: string;
}

const UNAUTHORIZED = 401;
const NOT_FOUND = 404;
const CONFLICT = 409;

function isUnreachable(err: unknown): boolean {
  return err instanceof ApiRequestError && (err.status === undefined || err.status >= 500 || err.status === UNAUTHORIZED || err.status === 429);
}

function settle(escalationId: string, result: ReportResult): ReportResult {
  const event = result.state === REPORT_STATE.UNREACHABLE ? LOG_EVENTS.REPORT_UNREACHABLE : LOG_EVENTS.REPORT_SETTLED;
  log(event, { escalationId, ...result });
  return result;
}

/** What the cloud row says after it turned a report away. */
async function readSettled(escalationId: string): Promise<ReportResult> {
  const cloud = getCloud();
  const [row, botId] = await Promise.all([cloud.read(escalationId), cloud.botId()]);
  if (row.status === ESCALATION_STATUS.PENDING) return { state: REPORT_STATE.UNREACHABLE, detail: 'cloud row is still pending' };
  if (row.status === ESCALATION_STATUS.RESOLVED && row.metadata?.resolved_by === botId) return { state: REPORT_STATE.RESOLVED };
  const by = row.status === ESCALATION_STATUS.RESOLVED ? ' by someone else' : '';
  return { state: REPORT_STATE.CLOSED, detail: `cloud row is ${row.status}${by}` };
}

/**
 * One attempt to resolve the cloud wait with the order's outcome. The answer
 * is a state the workflow acts on: resolved, closed (the cloud stopped
 * waiting), refused, or unreachable (try again later). A report the cloud
 * already holds from this site counts as resolved.
 */
export async function reportOutcome(escalationId: string, signalKey: string, outcome: FabricationOutcome): Promise<ReportResult> {
  try {
    await getCloud().resolve(signalKey, outcome);
    return settle(escalationId, { state: REPORT_STATE.RESOLVED });
  } catch (err) {
    if (isUnreachable(err)) return settle(escalationId, { state: REPORT_STATE.UNREACHABLE, detail: (err as Error).message });
    if (!(err instanceof ApiRequestError)) throw err;
    if (err.status !== CONFLICT && err.status !== NOT_FOUND) {
      return settle(escalationId, { state: REPORT_STATE.REFUSED, detail: err.message });
    }
  }
  try {
    return settle(escalationId, await readSettled(escalationId));
  } catch (err) {
    if (isUnreachable(err)) return settle(escalationId, { state: REPORT_STATE.UNREACHABLE, detail: (err as Error).message });
    if (err instanceof ApiRequestError) return settle(escalationId, { state: REPORT_STATE.CLOSED, detail: err.message });
    throw err;
  }
}
