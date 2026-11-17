import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { Machines } from '@hotmeshio/long-tail';

import { MockPrinter, type PrinterSettings } from '../../mock/printer';
import { FRAME_BYTES, sha256Of } from './order-fixtures';
import { stubFetch } from './fetch-stub';

export const TOPIC_ROOT = 'line/v1';
export const ARTIFACT_URL = 'http://assets.invalid/esc-1/round-48.gcode.3mf';
const LINE_FILE = resolve(__dirname, '../../lines/print-line.json');
const OBSERVER = 'test-observer';

export interface Heard { channel: string; body: Record<string, any>; source: Record<string, any> }

/** Serve the frame file at ARTIFACT_URL. */
export const stubArtifact = (content: string = FRAME_BYTES) =>
  stubFetch({ 'GET /esc-1/round-48.gcode.3mf': { text: content, contentType: 'application/octet-stream' } });

/** The args of a dispatch for one order of two units. */
export function dispatchArgs(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    jobId: 'A-1042-print',
    orderRef: 'A-1042',
    recipe: { id: 'print-file', version: '1' },
    units: [{ unitId: 'A-1042-1', carrierId: null }, { unitId: 'A-1042-2', carrierId: null }],
    artifact: { url: ARTIFACT_URL, sha256: sha256Of(FRAME_BYTES) },
    ...overrides,
  };
}

/** A mock printer on an in-memory broker, with an observer that hears the whole line. */
export function makePrinterHarness(settings: Partial<PrinterSettings> = {}) {
  const broker = new Machines.MemoryBroker();
  const line = Machines.loadLine(LINE_FILE);
  const link = new Machines.MemoryMachineLink(broker);
  const printer = new MockPrinter(line.machines[0], line, link, { topicRoot: TOPIC_ROOT, cycleMs: 4, heartbeats: false, ...settings });
  const topic = (channel: string) => Machines.machineTopic(TOPIC_ROOT, printer.ident, channel);
  const channels = new Map(Object.values(Machines.CHANNEL).map((channel) => [topic(channel), channel]));
  const read = (msg: { topic: string; payload: string }): Heard => {
    const envelope = JSON.parse(msg.payload);
    return { channel: channels.get(msg.topic) ?? msg.topic, body: envelope.body, source: envelope.source };
  };
  const heard: Heard[] = [];
  broker.connect(OBSERVER);
  broker.subscribe(OBSERVER, Machines.lineFilter(TOPIC_ROOT, line.siteId, line.lineId), (msg) => {
    if (msg.topic !== topic(Machines.CHANNEL.CMD)) heard.push(read(msg));
  });

  /** Let the broker deliver, then wait for the printer to answer and print. */
  const settle = async () => {
    await new Promise<void>((done) => setImmediate(done));
    await printer.idle();
    await new Promise<void>((done) => setImmediate(done));
  };
  const publishCommand = (body: Record<string, unknown>) =>
    broker.publish(topic(Machines.CHANNEL.CMD), JSON.stringify(Machines.buildEnvelope(printer.ident, body)));

  return {
    broker, line, link, printer, heard, settle, publishCommand, topic,
    /** Publish one command; returns its cmdId. */
    send(op: string, args: Record<string, unknown> = {}, cmdId: string = randomUUID()): string {
      publishCommand({ cmdId, op, args });
      return cmdId;
    },
    bodies: (channel: string) => heard.filter((msg) => msg.channel === channel).map((msg) => msg.body),
    replies: () => heard.filter((msg) => msg.channel === Machines.CHANNEL.REPLY).map((msg) => msg.body),
    jobEvents: () => heard.filter((msg) => msg.channel === Machines.CHANNEL.JOB).map((msg) => msg.body),
    /** The retained message of one channel, or undefined. */
    retained(channel: string): Record<string, any> | undefined {
      const [msg] = broker.retained(topic(channel));
      return msg ? read(msg).body : undefined;
    },
  };
}

export type PrinterHarness = ReturnType<typeof makePrinterHarness>;
