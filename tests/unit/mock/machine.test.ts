import { Machines } from '@hotmeshio/long-tail';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { JOB_STATUS, sleep } from '../../../mock/machine';
import { spyOnLog } from '../../helpers/log-spy';
import { makeStationHarness, stationJob, type StationHarness } from '../../helpers/station-harness';

const { CHANNEL, JOB_EVENT, MODE, OP, REPLY_STATUS } = Machines;
const EDGE = 'edge-01';
const MOUNT = 'mount-01';
const MOUNT_JOB = 'A-1042-lens-mount-01';

let rig: StationHarness;

beforeEach(async () => {
  spyOnLog();
  rig = makeStationHarness();
  await rig.start();
});

afterEach(async () => {
  await rig.settle();
  await rig.stop();
  vi.restoreAllMocks();
});

describe('MockMachine', () => {
  it('takes its identity from the line, address included', () => {
    expect(rig.station(EDGE).ident).toMatchObject({ siteId: 'site-1', lineId: 'line-1', machineId: EDGE });
    expect(rig.station(EDGE).machineId).toBe(EDGE);
  });

  it('answers a repeated command id with its first answer and does the work once', async () => {
    const cmdId = rig.send(EDGE, OP.DISPATCH, stationJob(EDGE));
    await rig.settle();
    rig.send(EDGE, OP.DISPATCH, stationJob(EDGE), cmdId);
    await rig.settle();
    expect(rig.replies(EDGE).map((body) => body.reason)).toEqual(['queued A-1042-lens-edge-01', 'queued A-1042-lens-edge-01 (repeat)']);
    expect(rig.jobEvents(EDGE).filter((body) => body.event === JOB_EVENT.QUEUED)).toHaveLength(1);
  });

  it('refuses a command that expired', async () => {
    const expiresAt = new Date(Date.now() - 1000).toISOString();
    rig.send(EDGE, OP.DISPATCH, stationJob(EDGE, { expiresAt }));
    await rig.settle();
    expect(rig.replies(EDGE)).toEqual([expect.objectContaining({ status: REPLY_STATUS.REFUSED, reason: `expired at ${expiresAt}` })]);
  });

  it('refuses an op it does not know', async () => {
    rig.send(EDGE, 'polish');
    await rig.settle();
    expect(rig.replies(EDGE)[0]).toMatchObject({ status: REPLY_STATUS.REFUSED, reason: 'unknown op polish' });
  });

  it('publishes its snapshot on request, listing open jobs', async () => {
    rig.send(MOUNT, OP.DISPATCH, stationJob(MOUNT, { from: EDGE }));
    rig.send(MOUNT, OP.SNAPSHOT);
    await rig.settle();
    expect(rig.replies(MOUNT).at(-1)).toMatchObject({ status: REPLY_STATUS.ACCEPTED, reason: 'snapshot published' });
    expect(rig.retained(MOUNT, CHANNEL.SNAPSHOT)).toMatchObject({
      mode: MODE.IDLE,
      enabled: true,
      jobs: [{ jobId: MOUNT_JOB, units: ['A-1042'], status: JOB_STATUS.QUEUED }],
    });
  });

  it('refuses to cancel a job it does not hold', async () => {
    rig.send(EDGE, OP.CANCEL, { jobId: 'nothing' });
    await rig.settle();
    expect(rig.replies(EDGE)[0]).toMatchObject({ status: REPLY_STATUS.REFUSED, reason: 'no open job nothing' });
  });

  it('withdraws an open job on cancel and drops it from the snapshot', async () => {
    rig.send(MOUNT, OP.DISPATCH, stationJob(MOUNT, { from: EDGE }));
    rig.send(MOUNT, OP.CANCEL, { jobId: MOUNT_JOB });
    await rig.settle();
    expect(rig.replies(MOUNT).at(-1)).toMatchObject({ status: REPLY_STATUS.ACCEPTED, reason: `withdrew ${MOUNT_JOB}` });
    expect(rig.jobEvents(MOUNT).at(-1)).toMatchObject({ event: JOB_EVENT.WITHDRAWN, jobId: MOUNT_JOB });
    expect(rig.retained(MOUNT, CHANNEL.SNAPSHOT)?.jobs).toEqual([]);
  });

  it('ignores a command with no id', async () => {
    rig.broker.publish(
      Machines.machineTopic('line/v1', rig.station(EDGE).ident, CHANNEL.CMD),
      JSON.stringify(Machines.buildEnvelope(rig.station(EDGE).ident, { op: OP.SNAPSHOT })),
    );
    await rig.settle();
    expect(rig.replies(EDGE)).toEqual([]);
  });

  it('says it is offline when it stops', async () => {
    await rig.station(EDGE).stop();
    expect(rig.retained(EDGE, CHANNEL.PRESENCE)).toMatchObject({ online: false, reason: 'graceful' });
  });
});

describe('sleep', () => {
  it('resolves after the given time', async () => {
    vi.useFakeTimers();
    const done = vi.fn();
    void sleep(50).then(done);
    await vi.advanceTimersByTimeAsync(49);
    expect(done).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toHaveBeenCalled();
    vi.useRealTimers();
  });
});
