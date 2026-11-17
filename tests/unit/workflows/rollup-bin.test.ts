import { conditional } from '@hotmeshio/long-tail-dbos';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { ESCALATION_SUBTYPE, ESCALATION_TYPE, ROLE, SHIP_VIA, TRIGGER, binWaitKey } from '../../../src/modules/constants';
import { rollupBin } from '../../../src/workflows/rollup-bin';
import { scriptWaits, waitConfig } from '../../helpers/wait-script';

vi.mock('@dbos-inc/dbos-sdk', () => ({ DBOS: { registerWorkflow: vi.fn((fn: unknown) => fn) } }));
vi.mock('@hotmeshio/long-tail-dbos', () => ({ conditional: vi.fn() }));

const waits = conditional as unknown as Mock;
const input = { binKey: 'bin-7', destination: 'Portland', max: 12, timeout: '4h' };
const BIN = binWaitKey('bin-7');
const ITEMS = [{ itemKey: 'A-1042' }, { itemKey: 'A-1043' }];

beforeEach(() => {
  waits.mockReset();
});

describe('rollupBin', () => {
  it('opens one accumulating row on the bin queue', async () => {
    scriptWaits(waits, { [BIN]: false });
    await rollupBin(input);
    expect(waitConfig(waits, BIN)).toMatchObject({
      role: ROLE.BIN,
      type: ESCALATION_TYPE.ROLLUP,
      subtype: ESCALATION_SUBTYPE.BIN,
      description: 'Boxed orders for Portland. Ships at 12 packages or at the carrier pickup.',
      metadata: { binKey: 'bin-7', destination: 'Portland' },
      accumulate: { max: 12 },
      timeout: '4h',
    });
  });

  it('ships a full bin at the pickup, with the orders in it', async () => {
    scriptWaits(waits, { [BIN]: { $trigger: TRIGGER.COUNT, $accumulated: ITEMS } });
    expect(await rollupBin(input)).toEqual({ binKey: 'bin-7', shipped: true, trigger: TRIGGER.COUNT, shipVia: SHIP_VIA.PICKUP, orders: ['A-1042', 'A-1043'] });
  });

  it('ships what the bin holds when the pickup time comes', async () => {
    scriptWaits(waits, { [BIN]: { $trigger: TRIGGER.TIMEOUT, $accumulated: ITEMS.slice(0, 1) } });
    expect(await rollupBin(input)).toMatchObject({ shipped: true, shipVia: SHIP_VIA.PICKUP, orders: ['A-1042'] });
  });

  it('ships the way the shift lead chose when resolved early', async () => {
    scriptWaits(waits, { [BIN]: { $trigger: TRIGGER.RESOLVE, $accumulated: ITEMS, shipVia: SHIP_VIA.PICKUP } });
    expect((await rollupBin(input)).shipVia).toBe(SHIP_VIA.PICKUP);
  });

  it('ships by courier when an early resolve names no way', async () => {
    scriptWaits(waits, { [BIN]: { $trigger: TRIGGER.RESOLVE, $accumulated: [] } });
    expect(await rollupBin(input)).toMatchObject({ shipVia: SHIP_VIA.COURIER, orders: [] });
  });

  it('reports a bin that closed without shipping', async () => {
    scriptWaits(waits, { [BIN]: null });
    expect(await rollupBin(input)).toEqual({ binKey: 'bin-7', shipped: false });
  });
});
