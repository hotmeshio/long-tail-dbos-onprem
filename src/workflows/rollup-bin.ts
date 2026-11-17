import { DBOS } from '@dbos-inc/dbos-sdk';
import { conditional, type LTAccumulatorResult } from '@hotmeshio/long-tail-dbos';

import { ESCALATION_SUBTYPE, ESCALATION_TYPE, ROLE, SHIP_VIA, TRIGGER, WORKFLOW, binWaitKey, type ShipVia } from '../modules/constants';

export interface BinInput {
  binKey: string;
  destination: string;
  max: number;
  timeout: string;
}

type PackageV1 = { weight?: number };
type ShipNow = { shipVia: ShipVia; note?: string };

export interface BinResult {
  binKey: string;
  shipped: boolean;
  trigger?: string;
  shipVia?: ShipVia;
  orders?: string[];
}

/**
 * One open bin: a row that takes each boxed order scanned into it and closes
 * when it is full, at the carrier pickup, or when a shift lead ships it early.
 */
export async function rollupBin(input: BinInput): Promise<BinResult> {
  const { binKey, destination, max, timeout } = input;
  const bin = await conditional<LTAccumulatorResult<PackageV1, ShipNow>>(binWaitKey(binKey), {
    role: ROLE.BIN,
    type: ESCALATION_TYPE.ROLLUP,
    subtype: ESCALATION_SUBTYPE.BIN,
    description: `Boxed orders for ${destination}. Ships at ${max} packages or at the carrier pickup.`,
    metadata: { binKey, destination },
    accumulate: { max },
    timeout,
  });
  if (!bin) return { binKey, shipped: false };
  return {
    binKey,
    shipped: true,
    trigger: bin.$trigger,
    shipVia: bin.$trigger === TRIGGER.RESOLVE ? bin.shipVia ?? SHIP_VIA.COURIER : SHIP_VIA.PICKUP,
    orders: bin.$accumulated.map((item) => item.itemKey),
  };
}

export const rollupBinWorkflow = DBOS.registerWorkflow(rollupBin, { name: WORKFLOW.ROLLUP_BIN });
