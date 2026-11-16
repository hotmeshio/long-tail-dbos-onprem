import { describe, expect, it } from 'vitest';

import { readOrder } from '../../../../src/services/intake/order';
import { ASSET } from '../../../../src/modules/constants';
import { cloudRow, orderData, sha256Of } from '../../../helpers/order-fixtures';

const SHA = sha256Of('model');
const rowWith = (data: unknown) => cloudRow({ id: 'esc-7', escalation_payload: data as string });
const without = (key: string) => {
  const data: Record<string, unknown> = { ...orderData() };
  delete data[key];
  return data;
};

describe('readOrder', () => {
  it('reads an order from JSON text', () => {
    expect(readOrder(cloudRow())).toEqual(orderData());
  });

  it('reads an order already parsed', () => {
    expect(readOrder(rowWith(orderData()))).toEqual(orderData());
  });

  it('keeps the declared fields only', () => {
    const data = { ...orderData(), priority: 'rush', assets: [{ as: ASSET.MODEL, sha256: SHA, size: 5, path: 'orders/1/model.stl' }] };
    const order = readOrder(rowWith(data));
    expect(order).toEqual({ ...orderData(), assets: [{ as: ASSET.MODEL, sha256: SHA, size: 5 }] });
  });

  it('accepts several assets and an empty file', () => {
    const assets = [{ as: ASSET.MODEL, sha256: SHA, size: 5 }, { as: ASSET.TICKET, sha256: sha256Of(''), size: 0 }];
    expect(readOrder(rowWith(orderData({ assets }))).assets).toEqual(assets);
  });

  it('names the row and keeps the cause when the data is not JSON', () => {
    const err = (() => { try { readOrder(rowWith('{not json')); } catch (caught) { return caught as Error; } })();
    expect(err?.message).toBe('escalation esc-7 is not a fabrication order: its data is not JSON');
    expect(err?.cause).toBeInstanceOf(SyntaxError);
  });

  it.each([null, 'null', '"text"', '7'])('throws when the row carries no data: %s', (data) => {
    expect(() => readOrder(rowWith(data))).toThrow('escalation esc-7 is not a fabrication order: it carries no data');
  });

  it.each([
    ['orderId', 'orderId is missing'],
    ['product', 'product is missing'],
    ['quantity', 'quantity is not a positive integer'],
    ['signalKey', 'signalKey is missing'],
    ['assets', 'it lists no assets'],
  ])('throws when %s is missing', (key, what) => {
    expect(() => readOrder(rowWith(without(key)))).toThrow(`escalation esc-7 is not a fabrication order: ${what}`);
  });

  it.each([
    [{ orderId: '' }, 'orderId is missing'],
    [{ orderId: 1001 }, 'orderId is missing'],
    [{ product: '' }, 'product is missing'],
    [{ quantity: 0 }, 'quantity is not a positive integer'],
    [{ quantity: -1 }, 'quantity is not a positive integer'],
    [{ quantity: 1.5 }, 'quantity is not a positive integer'],
    [{ quantity: '2' }, 'quantity is not a positive integer'],
    [{ signalKey: '' }, 'signalKey is missing'],
    [{ assets: [] }, 'it lists no assets'],
    [{ assets: { as: ASSET.MODEL } }, 'it lists no assets'],
  ])('throws for %j', (change, what) => {
    expect(() => readOrder(rowWith({ ...orderData(), ...change }))).toThrow(what);
  });

  it.each([
    [{ sha256: SHA, size: 5 }, 'an asset has no "as"'],
    [null, 'an asset has no "as"'],
    [{ as: ASSET.MODEL, size: 5 }, `asset "${ASSET.MODEL}" has no sha256`],
    [{ as: ASSET.MODEL, sha256: 'abc123', size: 5 }, `asset "${ASSET.MODEL}" has no sha256`],
    [{ as: ASSET.MODEL, sha256: SHA.toUpperCase(), size: 5 }, `asset "${ASSET.MODEL}" has no sha256`],
    [{ as: ASSET.MODEL, sha256: SHA }, `asset "${ASSET.MODEL}" has no size`],
    [{ as: ASSET.MODEL, sha256: SHA, size: -1 }, `asset "${ASSET.MODEL}" has no size`],
    [{ as: ASSET.MODEL, sha256: SHA, size: '5' }, `asset "${ASSET.MODEL}" has no size`],
  ])('throws for the asset %j', (asset, what) => {
    expect(() => readOrder(rowWith({ ...orderData(), assets: [asset] }))).toThrow(`escalation esc-7 is not a fabrication order: ${what}`);
  });
});
