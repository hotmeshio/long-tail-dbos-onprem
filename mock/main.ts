import { resolve } from 'node:path';

import { Machines, type LineDef, type MachineDef } from '@hotmeshio/long-tail';

import { log } from '../src/lib/logger';
import { LOG_EVENTS } from '../src/modules/constants';
import { Floor } from './floor';
import type { MachineSettings, MockMachine } from './machine';
import { MockPrinter } from './printer';
import { MockStation } from './station';

try { require('dotenv/config'); } catch { /* env comes from the platform */ }

const MQTT_VERSION = 5;
const PRINT_PROCESS = 'print';
const DEFAULTS = { PRINT_LINE: 'lines/print-line.json', LENS_LINE: 'lines/lens-line.json', TOPIC_ROOT: 'line/v1' } as const;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

/** Seconds from the environment, or the machine's own cycle time. */
function seconds(name: string, def: MachineDef): number {
  const value = Number(process.env[name] || def.cycleSec);
  if (!(value > 0)) throw new Error(`${name} must be greater than 0, got "${process.env[name]}"`);
  return value;
}

/** `STATION_REJECTS=inspect-01:A-1044,p1s-01:A-1045` lists, per machine, the orders its first job fails on. */
export function parseRejects(raw: string | undefined): Record<string, string[]> {
  const rejects: Record<string, string[]> = {};
  for (const pair of (raw ?? '').split(',').map((entry) => entry.trim()).filter(Boolean)) {
    const [machineId, orderId] = pair.split(':');
    if (!machineId || !orderId) throw new Error(`STATION_REJECTS entries read machine:order, got "${pair}"`);
    (rejects[machineId] ??= []).push(orderId);
  }
  return rejects;
}

function machinesOf(line: LineDef, url: string, rejects: Record<string, string[]>): MockMachine[] {
  const floor = new Floor();
  return line.machines.map((def) => {
    const printer = def.process === PRINT_PROCESS;
    const settings: MachineSettings = {
      topicRoot: process.env.MACHINE_TOPIC_ROOT || DEFAULTS.TOPIC_ROOT,
      cycleMs: seconds(printer ? 'PRINT_SECONDS' : 'STATION_SECONDS', def) * 1000,
      heartbeats: true,
      failOrders: rejects[def.machineId],
    };
    const link = new Machines.MqttMachineLink({ url, protocolVersion: MQTT_VERSION });
    return printer ? new MockPrinter(def, line, link, settings) : new MockStation(def, line, link, settings, floor);
  });
}

async function main(): Promise<void> {
  const url = required('MACHINE_MQTT_URL');
  const rejects = parseRejects(process.env.STATION_REJECTS);
  const lines = [process.env.LINE_FILE || DEFAULTS.PRINT_LINE, process.env.LENS_LINE_FILE || DEFAULTS.LENS_LINE]
    .map((file) => Machines.loadLine(resolve(file)));
  const machines = lines.flatMap((line) => machinesOf(line, url, rejects));
  for (const machine of machines) await machine.start();

  const stop = () => void Promise.all(machines.map((machine) => machine.stop())).finally(() => process.exit(0));
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}

if (require.main === module) {
  main().catch((err) => {
    log(LOG_EVENTS.FATAL, { error: err instanceof Error ? err.stack : String(err) });
    process.exit(1);
  });
}
