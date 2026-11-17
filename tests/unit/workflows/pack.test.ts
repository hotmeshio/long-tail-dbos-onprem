import { DBOS } from '@dbos-inc/dbos-sdk';
import { conditional } from '@hotmeshio/long-tail-dbos';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import * as binActivities from '../../../src/activities/bin';
import { ESCALATION_SUBTYPE, ESCALATION_TYPE, ROLE, binWorkflowId, packageKey } from '../../../src/modules/constants';
import { packOrder } from '../../../src/workflows/pack';
import { rollupBinWorkflow } from '../../../src/workflows/rollup-bin';
import { ORDER_ID } from '../../helpers/order-fixtures';
import { packPlan } from '../../helpers/order-plan-fixture';
import { scriptWaits, waitConfig } from '../../helpers/wait-script';

const startBin = vi.hoisted(() => vi.fn());
vi.mock('@dbos-inc/dbos-sdk', () => ({
  DBOS: { registerWorkflow: vi.fn((fn: unknown) => fn), startWorkflow: vi.fn(() => startBin) },
}));
vi.mock('@hotmeshio/long-tail-dbos', () => ({ conditional: vi.fn() }));
vi.mock('../../../src/lib/durable', () => ({ proxySteps: vi.fn((activities: unknown) => activities) }));
vi.mock('../../../src/activities/bin', () => ({ binGeneration: vi.fn() }));

const waits = conditional as unknown as Mock;
const startWorkflow = DBOS.startWorkflow as unknown as Mock;
const binGeneration = vi.mocked(binActivities.binGeneration);
const PACKAGE = packageKey(ORDER_ID);
const plan = packPlan();

beforeEach(() => {
  for (const mock of [waits, startWorkflow, startBin, binGeneration]) mock.mockReset();
  startWorkflow.mockReturnValue(startBin);
  binGeneration.mockResolvedValue(3);
  scriptWaits(waits, { [PACKAGE]: { $trigger: 'count', $accumulated: [] } });
});

describe('packOrder', () => {
  it('opens the bin of the current fill before the package waits', async () => {
    expect(await packOrder(ORDER_ID, plan)).toEqual({ done: true });
    expect(binGeneration).toHaveBeenCalledWith('bin-7');
    expect(startWorkflow).toHaveBeenCalledWith(rollupBinWorkflow, { workflowID: binWorkflowId('bin-7', 3) });
    expect(startBin).toHaveBeenCalledWith({ binKey: 'bin-7', destination: 'Portland', max: 12, timeout: '4h' });
    expect(startBin.mock.invocationCallOrder[0]).toBeLessThan(waits.mock.invocationCallOrder[0]);
  });

  it('parks the boxed order on the package queue, taking one scan', async () => {
    await packOrder(ORDER_ID, plan);
    expect(waitConfig(waits, PACKAGE)).toMatchObject({
      role: ROLE.PACKAGE,
      type: ESCALATION_TYPE.ROLLUP,
      subtype: ESCALATION_SUBTYPE.PACKAGE,
      metadata: { orderId: ORDER_ID, binKey: 'bin-7' },
      accumulate: { max: 1 },
      timeout: '24h',
    });
  });

  it('ends the order when the package is never scanned', async () => {
    scriptWaits(waits, { [PACKAGE]: false });
    expect(await packOrder(ORDER_ID, plan)).toEqual({ done: false, notes: `order ${ORDER_ID} was not scanned into bin-7` });
  });

  it('ends the order when the package row is cancelled', async () => {
    scriptWaits(waits, { [PACKAGE]: null });
    expect((await packOrder(ORDER_ID, plan)).done).toBe(false);
  });
});
