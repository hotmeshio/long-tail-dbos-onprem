import { Machines } from '@hotmeshio/long-tail';

import type { PrintPlan } from '../activities/plan';
import { ESCALATION_SUBTYPE, routeKey } from '../modules/constants';
import { askOperator, handOff, type Hop, type HopOutcome, type Route } from './handoff';

const { DECISION } = Machines;

const PRINT_HOP = 0;
const UNLOAD_HOP = 1;
const MANUAL_HOP = 2;

export interface StageResult {
  done: boolean;
  notes?: string;
}

function readUnload(orderId: string, unload: HopOutcome): StageResult {
  if (!unload.received) return { done: false, notes: unload.answer?.note || unload.detail || `the frame for order ${orderId} was not unloaded` };
  const good = unload.answer?.unitsGood;
  if (typeof good === 'number' && good < 1) return { done: false, notes: unload.answer?.note || `the frame for order ${orderId} was scrapped at unload` };
  return { done: true };
}

/**
 * Print the order's frame. The printer keeps the frame until a person unloads
 * it, so the next order waits for the printer in the fleet queue. A print that
 * stops goes to servicing: print again, unload by hand, or scrap.
 */
export async function printFrame(orderId: string, frameStyle: string, plan: PrintPlan): Promise<StageResult> {
  const { station, serialNumber, model } = plan;
  const route: Route = {
    line: plan,
    routeKey: routeKey.print(orderId),
    orderId,
    facets: { serialNumber, model },
    artifact: { url: plan.artifactUrl, sha256: plan.artifactSha256 },
  };
  const printHop: Hop = {
    index: PRINT_HOP,
    from: null,
    to: station,
    subtype: ESCALATION_SUBTYPE.PRINTING,
    description: `Print the ${frameStyle} frame for order ${orderId} on ${station.machineId}`,
  };
  const unloadHop = (index: number, from: Hop['from']): Hop => ({
    index,
    from,
    to: null,
    subtype: ESCALATION_SUBTYPE.UNLOAD,
    description: `Unload the ${frameStyle} frame for order ${orderId} from ${station.machineId}`,
  });

  for (let attempt = 1; ; attempt++) {
    const printed = await handOff(route, printHop, attempt);
    if (printed.received) return readUnload(orderId, await handOff(route, unloadHop(UNLOAD_HOP, station), 1, attempt));
    const { decision, note } = await askOperator(route, printHop, attempt, 1, printed);
    if (decision === DECISION.RETRY) continue;
    if (decision === DECISION.MANUAL) return readUnload(orderId, await handOff(route, unloadHop(MANUAL_HOP, null), 1));
    return { done: false, notes: note || printed.detail || `the print for order ${orderId} was scrapped` };
  }
}
