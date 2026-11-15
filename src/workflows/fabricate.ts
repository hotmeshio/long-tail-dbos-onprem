import { DBOS } from '@dbos-inc/dbos-sdk';
import { Machines } from '@hotmeshio/long-tail';
import { conditional, type LTAccumulatorResult } from '@hotmeshio/long-tail-dbos';

import * as assetActivities from '../activities/assets';
import * as cloudActivities from '../activities/cloud';
import * as planActivities from '../activities/plan';
import type { OrderPlan, PrintPlan } from '../activities/plan';
import { STEP_ONCE, proxySteps, sleepSeconds } from '../lib/durable';
import {
  ESCALATION_TYPE, FABRICATE_STATUS, PRINT_ERROR, REPORT_STATE, ROLE, WORKFLOW,
  inspectionKey, printFailedKey, reportClosedKey, type FabricateStatus,
} from '../modules/constants';
import type { FabricateInput, FabricationOutcome } from '../types/fabrication';

const { planOrder } = proxySteps(planActivities);
const { verifyAssets, cleanWorkDir } = proxySteps(assetActivities);
const { reportOutcome } = proxySteps(cloudActivities, STEP_ONCE);

export interface FabricateResult {
  orderId: string;
  status: FabricateStatus;
  outcome: FabricationOutcome;
}

type Built = Pick<FabricationOutcome, 'completed' | 'units' | 'notes'>;
type PrintReceipt = LTAccumulatorResult<Record<string, unknown>, { received: boolean; errorCode: string; detail: string; reason: string }>;
interface PrintAttempt { received: boolean; errorCode?: string; detail?: string }
interface LeadDecision { retry?: boolean; notes?: string }
interface Inspection { passed: boolean; units: number; notes?: string }

const HANDOFF_PRIORITY = 2;
const notBuilt = (notes?: string): Built => ({ completed: false, units: 0, ...(notes ? { notes } : {}) });

function readAttempt(receipt: PrintReceipt | null): PrintAttempt {
  if (receipt === null) return { received: false, errorCode: PRINT_ERROR.CANCELLED, detail: 'the print row was cancelled' };
  if (receipt.received === true) return { received: true };
  if (receipt.$trigger === 'timeout') return { received: false, errorCode: PRINT_ERROR.TIMEOUT, detail: 'no receipt before the timeout' };
  return { received: false, errorCode: receipt.errorCode ?? PRINT_ERROR.UNKNOWN, detail: receipt.detail ?? receipt.reason };
}

/** Park on the printer's machine row; the line gateway dispatches the job and resolves the row when every unit is printed. */
async function printOnce(input: FabricateInput, print: PrintPlan, attempt: number): Promise<PrintAttempt> {
  const { orderId, quantity } = input;
  const baseJobId = `${orderId}-print`;
  const receipt = await conditional<PrintReceipt>(`print-${attempt}`, {
    role: print.role,
    type: Machines.ROW_TYPE.HANDOFF,
    subtype: print.process,
    description: `Print ${quantity} x ${input.product} for order ${orderId}`,
    priority: HANDOFF_PRIORITY,
    metadata: {
      orderId,
      siteId: print.siteId,
      lineId: print.lineId,
      units: Array.from({ length: quantity }, (_, i) => ({ unitId: `${orderId}-${i + 1}`, carrierId: null })),
      jobId: attempt === 1 ? baseJobId : `${baseJobId}-a${attempt}`,
      senderJobId: null,
      orderRef: orderId,
      fromMachine: null,
      toMachine: print.toMachine,
      recipeId: print.recipeId,
      recipeVersion: print.recipeVersion,
      process: print.process,
      artifactUrl: print.artifactUrl,
      artifactSha256: print.artifactSha256,
      attempt,
    },
    accumulate: {},
    timeout: print.timeout,
  });
  return readAttempt(receipt);
}

/** Print until a job is received, or a floor lead ends the order after a failed attempt. */
async function print(input: FabricateInput, plan: PrintPlan): Promise<{ printed: boolean; notes?: string }> {
  const { escalationId, orderId } = input;
  for (let attempt = 1; ; attempt++) {
    const result = await printOnce(input, plan, attempt);
    if (result.received) return { printed: true };
    const decision = await conditional<LeadDecision>(`print-failed-${attempt}`, {
      role: ROLE.LEAD,
      type: ESCALATION_TYPE.PRINT_FAILED,
      description: `Print attempt ${attempt} for order ${orderId} did not finish: ${result.detail ?? result.errorCode}`,
      signalKey: printFailedKey(escalationId, attempt),
      metadata: { orderId },
      data: { orderId, attempt, errorCode: result.errorCode, detail: result.detail },
    });
    if (!decision || decision.retry === false) {
      return { printed: false, notes: (decision && decision.notes) || result.detail };
    }
  }
}

async function inspect(input: FabricateInput): Promise<Built> {
  const { escalationId, orderId, product, quantity } = input;
  const inspection = await conditional<Inspection>('inspect', {
    role: ROLE.INSPECTOR,
    type: ESCALATION_TYPE.INSPECTION,
    description: `Inspect ${quantity} x ${product} for order ${orderId}`,
    signalKey: inspectionKey(escalationId),
    metadata: { orderId },
    data: { orderId, product, quantity },
  });
  if (!inspection) return notBuilt('the inspection was closed without a decision');
  return { completed: inspection.passed === true, units: inspection.units ?? 0, ...(inspection.notes ? { notes: inspection.notes } : {}) };
}

/** Tell the cloud, for as long as it takes to reach it. A cloud that stopped waiting goes to a floor lead. */
async function report(input: FabricateInput, plan: OrderPlan, outcome: FabricationOutcome): Promise<FabricateStatus> {
  const { escalationId, orderId, signalKey } = input;
  let wait = plan.report.baseSeconds;
  for (;;) {
    const result = await reportOutcome(escalationId, signalKey, outcome);
    if (result.state === REPORT_STATE.RESOLVED) return FABRICATE_STATUS.REPORTED;
    if (result.state !== REPORT_STATE.UNREACHABLE) {
      await conditional('report-closed', {
        role: ROLE.LEAD,
        type: ESCALATION_TYPE.REPORT_CLOSED,
        description: `The cloud did not take the outcome of order ${orderId}: ${result.detail ?? result.state}`,
        signalKey: reportClosedKey(escalationId),
        metadata: { orderId },
        data: { orderId, outcome, state: result.state, detail: result.detail },
      });
      return FABRICATE_STATUS.CLOSED;
    }
    await sleepSeconds(wait);
    wait = Math.min(wait * 2, plan.report.capSeconds);
  }
}

/**
 * Build one claimed cloud order on the site. Every step works with the cloud
 * out of reach except the report, which waits for it.
 */
export async function fabricate(input: FabricateInput): Promise<FabricateResult> {
  const { escalationId, orderId } = input;

  // 1. Where and how this order prints
  const plan = await planOrder(input);

  // 2. The files on disk are the files the order declares
  const check = await verifyAssets(escalationId, input.assets);

  // 3. Print, then a person inspects
  let built: Built;
  if (!check.verified) {
    built = notBuilt(check.detail);
  } else {
    const printed = await print(input, plan.print);
    built = printed.printed ? await inspect(input) : notBuilt(printed.notes);
  }

  // 4. Report the outcome to the cloud
  const outcome: FabricationOutcome = { ...built, site: plan.site };
  const status = await report(input, plan, outcome);

  // 5. Release the disk
  await cleanWorkDir(escalationId);
  return { orderId, status, outcome };
}

export const fabricateWorkflow = DBOS.registerWorkflow(fabricate, { name: WORKFLOW.FABRICATE });
