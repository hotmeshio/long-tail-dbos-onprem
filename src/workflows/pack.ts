import { DBOS } from '@dbos-inc/dbos-sdk';
import { conditional, type LTAccumulatorResult } from '@hotmeshio/long-tail-dbos';

import * as binActivities from '../activities/bin';
import type { PackPlan } from '../activities/plan';
import { proxySteps } from '../lib/durable';
import { ESCALATION_SUBTYPE, ESCALATION_TYPE, ROLE, binWorkflowId, packageKey } from '../modules/constants';
import type { StageResult } from './print';
import { rollupBinWorkflow } from './rollup-bin';

const { binGeneration } = proxySteps(binActivities);

/**
 * Box the order and wait for a packer to scan it into its destination's bin.
 * The bin is its own workflow, one per fill, shared by every order packed
 * while it is open.
 */
export async function packOrder(orderId: string, plan: PackPlan): Promise<StageResult> {
  const { binKey, destination, max, timeout } = plan;

  // 1. The destination's bin is open
  const generation = await binGeneration(binKey);
  await DBOS.startWorkflow(rollupBinWorkflow, { workflowID: binWorkflowId(binKey, generation) })({ binKey, destination, max, timeout });

  // 2. The boxed order waits for its scan into the bin
  const packed = await conditional<LTAccumulatorResult>(packageKey(orderId), {
    role: ROLE.PACKAGE,
    type: ESCALATION_TYPE.ROLLUP,
    subtype: ESCALATION_SUBTYPE.PACKAGE,
    description: 'A boxed pair of glasses, waiting to be scanned into a bin.',
    metadata: { orderId, binKey },
    accumulate: { max: 1 },
    timeout: plan.packageTimeout,
  });
  if (!packed) return { done: false, notes: `order ${orderId} was not scanned into ${binKey}` };
  return { done: true };
}
