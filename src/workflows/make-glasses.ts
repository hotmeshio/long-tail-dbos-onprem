import { DBOS } from '@dbos-inc/dbos-sdk';

import * as assetActivities from '../activities/assets';
import * as planActivities from '../activities/plan';
import type { OrderPlan } from '../activities/plan';
import { proxySteps } from '../lib/durable';
import { WORKFLOW, type OrderStatus } from '../modules/constants';
import type { MakeGlassesInput, ProductionOutcome } from '../types/production';
import { runLensLine } from './lens-line';
import { packOrder } from './pack';
import { printFrame, type StageResult } from './print';
import { reportToCloud } from './report';

const { planOrder } = proxySteps(planActivities);
const { verifyAssets, cleanWorkDir } = proxySteps(assetActivities);

export interface MakeGlassesResult {
  orderId: string;
  status: OrderStatus;
  outcome: ProductionOutcome;
}

/** Print, lens line and final fit, pack. The first stage that does not finish ends the build. */
async function build(input: MakeGlassesInput, plan: OrderPlan): Promise<StageResult> {
  const { orderId } = input;
  const printed = await printFrame(orderId, input.frameStyle, plan.print);
  if (!printed.done) return printed;
  const fitted = await runLensLine(orderId, plan.lens);
  if (!fitted.done) return fitted;
  return packOrder(orderId, plan.pack);
}

/**
 * Make one claimed cloud order on the site. Every step works with the cloud
 * out of reach except the report, which waits for it.
 */
export async function makeGlasses(input: MakeGlassesInput): Promise<MakeGlassesResult> {
  const { escalationId, orderId } = input;

  // 1. Where and how this order is made
  const plan = await planOrder(input);

  // 2. The files on disk are the files the order declares
  const check = await verifyAssets(escalationId, input.assets);

  // 3. Print the frame, run the lens line, fit, pack
  const built: StageResult = check.verified ? await build(input, plan) : { done: false, notes: check.detail };

  // 4. Report the outcome to the cloud
  const outcome: ProductionOutcome = built.done
    ? { completed: true, site: plan.site, binKey: plan.pack.binKey, destination: plan.pack.destination }
    : { completed: false, site: plan.site, ...(built.notes ? { notes: built.notes } : {}) };
  const status = await reportToCloud(input, plan, outcome);

  // 5. Release the disk
  await cleanWorkDir(escalationId);
  return { orderId, status, outcome };
}

export const makeGlassesWorkflow = DBOS.registerWorkflow(makeGlasses, { name: WORKFLOW.MAKE_GLASSES });
