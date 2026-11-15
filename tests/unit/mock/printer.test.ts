import { Machines, type MachineLink } from '@hotmeshio/long-tail';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MockPrinter } from '../../../mock/printer';
import { LOG_EVENTS } from '../../../src/modules/constants';
import { spyOnLog } from '../../helpers/log-spy';
import { TOPIC_ROOT, makePrinterHarness, type PrinterHarness } from '../../helpers/printer-harness';

const { CHANNEL, MODE, OP, REPLY_STATUS } = Machines;

let rig: PrinterHarness;
let logged: ReturnType<typeof spyOnLog>;

beforeEach(() => {
  logged = spyOnLog();
  rig = makePrinterHarness();
});

afterEach(async () => {
  await rig.printer.stop();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('MockPrinter presence and snapshot', () => {
  it('takes its identity from the line', () => {
    expect(rig.printer.ident).toEqual({ siteId: 'site-1', lineId: 'line-1', machineId: 'printer-01' });
  });

  it('connects under the client id of its identity', async () => {
    await rig.printer.start();
    expect(rig.broker.isConnected(Machines.clientIdOf(rig.printer.ident))).toBe(true);
    expect(rig.link.connected).toBe(true);
  });

  it('retains presence that says it is online', async () => {
    await rig.printer.start();
    expect(rig.retained(CHANNEL.PRESENCE)).toEqual({ online: true, software: '1.0.0', sessionId: expect.any(String) });
  });

  it('retains an idle snapshot with no jobs', async () => {
    await rig.printer.start();
    expect(rig.retained(CHANNEL.SNAPSHOT)).toEqual({
      bootId: expect.any(String), software: '1.0.0', mode: MODE.IDLE, enabled: true, recipe: null, jobs: [], alarms: [], cycles: 0,
    });
  });

  it('signs every message with its identity', async () => {
    await rig.printer.start();
    await rig.settle();
    expect(rig.heard.length).toBeGreaterThan(0);
    for (const msg of rig.heard) expect(msg.source).toEqual({ site: 'site-1', line: 'line-1', machine: 'printer-01' });
  });

  it('logs that it is online with a named event', async () => {
    await rig.printer.start();
    expect(logged.contexts(LOG_EVENTS.PRINTER_ONLINE)).toEqual([{ machineId: 'printer-01', topicRoot: TOPIC_ROOT }]);
  });

  it('leaves a will, so a lost link reads as offline', async () => {
    await rig.printer.start();
    const { sessionId } = rig.retained(CHANNEL.PRESENCE)!;
    await rig.link.disconnect(false);
    expect(rig.retained(CHANNEL.PRESENCE)).toEqual({ online: false, sessionId });
  });

  it('says it left gracefully when stopped, and disconnects', async () => {
    await rig.printer.start();
    const { sessionId } = rig.retained(CHANNEL.PRESENCE)!;
    await rig.printer.stop();
    expect(rig.retained(CHANNEL.PRESENCE)).toEqual({ online: false, sessionId, reason: 'graceful' });
    expect(rig.link.connected).toBe(false);
  });

  it('stops without publishing when it never connected', async () => {
    await rig.printer.stop();
    expect(rig.retained(CHANNEL.PRESENCE)).toBeUndefined();
  });

  it('starts a new session and keeps its boot id when started again', async () => {
    await rig.printer.start();
    const first = { ...rig.retained(CHANNEL.PRESENCE)!, ...rig.retained(CHANNEL.SNAPSHOT)! };
    await rig.printer.stop();
    await rig.printer.start();
    expect(rig.retained(CHANNEL.PRESENCE)!.sessionId).not.toBe(first.sessionId);
    expect(rig.retained(CHANNEL.SNAPSHOT)!.bootId).toBe(first.bootId);
  });

  it('publishes nothing on a timer when heartbeats are off', async () => {
    vi.useFakeTimers();
    await rig.printer.start();
    await vi.advanceTimersByTimeAsync(Machines.PRESENCE_HEARTBEAT_SEC * 3000);
    expect(rig.bodies(CHANNEL.PRESENCE)).toHaveLength(1);
  });

  it('repeats presence and snapshot on a timer until stopped', async () => {
    vi.useFakeTimers();
    rig = makePrinterHarness({ heartbeats: true });
    await rig.printer.start();
    await vi.advanceTimersByTimeAsync(Machines.PRESENCE_HEARTBEAT_SEC * 1000);
    expect(rig.bodies(CHANNEL.PRESENCE)).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(Machines.SNAPSHOT_HEARTBEAT_SEC * 1000);
    const snapshots = rig.bodies(CHANNEL.SNAPSHOT).length;
    expect(snapshots).toBeGreaterThan(1);
    await rig.printer.stop();
    await vi.advanceTimersByTimeAsync(Machines.SNAPSHOT_HEARTBEAT_SEC * 3000);
    expect(rig.bodies(CHANNEL.SNAPSHOT)).toHaveLength(snapshots);
  });

  it('announces itself again when the link is restored', async () => {
    const published: string[] = [];
    let restore = () => undefined as void;
    const link: MachineLink = {
      connected: true,
      connect: async (opts) => { restore = opts.onRestored ?? restore; },
      publish: async (topic) => { published.push(topic); },
      subscribe: async () => undefined,
      disconnect: async () => undefined,
    };
    const printer = new MockPrinter(rig.line.machines[0], rig.line, link, { topicRoot: TOPIC_ROOT, printMs: 4, heartbeats: false });
    await printer.start();
    published.length = 0;
    restore();
    await new Promise<void>((done) => setImmediate(done));
    expect(published).toEqual([rig.topic(CHANNEL.PRESENCE), rig.topic(CHANNEL.SNAPSHOT)]);
  });
});

describe('MockPrinter commands', () => {
  beforeEach(async () => { await rig.printer.start(); });

  it('publishes a snapshot when asked for one', async () => {
    const before = rig.bodies(CHANNEL.SNAPSHOT).length;
    const cmdId = rig.send(OP.SNAPSHOT);
    await rig.settle();
    expect(rig.replies()).toEqual([{ cmdId, status: REPLY_STATUS.ACCEPTED, reason: 'snapshot published' }]);
    expect(rig.bodies(CHANNEL.SNAPSHOT)).toHaveLength(before + 1);
  });

  it.each([OP.START, 'self-destruct'])('refuses the op "%s", which it does not run', async (op) => {
    const cmdId = rig.send(op);
    await rig.settle();
    expect(rig.replies()).toEqual([{ cmdId, status: REPLY_STATUS.REFUSED, reason: `unknown op ${op}` }]);
  });

  it('refuses a command that expired before it arrived', async () => {
    const expiresAt = new Date(Date.now() - 1000).toISOString();
    const before = rig.bodies(CHANNEL.SNAPSHOT).length;
    const cmdId = rig.send(OP.SNAPSHOT, { expiresAt });
    await rig.settle();
    expect(rig.replies()).toEqual([{ cmdId, status: REPLY_STATUS.REFUSED, reason: `expired at ${expiresAt}` }]);
    expect(rig.bodies(CHANNEL.SNAPSHOT)).toHaveLength(before);
  });

  it('runs a command that has not expired yet', async () => {
    rig.send(OP.SNAPSHOT, { expiresAt: new Date(Date.now() + 60_000).toISOString() });
    await rig.settle();
    expect(rig.replies()[0].status).toBe(REPLY_STATUS.ACCEPTED);
  });

  it('answers a repeated command id with its first answer, without running it again', async () => {
    const cmdId = rig.send(OP.SNAPSHOT);
    await rig.settle();
    const before = rig.bodies(CHANNEL.SNAPSHOT).length;
    rig.send(OP.SNAPSHOT, {}, cmdId);
    await rig.settle();
    expect(rig.replies()[1]).toEqual({ cmdId, status: REPLY_STATUS.ACCEPTED, reason: 'snapshot published (repeat)' });
    expect(rig.bodies(CHANNEL.SNAPSHOT)).toHaveLength(before);
  });

  it('answers commands in the order they arrive', async () => {
    const ids = [rig.send(OP.SNAPSHOT), rig.send('self-destruct'), rig.send(OP.SNAPSHOT)];
    await rig.settle();
    expect(rig.replies().map((reply) => reply.cmdId)).toEqual(ids);
  });

  it.each([
    ['no command id', { op: OP.SNAPSHOT, args: {} }],
    ['no op', { cmdId: 'cmd-1', args: {} }],
    ['an empty body', {}],
  ])('ignores a command with %s', async (_name, body) => {
    rig.publishCommand(body);
    await rig.settle();
    expect(rig.replies()).toEqual([]);
  });

  it('keeps answering after a payload that is not an envelope', async () => {
    rig.broker.publish(rig.topic(CHANNEL.CMD), 'not json');
    const cmdId = rig.send(OP.SNAPSHOT);
    await rig.settle();
    expect(rig.replies().map((reply) => reply.cmdId)).toEqual([cmdId]);
  });

  it('refuses to withdraw a job it does not hold', async () => {
    const cmdId = rig.send(OP.CANCEL, { jobId: 'order-9-print' });
    await rig.settle();
    expect(rig.replies()).toEqual([{ cmdId, status: REPLY_STATUS.REFUSED, reason: 'no open job order-9-print' }]);
  });
});
