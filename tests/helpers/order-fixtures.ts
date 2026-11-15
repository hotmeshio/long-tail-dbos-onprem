import { createHash } from 'node:crypto';

import type { CloudEscalation } from '../../src/lib/cloud-client';
import { ASSET, ESCALATION_STATUS } from '../../src/modules/constants';
import type { FabricateInput, FabricationOrder } from '../../src/types/fabrication';

export const INTAKE_ROLE = 'fabrication';
export const MODEL_BYTES = 'solid model\nendsolid model\n';

export const sha256Of = (content: string) => createHash('sha256').update(content).digest('hex');

/** The data a cloud workflow puts on a fabrication wait. */
export function orderData(overrides: Partial<FabricationOrder> = {}): FabricationOrder {
  return {
    orderId: 'order-1001',
    product: 'bracket',
    quantity: 2,
    signalKey: 'fabricate-order-1001',
    assets: [{ as: ASSET.MODEL, sha256: sha256Of(MODEL_BYTES), size: Buffer.byteLength(MODEL_BYTES) }],
    ...overrides,
  };
}

/** A pending cloud row of the intake role, with its data as JSON text. */
export function cloudRow(overrides: Partial<CloudEscalation> = {}): CloudEscalation {
  return {
    id: 'esc-1',
    role: INTAKE_ROLE,
    type: 'fabricate',
    status: ESCALATION_STATUS.PENDING,
    assigned_to: null,
    metadata: null,
    envelope: null,
    escalation_payload: JSON.stringify(orderData()),
    ...overrides,
  };
}

/** What intake hands the workflow for one staged order. */
export function fabricateInput(overrides: Partial<FabricateInput> = {}): FabricateInput {
  const order = orderData();
  return {
    ...order,
    escalationId: 'esc-1',
    assets: order.assets.map((asset) => ({ ...asset, name: 'model.stl' })),
    ...overrides,
  };
}
