import { createHash } from 'node:crypto';

import type { CloudEscalation } from '../../src/lib/cloud-client';
import { ASSET, CLOUD_ROLE, ESCALATION_STATUS } from '../../src/modules/constants';
import type { MakeGlassesInput, ProductionOrder } from '../../src/types/production';

export const INTAKE_ROLE = CLOUD_ROLE.PRODUCTION;
export const ORDER_ID = 'A-1042';
export const FRAME_NAME = 'round-48.gcode.3mf';
export const FRAME_BYTES = '; round-48 frame\nG28\nG1 X48 Y20\n';

export const sha256Of = (content: string) => createHash('sha256').update(content).digest('hex');

/** The data a cloud workflow puts on a production wait. */
export function orderData(overrides: Partial<ProductionOrder> = {}): ProductionOrder {
  return {
    orderId: ORDER_ID,
    frameStyle: 'round-48',
    lensMaterial: 'polycarbonate',
    coating: 'anti-glare',
    lotNumber: 'LOT-4417',
    prescription: {
      right: { sphere: -1.25, cylinder: -0.5, axis: 90, add: 0 },
      left: { sphere: -1, cylinder: -0.25, axis: 85, add: 0 },
      pd: 63,
    },
    signalKey: `production-${ORDER_ID}`,
    assets: [{ as: ASSET.FRAME, sha256: sha256Of(FRAME_BYTES), size: Buffer.byteLength(FRAME_BYTES) }],
    ...overrides,
  };
}

/** A pending cloud row of the intake role, with its data as JSON text. */
export function cloudRow(overrides: Partial<CloudEscalation> = {}): CloudEscalation {
  return {
    id: 'esc-1',
    role: INTAKE_ROLE,
    type: 'production',
    status: ESCALATION_STATUS.PENDING,
    assigned_to: null,
    metadata: null,
    envelope: null,
    escalation_payload: JSON.stringify(orderData()),
    ...overrides,
  };
}

/** What intake hands the workflow for one staged order. */
export function makeGlassesInput(overrides: Partial<MakeGlassesInput> = {}): MakeGlassesInput {
  const order = orderData();
  return {
    ...order,
    escalationId: 'esc-1',
    assets: order.assets.map((asset) => ({ ...asset, name: FRAME_NAME })),
    ...overrides,
  };
}
