import type { CloudEscalation } from '../../lib/cloud-client';
import type { FabricationOrder, OrderAsset } from '../../types/fabrication';

const SHA256 = /^[0-9a-f]{64}$/;

function fail(row: CloudEscalation, what: string): never {
  throw new Error(`escalation ${row.id} is not a fabrication order: ${what}`);
}

function readAsset(row: CloudEscalation, value: unknown): OrderAsset {
  const asset = (value ?? {}) as Partial<OrderAsset>;
  if (typeof asset.as !== 'string' || !asset.as) fail(row, 'an asset has no "as"');
  if (typeof asset.sha256 !== 'string' || !SHA256.test(asset.sha256)) fail(row, `asset "${asset.as}" has no sha256`);
  if (typeof asset.size !== 'number' || asset.size < 0) fail(row, `asset "${asset.as}" has no size`);
  return { as: asset.as, sha256: asset.sha256, size: asset.size };
}

/** The order a cloud row advertises, from the data its workflow put on the wait. */
export function readOrder(row: CloudEscalation): FabricationOrder {
  let data: Record<string, unknown> | null;
  try {
    data = typeof row.escalation_payload === 'string' ? JSON.parse(row.escalation_payload) : row.escalation_payload;
  } catch (err) {
    throw new Error(`escalation ${row.id} is not a fabrication order: its data is not JSON`, { cause: err });
  }
  if (!data || typeof data !== 'object') fail(row, 'it carries no data');
  const { orderId, product, quantity, signalKey, assets } = data;
  if (typeof orderId !== 'string' || !orderId) fail(row, 'orderId is missing');
  if (typeof product !== 'string' || !product) fail(row, 'product is missing');
  if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1) fail(row, 'quantity is not a positive integer');
  if (typeof signalKey !== 'string' || !signalKey) fail(row, 'signalKey is missing');
  if (!Array.isArray(assets) || assets.length === 0) fail(row, 'it lists no assets');
  return { orderId, product, quantity, signalKey, assets: assets.map((asset) => readAsset(row, asset)) };
}
