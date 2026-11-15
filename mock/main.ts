import { resolve } from 'node:path';

import { Machines } from '@hotmeshio/long-tail';

import { log } from '../src/lib/logger';
import { LOG_EVENTS } from '../src/modules/constants';
import { MockPrinter } from './printer';

try { require('dotenv/config'); } catch { /* env comes from the platform */ }

const MQTT_VERSION = 5;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main(): Promise<void> {
  const line = Machines.loadLine(resolve(process.env.LINE_FILE || 'lines/site-line.json'));
  const def = Machines.machineById(line, process.env.MACHINE_ID || 'printer-01');
  const printSeconds = Number(process.env.PRINT_SECONDS || def.cycleSec);
  if (!(printSeconds > 0)) throw new Error(`PRINT_SECONDS must be greater than 0, got "${process.env.PRINT_SECONDS}"`);

  const link = new Machines.MqttMachineLink({ url: required('MACHINE_MQTT_URL'), protocolVersion: MQTT_VERSION });
  const printer = new MockPrinter(def, line, link, {
    topicRoot: process.env.MACHINE_TOPIC_ROOT || 'line/v1',
    printMs: printSeconds * 1000,
    heartbeats: true,
  });
  await printer.start();

  const stop = () => void printer.stop().finally(() => process.exit(0));
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}

main().catch((err) => {
  log(LOG_EVENTS.FATAL, { error: err instanceof Error ? err.stack : String(err) });
  process.exit(1);
});
