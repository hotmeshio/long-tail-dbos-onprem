import { Machines } from '@hotmeshio/long-tail';
import { conditional, type LTAccumulatorResult } from '@hotmeshio/long-tail-dbos';

import type { LinePlan, StationPlan } from '../activities/plan';
import { ESCALATION_SUBTYPE, TRIGGER, WAIT_TIMEOUT } from '../modules/constants';

const { DECISION, HANDOFF_ERROR, ROW_TYPE, handoffDecisions, signalKeys } = Machines;

const HANDOFF_PRIORITY = 2;
const OPERATOR_PRIORITY = 1;
const EXIT = 'exit';
const LINE_ENTRY = 'line entry';

/** One order's trip along one line. */
export interface Route {
  line: LinePlan;
  /** Names the order on this line; part of every job id and signal key. */
  routeKey: string;
  orderId: string;
  /** Facets every row of the route carries besides the handoff's own. */
  facets?: Record<string, unknown>;
  /** The file a machine fetches before it starts. */
  artifact?: { url: string; sha256: string };
}

/** One move: from a machine (or line entry) to a machine, or to the people of a role. */
export interface Hop {
  index: number;
  from: StationPlan | null;
  to: StationPlan | null;
  /** The people who receive when no machine does; the line's exit role by default. */
  role?: string;
  subtype?: string;
  description?: string;
}

type Receipt = LTAccumulatorResult<Record<string, unknown>, Record<string, any>>;

export interface HopOutcome {
  received: boolean;
  errorCode?: string;
  detail?: string;
  /** What the receiver answered with. */
  answer?: Record<string, any>;
}

export interface OperatorAnswer {
  decision: string;
  note?: string;
}

const unitsOf = (route: Route) => [{ unitId: route.orderId, carrierId: null }];
const receiverName = (route: Route, hop: Hop) => hop.to?.machineId ?? (hop.role && hop.role !== route.line.exitRole ? hop.role : EXIT);

/** A station's job for a route. A retry is a new job. */
export function jobIdFor(routeKey: string, station: string, attempt = 1): string {
  const base = `${routeKey}-${station}`;
  return attempt > 1 ? `${base}-a${attempt}` : base;
}

/** `senderAttempt` is the attempt of the hop that brought the order to the sender. */
export function hopFacets(route: Route, hop: Hop, attempt: number, senderAttempt = 1): Record<string, unknown> {
  const artifact = hop.to ? route.artifact : undefined;
  return {
    ...route.facets,
    orderId: route.orderId,
    siteId: route.line.siteId,
    lineId: route.line.lineId,
    units: unitsOf(route),
    jobId: jobIdFor(route.routeKey, receiverName(route, hop), attempt),
    senderJobId: hop.from ? jobIdFor(route.routeKey, hop.from.machineId, senderAttempt) : null,
    orderRef: route.orderId,
    fromMachine: hop.from?.machineId ?? null,
    toMachine: hop.to?.machineId ?? null,
    recipeId: hop.to?.recipeId ?? null,
    recipeVersion: hop.to?.recipeVersion ?? null,
    process: hop.to?.process ?? null,
    artifactUrl: artifact?.url ?? null,
    artifactSha256: artifact?.sha256 ?? null,
    attempt,
  };
}

function describeHop(route: Route, hop: Hop): string {
  if (hop.description) return hop.description;
  const from = hop.from?.machineId ?? LINE_ENTRY;
  if (hop.to) return `${route.orderId}: ${from} to ${hop.to.machineId}`;
  return `Receive ${route.orderId} from ${from} and take it off the line`;
}

function readReceipt(receipt: Receipt | null | false): HopOutcome {
  if (receipt === null) return { received: false, errorCode: HANDOFF_ERROR.CANCELLED, detail: 'the handoff was cancelled' };
  if (!receipt || receipt.$trigger === TRIGGER.TIMEOUT) {
    return { received: false, errorCode: HANDOFF_ERROR.HANDOFF_TIMEOUT, detail: 'no receipt before the timeout' };
  }
  if (receipt.errorCode) return { received: false, errorCode: receipt.errorCode, detail: receipt.detail ?? receipt.reason ?? undefined };
  return { received: receipt.received !== false, answer: receipt };
}

/**
 * Park a handoff row on the receiver's role. The line gateway resolves a
 * machine's row from what the machine reports; a person resolves theirs.
 */
export async function handOff(route: Route, hop: Hop, attempt: number, senderAttempt = 1): Promise<HopOutcome> {
  const receipt = await conditional<Receipt>(signalKeys.handoff(route.routeKey, hop.index, attempt), {
    role: hop.to?.role ?? hop.role ?? route.line.exitRole,
    type: ROW_TYPE.HANDOFF,
    subtype: hop.subtype ?? hop.to?.process ?? ESCALATION_SUBTYPE.EXIT,
    description: describeHop(route, hop),
    priority: HANDOFF_PRIORITY,
    metadata: hopFacets(route, hop, attempt, senderAttempt),
    accumulate: {},
    timeout: route.line.timeout,
  });
  return readReceipt(receipt);
}

/** Ask the line's operator until the answer is one of the decisions this failure allows. */
export async function askOperator(route: Route, hop: Hop, attempt: number, senderAttempt: number, outcome: HopOutcome): Promise<OperatorAnswer> {
  const where = hop.from?.machineId ?? LINE_ENTRY;
  const decisions: string[] = handoffDecisions(outcome.errorCode as Parameters<typeof handoffDecisions>[0]);
  let refused = '';
  for (let round = 1; ; round++) {
    const answer = await conditional<OperatorAnswer>(signalKeys.handoffError(route.routeKey, hop.index, attempt, round), {
      role: route.line.operatorRole,
      type: ROW_TYPE.HANDOFF_ERROR,
      subtype: outcome.errorCode,
      description: `${refused}${route.orderId} stopped at ${where}: ${outcome.errorCode}. ${outcome.detail ?? ''} Choose ${decisions.join(', ')}.`.replace(/\s+/g, ' ').trim(),
      priority: OPERATOR_PRIORITY,
      metadata: { ...hopFacets(route, hop, attempt, senderAttempt), errorCode: outcome.errorCode, detail: outcome.detail ?? null, decisions, round },
      timeout: WAIT_TIMEOUT.OPERATOR,
    });
    if (!answer) return { decision: DECISION.SCRAP, note: 'no decision before the timeout' };
    if (decisions.includes(answer.decision)) return answer;
    refused = `${answer.decision} is not available here. `;
  }
}
