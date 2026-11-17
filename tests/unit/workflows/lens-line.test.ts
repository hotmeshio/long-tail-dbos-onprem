import { Machines } from '@hotmeshio/long-tail';
import { conditional } from '@hotmeshio/long-tail-dbos';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { ESCALATION_SUBTYPE, ROLE, routeKey } from '../../../src/modules/constants';
import { runLensLine } from '../../../src/workflows/lens-line';
import { ORDER_ID } from '../../helpers/order-fixtures';
import { lensPlan } from '../../helpers/order-plan-fixture';
import { scriptWaits, waitConfig, waitKeys } from '../../helpers/wait-script';

vi.mock('@hotmeshio/long-tail-dbos', () => ({ conditional: vi.fn() }));

const { DECISION, HANDOFF_ERROR, signalKeys } = Machines;
const waits = conditional as unknown as Mock;

const ROUTE = routeKey.lens(ORDER_ID);
const hop = (index: number, attempt = 1) => signalKeys.handoff(ROUTE, index, attempt);
const stop = (index: number, attempt = 1) => signalKeys.handoffError(ROUTE, index, attempt, 1);
const EDGE = hop(0);
const MOUNT = hop(1);
const INSPECT = hop(2);
const FIT = hop(3);
const HAND = hop(4);
const MANUAL_FIT = hop(5);
const OK = { received: true };
const REJECTED = { errorCode: HANDOFF_ERROR.SENDER_REJECTED, detail: 'lens seat out of tolerance' };
const JAM = { errorCode: HANDOFF_ERROR.JAM, detail: 'unit stuck' };

const run = () => runLensLine(ORDER_ID, lensPlan());

beforeEach(() => {
  waits.mockReset();
});

describe('runLensLine', () => {
  it('visits each station in turn, then the fitters', async () => {
    scriptWaits(waits, { [EDGE]: OK, [MOUNT]: OK, [INSPECT]: OK, [FIT]: OK });
    expect(await run()).toEqual({ done: true });
    expect(waitKeys(waits)).toEqual([EDGE, MOUNT, INSPECT, FIT]);
  });

  it('opens each station row on its cell role and the fit on the fitters', async () => {
    scriptWaits(waits, { [EDGE]: OK, [MOUNT]: OK, [INSPECT]: OK, [FIT]: OK });
    await run();
    expect(waitConfig(waits, EDGE)).toMatchObject({ role: ROLE.EDGE_CELL, subtype: 'edge' });
    expect(waitConfig(waits, MOUNT)).toMatchObject({ role: ROLE.MOUNT_CELL, subtype: 'mount' });
    expect(waitConfig(waits, INSPECT)).toMatchObject({ role: ROLE.INSPECT_CELL, subtype: 'inspect' });
    expect(waitConfig(waits, FIT)).toMatchObject({ role: ROLE.FITTER, subtype: ESCALATION_SUBTYPE.EXIT });
    expect(waitConfig(waits, MOUNT).metadata).toMatchObject({ orderId: ORDER_ID, lineId: 'line-1', fromMachine: 'edge-01', toMachine: 'mount-01', recipeId: 'RCP-MOUNT-A' });
  });

  it('ends the order when the fitter turns it down', async () => {
    scriptWaits(waits, { [EDGE]: OK, [MOUNT]: OK, [INSPECT]: OK, [FIT]: { received: false, note: 'left lens loose' } });
    expect(await run()).toEqual({ done: false, notes: 'left lens loose' });
  });

  it('runs a stopped hop again when the operator chooses retry', async () => {
    scriptWaits(waits, { [EDGE]: JAM, [stop(0)]: { decision: DECISION.RETRY }, [hop(0, 2)]: OK, [MOUNT]: OK, [INSPECT]: OK, [FIT]: OK });
    expect(await run()).toEqual({ done: true });
    expect(waitConfig(waits, stop(0)).role).toBe(ROLE.LINE_OPERATOR);
    expect(waitConfig(waits, MOUNT).metadata.senderJobId).toBe(`${ROUTE}-edge-01-a2`);
  });

  it('ends the order with the operator note on scrap', async () => {
    scriptWaits(waits, { [EDGE]: JAM, [stop(0)]: { decision: DECISION.SCRAP, note: 'chipped blank' } });
    expect(await run()).toEqual({ done: false, notes: 'chipped blank' });
  });

  it('names the station in the notes of a scrap with no note or detail', async () => {
    scriptWaits(waits, { [EDGE]: { errorCode: HANDOFF_ERROR.JAM }, [stop(0)]: { decision: DECISION.SCRAP } });
    expect(await run()).toEqual({ done: false, notes: `order ${ORDER_ID} was scrapped at edge-01` });
  });

  it('sends a press reject to the hand-mount bench, then the fitters', async () => {
    scriptWaits(waits, { [EDGE]: OK, [MOUNT]: OK, [INSPECT]: REJECTED, [stop(2)]: { decision: DECISION.MANUAL }, [HAND]: OK, [MANUAL_FIT]: OK });
    expect(await run()).toEqual({ done: true });
    expect(waitKeys(waits)).toEqual([EDGE, MOUNT, INSPECT, stop(2), HAND, MANUAL_FIT]);
    expect(waitConfig(waits, HAND)).toMatchObject({ role: ROLE.HAND_MOUNT, subtype: 'mount', description: `Mount the lenses for order ${ORDER_ID} by hand` });
    expect(waitConfig(waits, MANUAL_FIT).role).toBe(ROLE.FITTER);
  });

  it('ends the order when the hand bench turns it down', async () => {
    scriptWaits(waits, { [EDGE]: OK, [MOUNT]: OK, [INSPECT]: REJECTED, [stop(2)]: { decision: DECISION.MANUAL }, [HAND]: { received: false, note: 'frame cracked' } });
    expect(await run()).toEqual({ done: false, notes: 'frame cracked' });
  });

  it('sends a stop at a station with no hand bench straight to the fitters', async () => {
    scriptWaits(waits, { [EDGE]: JAM, [stop(0)]: { decision: DECISION.MANUAL }, [MANUAL_FIT]: OK });
    expect(await run()).toEqual({ done: true });
    expect(waitKeys(waits)).toEqual([EDGE, stop(0), MANUAL_FIT]);
  });

  it('sends a camera reject to the fitters when the operator chooses manual', async () => {
    scriptWaits(waits, { [EDGE]: OK, [MOUNT]: OK, [INSPECT]: OK, [FIT]: REJECTED, [stop(3)]: { decision: DECISION.MANUAL }, [MANUAL_FIT]: OK });
    expect(await run()).toEqual({ done: true });
    expect(waitConfig(waits, MANUAL_FIT).metadata.fromMachine).toBe('inspect-01');
  });
});
