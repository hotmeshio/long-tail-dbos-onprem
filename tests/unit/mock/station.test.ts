import { Machines } from '@hotmeshio/long-tail';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LOG_EVENTS } from '../../../src/modules/constants';
import { spyOnLog } from '../../helpers/log-spy';
import { makeStationHarness, stationJob, type StationHarness } from '../../helpers/station-harness';

const { CHANNEL, JOB_EVENT, JOB_RESULT, MODE, OP, REPLY_STATUS } = Machines;
const EDGE = 'edge-01';
const MOUNT = 'mount-01';
const EDGE_JOB = 'A-1042-lens-edge-01';

let rig: StationHarness;
let logged: ReturnType<typeof spyOnLog>;

const eventsOf = (machineId: string) => rig.jobEvents(machineId).map((body) => body.event);

async function startRig(...args: Parameters<typeof makeStationHarness>): Promise<void> {
  rig = makeStationHarness(...args);
  await rig.start();
}

beforeEach(async () => {
  logged = spyOnLog();
  await startRig();
});

afterEach(async () => {
  await rig.settle();
  await rig.stop();
  vi.restoreAllMocks();
});

describe('MockStation', () => {
  it('announces itself online with an idle snapshot', () => {
    expect(rig.retained(EDGE, CHANNEL.PRESENCE)).toMatchObject({ online: true, software: '1.4.0' });
    expect(rig.retained(EDGE, CHANNEL.SNAPSHOT)).toMatchObject({ mode: MODE.IDLE, jobs: [], cycles: 0 });
    expect(logged.contexts(LOG_EVENTS.STATION_ONLINE)).toContainEqual({ machineId: EDGE, topicRoot: 'line/v1' });
  });

  it('runs a unit entering the line: queued, arrived, started, finished OK', async () => {
    const cmdId = rig.send(EDGE, OP.DISPATCH, stationJob(EDGE));
    await rig.settle();
    expect(rig.replies(EDGE)).toEqual([{ cmdId, status: REPLY_STATUS.ACCEPTED, reason: `queued ${EDGE_JOB}` }]);
    expect(eventsOf(EDGE)).toEqual([JOB_EVENT.QUEUED, JOB_EVENT.ARRIVED, JOB_EVENT.STARTED, JOB_EVENT.FINISHED]);
    expect(rig.jobEvents(EDGE).at(-1)).toMatchObject({ jobId: EDGE_JOB, unitId: 'A-1042', orderRef: 'A-1042', result: JOB_RESULT.OK, reason: null });
  });

  it('answers the dispatch before it reports the unit arrived', async () => {
    rig.send(EDGE, OP.DISPATCH, stationJob(EDGE));
    await rig.settle();
    const order = rig.heard.filter((msg) => msg.machineId === EDGE).map((msg) => msg.body.event ?? msg.channel);
    expect(order.indexOf(CHANNEL.REPLY)).toBeLessThan(order.indexOf(JOB_EVENT.ARRIVED));
  });

  it('holds a finished unit until the next station has a job for it', async () => {
    rig.send(EDGE, OP.DISPATCH, stationJob(EDGE));
    await rig.settle();
    expect(rig.floor.holder('A-1042')).toBe(EDGE);
    expect(eventsOf(EDGE)).not.toContain(JOB_EVENT.RELEASED);

    rig.send(MOUNT, OP.DISPATCH, stationJob(MOUNT, { from: EDGE }));
    await rig.settle();
    expect(rig.jobEvents(EDGE).at(-1)).toMatchObject({ event: JOB_EVENT.RELEASED, peer: MOUNT });
    expect(eventsOf(MOUNT)).toEqual([JOB_EVENT.QUEUED, JOB_EVENT.ARRIVED, JOB_EVENT.STARTED, JOB_EVENT.FINISHED]);
    expect(rig.jobEvents(MOUNT)[1]).toMatchObject({ event: JOB_EVENT.ARRIVED, peer: EDGE });
    expect(rig.floor.holder('A-1042')).toBe(MOUNT);
  });

  it('waits for a unit that is still upstream', async () => {
    rig.send(MOUNT, OP.DISPATCH, stationJob(MOUNT, { from: EDGE }));
    await rig.settle();
    expect(eventsOf(MOUNT)).toEqual([JOB_EVENT.QUEUED]);
  });

  it('counts finished units in its snapshot', async () => {
    rig.send(EDGE, OP.DISPATCH, stationJob(EDGE));
    await rig.settle();
    expect(rig.retained(EDGE, CHANNEL.SNAPSHOT)).toMatchObject({ mode: MODE.IDLE, jobs: [], cycles: 1 });
    expect(logged.contexts(LOG_EVENTS.STATION_JOB_DONE)).toEqual([{ machineId: EDGE, jobId: EDGE_JOB, units: 1 }]);
  });

  it('rejects the first job of a listed order with its reject reason, and keeps the unit', async () => {
    await rig.stop();
    await startRig({}, { [EDGE]: { failOrders: ['A-1042'] } });
    rig.send(EDGE, OP.DISPATCH, stationJob(EDGE));
    await rig.settle();
    expect(rig.jobEvents(EDGE).at(-1)).toMatchObject({ event: JOB_EVENT.FINISHED, result: JOB_RESULT.REJECT, reason: 'EDGE-FAILED' });
    expect(rig.floor.holder('A-1042')).toBeUndefined();
    expect(logged.contexts(LOG_EVENTS.STATION_JOB_FAILED)).toEqual([{ machineId: EDGE, jobId: EDGE_JOB, reason: 'EDGE-FAILED' }]);

    rig.send(EDGE, OP.DISPATCH, stationJob(EDGE, { jobId: `${EDGE_JOB}-a2` }));
    await rig.settle();
    expect(rig.jobEvents(EDGE).at(-1)).toMatchObject({ jobId: `${EDGE_JOB}-a2`, result: JOB_RESULT.OK });
  });

  it('refuses a dispatch with no units', async () => {
    rig.send(EDGE, OP.DISPATCH, stationJob(EDGE, { units: [] }));
    await rig.settle();
    expect(rig.replies(EDGE)[0]).toMatchObject({ status: REPLY_STATUS.REFUSED, reason: 'missing jobId, recipe or units' });
  });

  it('refuses a recipe version it does not hold', async () => {
    rig.send(EDGE, OP.DISPATCH, stationJob(EDGE, { recipe: { id: 'RCP-EDGE-A', version: '9' } }));
    await rig.settle();
    expect(rig.replies(EDGE)[0]).toMatchObject({ status: REPLY_STATUS.REFUSED, reason: 'recipe RCP-EDGE-A v9 is not held' });
    expect(eventsOf(EDGE)).toEqual([]);
  });

  it('accepts the same job twice and runs it once', async () => {
    rig.send(MOUNT, OP.DISPATCH, stationJob(MOUNT, { from: EDGE }));
    rig.send(MOUNT, OP.DISPATCH, stationJob(MOUNT, { from: EDGE }));
    await rig.settle();
    expect(rig.replies(MOUNT).map((body) => body.reason)).toEqual(['queued A-1042-lens-mount-01', 'job already queued']);
    expect(eventsOf(MOUNT)).toEqual([JOB_EVENT.QUEUED]);
  });

  it('withdraws a cancelled job and stops waiting for its unit', async () => {
    rig.send(MOUNT, OP.DISPATCH, stationJob(MOUNT, { from: EDGE }));
    await rig.settle();
    rig.send(MOUNT, OP.CANCEL, { jobId: 'A-1042-lens-mount-01' });
    rig.send(EDGE, OP.DISPATCH, stationJob(EDGE));
    await rig.settle();
    expect(eventsOf(MOUNT)).toEqual([JOB_EVENT.QUEUED, JOB_EVENT.WITHDRAWN]);
    expect(rig.floor.holder('A-1042')).toBe(EDGE);
  });
});
