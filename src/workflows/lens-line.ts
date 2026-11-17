import { Machines } from '@hotmeshio/long-tail';

import type { LensPlan, StationPlan } from '../activities/plan';
import { routeKey } from '../modules/constants';
import { askOperator, handOff, type Hop, type HopOutcome, type Route } from './handoff';
import type { StageResult } from './print';

const { DECISION, HANDOFF_ERROR } = Machines;

function readFit(orderId: string, fit: HopOutcome): StageResult {
  if (fit.received) return { done: true };
  return { done: false, notes: fit.answer?.note || fit.detail || `order ${orderId} did not pass final fit` };
}

/** The station a failed hop stopped at: the sender when it rejected the unit, the receiver otherwise. */
function stoppedAt(hop: Hop, outcome: HopOutcome): StationPlan | null {
  return outcome.errorCode === HANDOFF_ERROR.SENDER_REJECTED ? hop.from : hop.to;
}

/**
 * Run the framed order through the lens line: each station in turn, then the
 * fitters. A hop that stops goes to the line operator: run it again, finish by
 * hand, or scrap. Work the press could not do goes to the hand-mount bench
 * before final fit.
 */
export async function runLensLine(orderId: string, plan: LensPlan): Promise<StageResult> {
  const route: Route = { line: plan, routeKey: routeKey.lens(orderId), orderId };
  const stations = plan.stations;
  const fitIndex = stations.length;
  const handIndex = fitIndex + 1;
  const manualFitIndex = fitIndex + 2;
  const fitHop = (index: number, from: Hop['from']): Hop => ({ index, from, to: null });
  const hops: Hop[] = [
    ...stations.map((station, h): Hop => ({ index: h, from: h ? stations[h - 1] : null, to: station })),
    fitHop(fitIndex, stations[stations.length - 1] ?? null),
  ];

  let senderAttempt = 1;
  for (const hop of hops) {
    for (let attempt = 1; ; attempt++) {
      const outcome = await handOff(route, hop, attempt, senderAttempt);
      if (outcome.received) {
        senderAttempt = attempt;
        break;
      }
      // A fitter who turns the order down ends it; a hop that stopped is the operator's to decide.
      if (!outcome.errorCode) return readFit(orderId, outcome);
      const stopped = stoppedAt(hop, outcome);
      const { decision, note } = await askOperator(route, hop, attempt, senderAttempt, outcome);
      if (decision === DECISION.RETRY) continue;
      if (decision !== DECISION.MANUAL) {
        return { done: false, notes: note || outcome.detail || `order ${orderId} was scrapped at ${stopped?.machineId ?? 'line entry'}` };
      }

      // The order leaves automation: the hand bench when the stopped station has one, then the fitters.
      const handRole = stopped ? plan.handRoles[stopped.machineId] : undefined;
      if (!handRole) return readFit(orderId, await handOff(route, fitHop(manualFitIndex, hop.from), 1, senderAttempt));
      const byHand = await handOff(route, {
        index: handIndex,
        from: hop.from,
        to: null,
        role: handRole,
        subtype: stopped!.process,
        description: `Mount the lenses for order ${orderId} by hand`,
      }, 1, senderAttempt);
      if (!byHand.received) return { done: false, notes: byHand.answer?.note || byHand.detail || `order ${orderId} was not mounted by hand` };
      return readFit(orderId, await handOff(route, fitHop(manualFitIndex, null), 1));
    }
  }
  return { done: true };
}
