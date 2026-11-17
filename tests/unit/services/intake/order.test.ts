import { describe, expect, it } from 'vitest';

import { readOrder } from '../../../../src/services/intake/order';
import { ASSET } from '../../../../src/modules/constants';
import { cloudRow, orderData, sha256Of } from '../../../helpers/order-fixtures';

const SHA = sha256Of('frame');
const RX = orderData().prescription;
const NOT_AN_ALIAS = `an asset is not one of ${ASSET.FRAME}, ${ASSET.PRESCRIPTION}`;
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
    const data = { ...orderData(), priority: 'rush', assets: [{ as: ASSET.FRAME, sha256: SHA, size: 5, path: 'orders/1/round-48.gcode.3mf' }] };
    const order = readOrder(rowWith(data));
    expect(order).toEqual({ ...orderData(), assets: [{ as: ASSET.FRAME, sha256: SHA, size: 5 }] });
  });

  it('accepts several assets and an empty file', () => {
    const assets = [{ as: ASSET.FRAME, sha256: SHA, size: 5 }, { as: ASSET.PRESCRIPTION, sha256: sha256Of(''), size: 0 }];
    expect(readOrder(rowWith(orderData({ assets }))).assets).toEqual(assets);
  });

  it('names the row and keeps the cause when the data is not JSON', () => {
    const err = (() => { try { readOrder(rowWith('{not json')); } catch (caught) { return caught as Error; } })();
    expect(err?.message).toBe('escalation esc-7 is not a production order: its data is not JSON');
    expect(err?.cause).toBeInstanceOf(SyntaxError);
  });

  it.each([null, 'null', '"text"', '7'])('throws when the row carries no data: %s', (data) => {
    expect(() => readOrder(rowWith(data))).toThrow('escalation esc-7 is not a production order: it carries no data');
  });

  it.each([
    ['orderId', 'orderId is missing'],
    ['frameStyle', 'frameStyle is missing'],
    ['lensMaterial', 'lensMaterial is missing'],
    ['coating', 'coating is missing'],
    ['lotNumber', 'lotNumber is missing'],
    ['signalKey', 'signalKey is missing'],
    ['assets', 'it lists no assets'],
    ['prescription', 'prescription is missing'],
  ])('throws when %s is missing', (key, what) => {
    expect(() => readOrder(rowWith(without(key)))).toThrow(`escalation esc-7 is not a production order: ${what}`);
  });

  it.each([
    [{ orderId: '' }, 'orderId is missing'],
    [{ orderId: 1042 }, 'orderId is missing'],
    [{ frameStyle: '' }, 'frameStyle is missing'],
    [{ signalKey: '' }, 'signalKey is missing'],
    [{ assets: [] }, 'it lists no assets'],
    [{ assets: { as: ASSET.FRAME } }, 'it lists no assets'],
    [{ prescription: 'plano' }, 'prescription is missing'],
    [{ prescription: { ...RX, pd: '63' } }, 'prescription.pd is not a number'],
    [{ prescription: { ...RX, right: null } }, 'prescription.right.sphere is not a number'],
    [{ prescription: { ...RX, left: { ...RX.left, axis: '85' } } }, 'prescription.left.axis is not a number'],
  ])('throws for %j', (change, what) => {
    expect(() => readOrder(rowWith({ ...orderData(), ...change }))).toThrow(what);
  });

  it.each([
    [{ sha256: SHA, size: 5 }, NOT_AN_ALIAS],
    [null, NOT_AN_ALIAS],
    [{ as: 'manual', sha256: SHA, size: 5 }, NOT_AN_ALIAS],
    [{ as: ASSET.FRAME, size: 5 }, `asset "${ASSET.FRAME}" has no sha256`],
    [{ as: ASSET.FRAME, sha256: 'abc123', size: 5 }, `asset "${ASSET.FRAME}" has no sha256`],
    [{ as: ASSET.FRAME, sha256: SHA.toUpperCase(), size: 5 }, `asset "${ASSET.FRAME}" has no sha256`],
    [{ as: ASSET.FRAME, sha256: SHA }, `asset "${ASSET.FRAME}" has no size`],
    [{ as: ASSET.FRAME, sha256: SHA, size: -1 }, `asset "${ASSET.FRAME}" has no size`],
    [{ as: ASSET.FRAME, sha256: SHA, size: '5' }, `asset "${ASSET.FRAME}" has no size`],
  ])('throws for the asset %j', (asset, what) => {
    expect(() => readOrder(rowWith({ ...orderData(), assets: [asset] }))).toThrow(`escalation esc-7 is not a production order: ${what}`);
  });
});
