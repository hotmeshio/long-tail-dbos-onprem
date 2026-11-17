import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { Machines } from '@hotmeshio/long-tail';

import { Floor } from '../../mock/floor';
import type { MockMachine } from '../../mock/machine';
import { MockStation, type StationSettings } from '../../mock/station';

export const STATION_TOPIC_ROOT = 'line/v1';
const LINE_FILE = resolve(__dirname, '../../lines/lens-line.json');
const OBSERVER = 'test-observer';

export interface StationEvent { machineId: string; channel: string; body: Record<string, any> }

/** The args of a dispatch for one order of one unit. */
export function stationJob(machineId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const recipes: Record<string, string> = { 'edge-01': 'RCP-EDGE-A', 'mount-01': 'RCP-MOUNT-A', 'inspect-01': 'RCP-INSPECT-A' };
  return {
    jobId: `A-1042-lens-${machineId}`,
    orderRef: 'A-1042',
    recipe: { id: recipes[machineId], version: '1' },
    units: [{ unitId: 'A-1042', carrierId: null }],
    from: null,
    ...overrides,
  };
}

/** The lens line's mock stations on one in-memory broker and one floor, with an observer that hears the line. */
export function makeStationHarness(settings: Partial<StationSettings> = {}, perMachine: Record<string, Partial<StationSettings>> = {}) {
  const broker = new Machines.MemoryBroker();
  const line = Machines.loadLine(LINE_FILE);
  const floor = new Floor();
  const stations = new Map(line.machines.map((def) => [def.machineId, new MockStation(def, line, new Machines.MemoryMachineLink(broker), {
    topicRoot: STATION_TOPIC_ROOT, cycleMs: 2, heartbeats: false, ...settings, ...perMachine[def.machineId],
  }, floor)]));
  const station = (machineId: string): MockStation => {
    const found = stations.get(machineId);
    if (!found) throw new Error(`no station ${machineId}`);
    return found;
  };
  const topic = (machine: MockMachine, channel: string) => Machines.machineTopic(STATION_TOPIC_ROOT, machine.ident, channel);
  const heard: StationEvent[] = [];
  broker.connect(OBSERVER);
  broker.subscribe(OBSERVER, Machines.lineFilter(STATION_TOPIC_ROOT, line.siteId, line.lineId), (msg) => {
    const envelope = JSON.parse(msg.payload);
    const prefix = Machines.machineTopic(STATION_TOPIC_ROOT, station(envelope.source.machine).ident, '');
    const channel = msg.topic.slice(prefix.length);
    if (channel !== Machines.CHANNEL.CMD) heard.push({ machineId: envelope.source.machine, channel, body: envelope.body });
  });

  return {
    broker, line, floor, heard, station,
    start: async () => { for (const each of stations.values()) await each.start(); },
    stop: async () => { for (const each of stations.values()) await each.stop(); },
    /** Let the broker deliver, then wait for every station to answer and run. */
    async settle(): Promise<void> {
      for (let pass = 0; pass < 3; pass++) {
        await new Promise<void>((done) => setImmediate(done));
        for (const each of stations.values()) await each.idle();
      }
      await new Promise<void>((done) => setImmediate(done));
    },
    /** Publish one command to a station; returns its cmdId. */
    send(machineId: string, op: string, args: Record<string, unknown> = {}, cmdId: string = randomUUID()): string {
      const target = station(machineId);
      broker.publish(topic(target, Machines.CHANNEL.CMD), JSON.stringify(Machines.buildEnvelope(target.ident, { cmdId, op, args })));
      return cmdId;
    },
    jobEvents: (machineId: string) => heard.filter((msg) => msg.machineId === machineId && msg.channel === Machines.CHANNEL.JOB).map((msg) => msg.body),
    replies: (machineId: string) => heard.filter((msg) => msg.machineId === machineId && msg.channel === Machines.CHANNEL.REPLY).map((msg) => msg.body),
    retained(machineId: string, channel: string): Record<string, any> | undefined {
      const [msg] = broker.retained(topic(station(machineId), channel));
      return msg ? JSON.parse(msg.payload).body : undefined;
    },
  };
}

export type StationHarness = ReturnType<typeof makeStationHarness>;
