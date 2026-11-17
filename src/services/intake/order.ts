import type { CloudEscalation } from '../../lib/cloud-client';
import { ASSET } from '../../modules/constants';
import type { Eye, OrderAsset, ProductionOrder } from '../../types/production';

const SHA256 = /^[0-9a-f]{64}$/;
const ALIASES: string[] = Object.values(ASSET);
const TEXT_FIELDS = ['orderId', 'frameStyle', 'lensMaterial', 'coating', 'lotNumber', 'signalKey'] as const;
const EYE_FIELDS = ['sphere', 'cylinder', 'axis', 'add'] as const;

function fail(row: CloudEscalation, what: string): never {
  throw new Error(`escalation ${row.id} is not a production order: ${what}`);
}

function readAsset(row: CloudEscalation, value: unknown): OrderAsset {
  const asset = (value ?? {}) as Partial<OrderAsset>;
  if (typeof asset.as !== 'string' || !ALIASES.includes(asset.as)) fail(row, `an asset is not one of ${ALIASES.join(', ')}`);
  if (typeof asset.sha256 !== 'string' || !SHA256.test(asset.sha256)) fail(row, `asset "${asset.as}" has no sha256`);
  if (typeof asset.size !== 'number' || asset.size < 0) fail(row, `asset "${asset.as}" has no size`);
  return { as: asset.as, sha256: asset.sha256, size: asset.size };
}

function readEye(row: CloudEscalation, side: string, value: unknown): Eye {
  const eye = (value ?? {}) as Record<string, unknown>;
  for (const field of EYE_FIELDS) {
    if (typeof eye[field] !== 'number') fail(row, `prescription.${side}.${field} is not a number`);
  }
  return { sphere: eye.sphere as number, cylinder: eye.cylinder as number, axis: eye.axis as number, add: eye.add as number };
}

function readPrescription(row: CloudEscalation, value: unknown): ProductionOrder['prescription'] {
  if (!value || typeof value !== 'object') fail(row, 'prescription is missing');
  const { right, left, pd } = value as Record<string, unknown>;
  if (typeof pd !== 'number') fail(row, 'prescription.pd is not a number');
  return { right: readEye(row, 'right', right), left: readEye(row, 'left', left), pd };
}

/** The order a cloud row advertises, from the data its workflow put on the wait. */
export function readOrder(row: CloudEscalation): ProductionOrder {
  let data: Record<string, unknown> | null;
  try {
    data = typeof row.escalation_payload === 'string' ? JSON.parse(row.escalation_payload) : row.escalation_payload;
  } catch (err) {
    throw new Error(`escalation ${row.id} is not a production order: its data is not JSON`, { cause: err });
  }
  if (!data || typeof data !== 'object') fail(row, 'it carries no data');
  const text = {} as Record<typeof TEXT_FIELDS[number], string>;
  for (const field of TEXT_FIELDS) {
    const value = data[field];
    if (typeof value !== 'string' || !value) fail(row, `${field} is missing`);
    text[field] = value;
  }
  const { assets } = data;
  if (!Array.isArray(assets) || assets.length === 0) fail(row, 'it lists no assets');
  return {
    ...text,
    prescription: readPrescription(row, data.prescription),
    assets: assets.map((asset) => readAsset(row, asset)),
  };
}
