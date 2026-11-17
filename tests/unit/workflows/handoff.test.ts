import { Machines } from '@hotmeshio/long-tail';
import { conditional } from '@hotmeshio/long-tail-dbos';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { ESCALATION_SUBTYPE, ROLE, TRIGGER, WAIT_TIMEOUT } from '../../../src/modules/constants';
import { askOperator, handOff, hopFacets, jobIdFor, type Hop, type Route } from '../../../src/workflows/handoff';
import { ORDER_ID } from '../../helpers/order-fixtures';
import { EDGER, PRESS, lensPlan } from '../../helpers/order-plan-fixture';
import { scriptWaits, waitConfig, waitKeys } from '../../helpers/wait-script';

vi.mock('@hotmeshio/long-tail-dbos', () => ({ conditional: vi.fn() }));

const { DECISION, HANDOFF_ERROR, ROW_TYPE, signalKeys } = Machines;
const waits = conditional as unknown as Mock;

const ROUTE_KEY = `${ORDER_ID}-lens`;
const route: Route = { line: lensPlan(), routeKey: ROUTE_KEY, orderId: ORDER_ID };
const toPress: Hop = { index: 1, from: EDGER, to: PRESS };
const toFitter: Hop = { index: 3, from: PRESS, to: null };
const HANDOFF = signalKeys.handoff(ROUTE_KEY, 1, 1);
const ERROR_ROUND_1 = signalKeys.handoffError(ROUTE_KEY, 1, 1, 1);
const ERROR_ROUND_2 = signalKeys.handoffError(ROUTE_KEY, 1, 1, 2);
const JAM = { received: false, errorCode: HANDOFF_ERROR.JAM, detail: 'unit stuck' };

beforeEach(() => {
  waits.mockReset();
});

describe('jobIdFor', () => {
  it('names the first job by route and station', () => {
    expect(jobIdFor(ROUTE_KEY, 'edge-01')).toBe(`${ROUTE_KEY}-edge-01`);
  });

  it('names a retry as a new job', () => {
    expect(jobIdFor(ROUTE_KEY, 'edge-01', 3)).toBe(`${ROUTE_KEY}-edge-01-a3`);
  });
});

describe('hopFacets', () => {
  it('carries the order, the line and both ends of the move', () => {
    expect(hopFacets(route, toPress, 2, 3)).toMatchObject({
      orderId: ORDER_ID,
      orderRef: ORDER_ID,
      siteId: 'site-1',
      lineId: 'line-1',
      units: [{ unitId: ORDER_ID, carrierId: null }],
      jobId: `${ROUTE_KEY}-mount-01-a2`,
      senderJobId: `${ROUTE_KEY}-edge-01-a3`,
      fromMachine: 'edge-01',
      toMachine: 'mount-01',
      recipeId: PRESS.recipeId,
      recipeVersion: PRESS.recipeVersion,
      process: 'mount',
      attempt: 2,
    });
  });

  it('names the exit job and no machine when people receive', () => {
    expect(hopFacets(route, toFitter, 1)).toMatchObject({ jobId: `${ROUTE_KEY}-exit`, toMachine: null, recipeId: null, artifactUrl: null });
  });

  it('names the job after the role when the receivers are not the exit role', () => {
    expect(hopFacets(route, { ...toFitter, role: ROLE.HAND_MOUNT }, 1).jobId).toBe(`${ROUTE_KEY}-${ROLE.HAND_MOUNT}`);
  });

  it('gives a machine the file and the route its own facets', () => {
    const withFile: Route = { ...route, facets: { serialNumber: 'PRN-001' }, artifact: { url: 'http://assets.invalid/f', sha256: 'abc' } };
    expect(hopFacets(withFile, toPress, 1)).toMatchObject({ serialNumber: 'PRN-001', artifactUrl: 'http://assets.invalid/f', artifactSha256: 'abc' });
    expect(hopFacets(withFile, toFitter, 1).artifactUrl).toBeNull();
  });

  it('has no sender job at line entry', () => {
    expect(hopFacets(route, { index: 0, from: null, to: EDGER }, 1)).toMatchObject({ senderJobId: null, fromMachine: null });
  });
});

describe('handOff', () => {
  it('parks a handoff row on the receiving machine role', async () => {
    scriptWaits(waits, { [HANDOFF]: { received: true } });
    expect(await handOff(route, toPress, 1)).toEqual({ received: true, answer: { received: true } });
    expect(waitConfig(waits, HANDOFF)).toMatchObject({
      role: ROLE.MOUNT_CELL,
      type: ROW_TYPE.HANDOFF,
      subtype: 'mount',
      description: `${ORDER_ID}: edge-01 to mount-01`,
      accumulate: {},
      timeout: '30m',
    });
  });

  it('parks an exit row on the exit role when people receive', async () => {
    const key = signalKeys.handoff(ROUTE_KEY, 3, 1);
    scriptWaits(waits, { [key]: {} });
    await handOff(route, toFitter, 1);
    expect(waitConfig(waits, key)).toMatchObject({ role: ROLE.FITTER, subtype: ESCALATION_SUBTYPE.EXIT });
    expect(waitConfig(waits, key).description).toContain(`Receive ${ORDER_ID} from mount-01`);
  });

  it('uses the hop role, subtype and description when given', async () => {
    const key = signalKeys.handoff(ROUTE_KEY, 3, 1);
    scriptWaits(waits, { [key]: {} });
    await handOff(route, { ...toFitter, role: ROLE.HAND_MOUNT, subtype: 'mount', description: 'By hand' }, 1);
    expect(waitConfig(waits, key)).toMatchObject({ role: ROLE.HAND_MOUNT, subtype: 'mount', description: 'By hand' });
  });

  it('reads a cancelled row', async () => {
    scriptWaits(waits, { [HANDOFF]: null });
    expect(await handOff(route, toPress, 1)).toMatchObject({ received: false, errorCode: HANDOFF_ERROR.CANCELLED });
  });

  it('reads an expired row and a timeout trigger as a handoff timeout', async () => {
    scriptWaits(waits, { [HANDOFF]: false });
    expect((await handOff(route, toPress, 1)).errorCode).toBe(HANDOFF_ERROR.HANDOFF_TIMEOUT);
    scriptWaits(waits, { [HANDOFF]: { $trigger: TRIGGER.TIMEOUT } });
    expect((await handOff(route, toPress, 1)).errorCode).toBe(HANDOFF_ERROR.HANDOFF_TIMEOUT);
  });

  it('reads the error the gateway failed the row with', async () => {
    scriptWaits(waits, { [HANDOFF]: { errorCode: HANDOFF_ERROR.JAM, reason: 'unit stuck' } });
    expect(await handOff(route, toPress, 1)).toEqual(JAM);
  });

  it('reads a person turning the unit down, with their answer', async () => {
    const answer = { received: false, note: 'scratched lens' };
    scriptWaits(waits, { [HANDOFF]: answer });
    expect(await handOff(route, toPress, 1)).toEqual({ received: false, answer });
  });
});

describe('askOperator', () => {
  it('asks the operator role with the decisions the failure allows', async () => {
    scriptWaits(waits, { [ERROR_ROUND_1]: { decision: DECISION.RETRY } });
    expect(await askOperator(route, toPress, 1, 1, JAM)).toEqual({ decision: DECISION.RETRY });
    const config = waitConfig(waits, ERROR_ROUND_1);
    expect(config).toMatchObject({ role: ROLE.LINE_OPERATOR, type: ROW_TYPE.HANDOFF_ERROR, subtype: HANDOFF_ERROR.JAM, timeout: WAIT_TIMEOUT.OPERATOR });
    expect(config.metadata).toMatchObject({ orderId: ORDER_ID, errorCode: HANDOFF_ERROR.JAM, decisions: [DECISION.RETRY, DECISION.MANUAL, DECISION.SCRAP], round: 1 });
    expect(config.description).toBe(`${ORDER_ID} stopped at edge-01: jam. unit stuck Choose retry, manual, scrap.`);
  });

  it('asks again when the decision is not one the failure allows', async () => {
    scriptWaits(waits, { [ERROR_ROUND_1]: { decision: DECISION.RETRY }, [ERROR_ROUND_2]: { decision: DECISION.MANUAL, note: 'by hand' } });
    const rejected = { received: false, errorCode: HANDOFF_ERROR.SENDER_REJECTED };
    expect(await askOperator(route, toPress, 1, 1, rejected)).toEqual({ decision: DECISION.MANUAL, note: 'by hand' });
    expect(waitKeys(waits)).toEqual([ERROR_ROUND_1, ERROR_ROUND_2]);
    expect(waitConfig(waits, ERROR_ROUND_2).description).toMatch(/^retry is not available here\. /);
  });

  it('scraps when no decision arrives', async () => {
    scriptWaits(waits, { [ERROR_ROUND_1]: false });
    expect((await askOperator(route, toPress, 1, 1, JAM)).decision).toBe(DECISION.SCRAP);
  });
});
