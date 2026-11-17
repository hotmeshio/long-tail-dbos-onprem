import { Machines } from '@hotmeshio/long-tail';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LOG_EVENTS } from '../../../src/modules/constants';
import { spyOnLog } from '../../helpers/log-spy';
import { ARTIFACT_URL, dispatchArgs, makePrinterHarness, stubArtifact, type PrinterHarness } from '../../helpers/printer-harness';

const { CHANNEL, JOB_EVENT, MODE, OP, REPLY_STATUS } = Machines;
const JOB_ID = 'A-1042-print';
const UNIT_IDS = ['A-1042-1', 'A-1042-2'];

let rig: PrinterHarness;
let logged: ReturnType<typeof spyOnLog>;

async function startRig(cycleMs = 4): Promise<void> {
  rig = makePrinterHarness({ cycleMs });
  await rig.printer.start();
}

/** Wait until the observer has heard a job event. */
async function heardEvent(event: string): Promise<void> {
  await vi.waitFor(() => expect(rig.jobEvents().map((body) => body.event)).toContain(event), { interval: 1 });
}

beforeEach(async () => {
  logged = spyOnLog();
  await startRig();
});

afterEach(async () => {
  await rig.settle();
  await rig.printer.stop();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('MockPrinter dispatch', () => {
  it('accepts a job after fetching the file it was pointed at', async () => {
    const artifact = stubArtifact();
    const cmdId = rig.send(OP.DISPATCH, dispatchArgs());
    await rig.settle();
    expect(rig.replies()).toEqual([{ cmdId, status: REPLY_STATUS.ACCEPTED, reason: `queued ${JOB_ID}` }]);
    expect(artifact.calls.map((call) => call.url)).toEqual([ARTIFACT_URL]);
  });

  it('reports each unit queued, started, in progress and arrived, in that order', async () => {
    stubArtifact();
    rig.send(OP.DISPATCH, dispatchArgs());
    await rig.settle();
    const events = rig.jobEvents();
    expect(events.map((body) => body.event)).toEqual([
      ...Array(2).fill(JOB_EVENT.QUEUED), ...Array(2).fill(JOB_EVENT.STARTED), ...Array(6).fill(JOB_EVENT.PROGRESS), ...Array(2).fill(JOB_EVENT.ARRIVED),
    ]);
    expect(events.filter((body) => body.event === JOB_EVENT.PROGRESS).map((body) => body.percent)).toEqual([25, 25, 50, 50, 75, 75]);
    expect(events.filter((body) => body.event === JOB_EVENT.ARRIVED).map((body) => body.unitId)).toEqual(UNIT_IDS);
  });

  it('describes the unit, order and recipe on every job event', async () => {
    stubArtifact();
    rig.send(OP.DISPATCH, dispatchArgs({ from: 'loader-01' }));
    await rig.settle();
    const events = rig.jobEvents();
    expect(events[0]).toEqual({
      event: JOB_EVENT.QUEUED, jobId: JOB_ID, unitId: UNIT_IDS[0], orderRef: 'A-1042', recipe: { id: 'print-file', version: '1' }, carrierId: null,
    });
    expect(events.at(-1)).toMatchObject({ event: JOB_EVENT.ARRIVED, jobId: JOB_ID, unitId: UNIT_IDS[1], peer: 'loader-01' });
  });

  it('names no peer for a job that came from no machine', async () => {
    stubArtifact();
    rig.send(OP.DISPATCH, dispatchArgs());
    await rig.settle();
    expect(rig.jobEvents().at(-1)!.peer).toBeNull();
  });

  it('shows the job queued, then running, then gone in its snapshots', async () => {
    stubArtifact();
    rig.send(OP.DISPATCH, dispatchArgs());
    await rig.settle();
    const [, queued, running, done] = rig.bodies(CHANNEL.SNAPSHOT);
    expect(queued).toMatchObject({ mode: MODE.IDLE, jobs: [{ jobId: JOB_ID, units: UNIT_IDS, status: 'queued' }], cycles: 0 });
    expect(running).toMatchObject({ mode: MODE.RUNNING, jobs: [{ jobId: JOB_ID, units: UNIT_IDS, status: 'running' }] });
    expect(done).toMatchObject({ mode: MODE.IDLE, jobs: [], cycles: 2 });
    expect(rig.retained(CHANNEL.SNAPSHOT)).toEqual(done);
  });

  it('logs the job queued and done with named events', async () => {
    stubArtifact();
    rig.send(OP.DISPATCH, dispatchArgs());
    await rig.settle();
    expect(logged.contexts(LOG_EVENTS.PRINTER_JOB_QUEUED)).toEqual([{ jobId: JOB_ID, units: 2 }]);
    expect(logged.contexts(LOG_EVENTS.PRINTER_JOB_DONE)).toEqual([{ jobId: JOB_ID, units: 2 }]);
    expect(logged.events()).not.toContain(LOG_EVENTS.PRINTER_JOB_FAILED);
  });

  it('prints one job for a dispatch repeated under the same command id', async () => {
    const artifact = stubArtifact();
    const cmdId = rig.send(OP.DISPATCH, dispatchArgs());
    rig.send(OP.DISPATCH, dispatchArgs(), cmdId);
    await rig.settle();
    expect(rig.replies()).toEqual([
      { cmdId, status: REPLY_STATUS.ACCEPTED, reason: `queued ${JOB_ID}` },
      { cmdId, status: REPLY_STATUS.ACCEPTED, reason: `queued ${JOB_ID} (repeat)` },
    ]);
    expect(artifact.calls).toHaveLength(1);
    expect(rig.jobEvents().filter((body) => body.event === JOB_EVENT.ARRIVED)).toHaveLength(2);
  });

  it('prints one job for the same job dispatched under a new command id', async () => {
    await startRig(40);
    stubArtifact();
    rig.send(OP.DISPATCH, dispatchArgs());
    const again = rig.send(OP.DISPATCH, dispatchArgs());
    await rig.settle();
    expect(rig.replies()[1]).toEqual({ cmdId: again, status: REPLY_STATUS.ACCEPTED, reason: 'job already queued' });
    expect(rig.jobEvents().filter((body) => body.event === JOB_EVENT.QUEUED)).toHaveLength(2);
  });

  it('prints jobs one after the other', async () => {
    stubArtifact();
    rig.send(OP.DISPATCH, dispatchArgs());
    rig.send(OP.DISPATCH, dispatchArgs({ jobId: 'order-1002-print', orderRef: 'order-1002', units: [{ unitId: 'order-1002-1', carrierId: null }] }));
    await rig.settle();
    const ends = rig.jobEvents().filter((body) => body.event === JOB_EVENT.STARTED || body.event === JOB_EVENT.ARRIVED);
    expect(ends.map((body) => `${body.event} ${body.unitId}`)).toEqual([
      `${JOB_EVENT.STARTED} A-1042-1`, `${JOB_EVENT.STARTED} A-1042-2`, `${JOB_EVENT.ARRIVED} A-1042-1`, `${JOB_EVENT.ARRIVED} A-1042-2`,
      `${JOB_EVENT.STARTED} order-1002-1`, `${JOB_EVENT.ARRIVED} order-1002-1`,
    ]);
    expect(rig.retained(CHANNEL.SNAPSHOT)!.cycles).toBe(3);
  });
});

describe('MockPrinter cancel', () => {
  it('withdraws a running job, which then never arrives', async () => {
    await startRig(40);
    stubArtifact();
    rig.send(OP.DISPATCH, dispatchArgs());
    await heardEvent(JOB_EVENT.STARTED);
    const cmdId = rig.send(OP.CANCEL, { jobId: JOB_ID });
    await rig.settle();
    expect(rig.replies()[1]).toEqual({ cmdId, status: REPLY_STATUS.ACCEPTED, reason: `withdrew ${JOB_ID}` });
    const events = rig.jobEvents().map((body) => body.event);
    expect(events.filter((event) => event === JOB_EVENT.WITHDRAWN)).toHaveLength(2);
    expect(events).not.toContain(JOB_EVENT.ARRIVED);
    expect(rig.retained(CHANNEL.SNAPSHOT)).toMatchObject({ mode: MODE.IDLE, jobs: [], cycles: 0 });
    expect(logged.events()).not.toContain(LOG_EVENTS.PRINTER_JOB_DONE);
  });

  it('withdraws a queued job before it starts', async () => {
    await startRig(40);
    stubArtifact();
    rig.send(OP.DISPATCH, dispatchArgs());
    rig.send(OP.DISPATCH, dispatchArgs({ jobId: 'order-1002-print', units: [{ unitId: 'order-1002-1', carrierId: null }] }));
    rig.send(OP.CANCEL, { jobId: 'order-1002-print' });
    await rig.settle();
    const second = rig.jobEvents().filter((body) => body.jobId === 'order-1002-print').map((body) => body.event);
    expect(second).toEqual([JOB_EVENT.QUEUED, JOB_EVENT.WITHDRAWN]);
    expect(rig.retained(CHANNEL.SNAPSHOT)!.cycles).toBe(2);
  });

  it('refuses to withdraw a job that is already printed', async () => {
    stubArtifact();
    rig.send(OP.DISPATCH, dispatchArgs());
    await rig.settle();
    const cmdId = rig.send(OP.CANCEL, { jobId: JOB_ID });
    await rig.settle();
    expect(rig.replies()[1]).toEqual({ cmdId, status: REPLY_STATUS.REFUSED, reason: `no open job ${JOB_ID}` });
    expect(rig.jobEvents().map((body) => body.event)).not.toContain(JOB_EVENT.WITHDRAWN);
  });
});
