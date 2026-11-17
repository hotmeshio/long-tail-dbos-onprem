import { conditional } from '@hotmeshio/long-tail-dbos';

import * as cloudActivities from '../activities/cloud';
import type { OrderPlan } from '../activities/plan';
import { STEP_ONCE, proxySteps, sleepSeconds } from '../lib/durable';
import { ESCALATION_TYPE, ORDER_STATUS, REPORT_STATE, ROLE, reportClosedKey, type OrderStatus } from '../modules/constants';
import type { MakeGlassesInput, ProductionOutcome } from '../types/production';

const { reportOutcome } = proxySteps(cloudActivities, STEP_ONCE);

/** Tell the cloud, for as long as it takes to reach it. A cloud that stopped waiting goes to a shift lead. */
export async function reportToCloud(input: MakeGlassesInput, plan: OrderPlan, outcome: ProductionOutcome): Promise<OrderStatus> {
  const { escalationId, orderId, signalKey } = input;
  let wait = plan.report.baseSeconds;
  for (;;) {
    const result = await reportOutcome(escalationId, signalKey, outcome);
    if (result.state === REPORT_STATE.RESOLVED) return ORDER_STATUS.REPORTED;
    if (result.state !== REPORT_STATE.UNREACHABLE) {
      await conditional('report-closed', {
        role: ROLE.SHIFT_LEAD,
        type: ESCALATION_TYPE.REPORT_CLOSED,
        description: `The cloud did not take the outcome of order ${orderId}: ${result.detail ?? result.state}`,
        signalKey: reportClosedKey(escalationId),
        metadata: { orderId },
        data: { orderId, outcome, state: result.state, detail: result.detail },
      });
      return ORDER_STATUS.CLOSED;
    }
    await sleepSeconds(wait);
    wait = Math.min(wait * 2, plan.report.capSeconds);
  }
}
