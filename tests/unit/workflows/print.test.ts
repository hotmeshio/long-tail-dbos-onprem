import { Machines } from '@hotmeshio/long-tail';
import { conditional } from '@hotmeshio/long-tail-dbos';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { ESCALATION_SUBTYPE, ROLE, routeKey } from '../../../src/modules/constants';
import { printFrame } from '../../../src/workflows/print';
import { ORDER_ID } from '../../helpers/order-fixtures';
import { printPlan } from '../../helpers/order-plan-fixture';
import { scriptWaits, waitConfig, waitKeys } from '../../helpers/wait-script';

vi.mock('@hotmeshio/long-tail-dbos', () => ({ conditional: vi.fn() }));

const { DECISION, HANDOFF_ERROR, signalKeys } = Machines;
const waits = conditional as unknown as Mock;

const ROUTE = routeKey.print(ORDER_ID);
const PRINT = signalKeys.handoff(ROUTE, 0, 1);
const REPRINT = signalKeys.handoff(ROUTE, 0, 2);
const UNLOAD = signalKeys.handoff(ROUTE, 1, 1);
const MANUAL_UNLOAD = signalKeys.handoff(ROUTE, 2, 1);
const SERVICING = signalKeys.handoffError(ROUTE, 0, 1, 1);
const JAM = { errorCode: HANDOFF_ERROR.JAM, detail: 'nozzle clog' };
const plan = printPlan();

const print = () => printFrame(ORDER_ID, 'round-48', plan);

beforeEach(() => {
  waits.mockReset();
});

describe('printFrame', () => {
  it('prints, then waits for the unload', async () => {
    scriptWaits(waits, { [PRINT]: { received: true }, [UNLOAD]: { received: true, unitsGood: 1 } });
    expect(await print()).toEqual({ done: true });
    expect(waitKeys(waits)).toEqual([PRINT, UNLOAD]);
  });

  it('opens the print on the printer queue with the frame file and the printer serial', async () => {
    scriptWaits(waits, { [PRINT]: { received: true }, [UNLOAD]: {} });
    await print();
    const config = waitConfig(waits, PRINT);
    expect(config).toMatchObject({ role: ROLE.PRINTER_FLEET, subtype: ESCALATION_SUBTYPE.PRINTING, timeout: '4h' });
    expect(config.description).toBe(`Print the round-48 frame for order ${ORDER_ID} on p1s-01`);
    expect(config.metadata).toMatchObject({
      siteId: 'site-1',
      lineId: 'print-1',
      orderId: ORDER_ID,
      orderRef: ORDER_ID,
      serialNumber: 'PRN-001',
      model: 'model-b',
      toMachine: 'p1s-01',
      artifactUrl: plan.artifactUrl,
      artifactSha256: plan.artifactSha256,
    });
  });

  it('opens the unload for the unload people, from the printer', async () => {
    scriptWaits(waits, { [PRINT]: { received: true }, [UNLOAD]: {} });
    await print();
    const config = waitConfig(waits, UNLOAD);
    expect(config).toMatchObject({ role: ROLE.PRINT_UNLOAD, subtype: ESCALATION_SUBTYPE.UNLOAD });
    expect(config.metadata).toMatchObject({ fromMachine: 'p1s-01', toMachine: null, serialNumber: 'PRN-001', artifactUrl: null });
  });

  it('ends the order when the unloader finds no good frame', async () => {
    scriptWaits(waits, { [PRINT]: { received: true }, [UNLOAD]: { received: true, unitsGood: 0, note: 'warped' } });
    expect(await print()).toEqual({ done: false, notes: 'warped' });
  });

  it('ends the order when the unload row expires', async () => {
    scriptWaits(waits, { [PRINT]: { received: true }, [UNLOAD]: false });
    expect(await print()).toEqual({ done: false, notes: 'no receipt before the timeout' });
  });

  it('sends a stopped print to servicing and prints again on retry', async () => {
    scriptWaits(waits, { [PRINT]: JAM, [SERVICING]: { decision: DECISION.RETRY }, [REPRINT]: { received: true }, [UNLOAD]: {} });
    expect(await print()).toEqual({ done: true });
    expect(waitKeys(waits)).toEqual([PRINT, SERVICING, REPRINT, UNLOAD]);
    expect(waitConfig(waits, SERVICING)).toMatchObject({ role: ROLE.PRINT_SERVICING, subtype: HANDOFF_ERROR.JAM });
    expect(waitConfig(waits, UNLOAD).metadata.senderJobId).toBe(`${ROUTE}-p1s-01-a2`);
  });

  it('unloads by hand when servicing chooses manual', async () => {
    scriptWaits(waits, { [PRINT]: JAM, [SERVICING]: { decision: DECISION.MANUAL }, [MANUAL_UNLOAD]: { received: true } });
    expect(await print()).toEqual({ done: true });
    expect(waitConfig(waits, MANUAL_UNLOAD).metadata.fromMachine).toBeNull();
  });

  it('ends the order with the servicing note on scrap', async () => {
    scriptWaits(waits, { [PRINT]: JAM, [SERVICING]: { decision: DECISION.SCRAP, note: 'spool ran out' } });
    expect(await print()).toEqual({ done: false, notes: 'spool ran out' });
  });

  it('falls back to the failure detail when a scrap has no note', async () => {
    scriptWaits(waits, { [PRINT]: JAM, [SERVICING]: { decision: DECISION.SCRAP } });
    expect(await print()).toEqual({ done: false, notes: 'nozzle clog' });
  });
});
