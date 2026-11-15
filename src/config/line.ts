import { resolve } from 'node:path';

import { Machines, type LineDef, type MachineDef } from '@hotmeshio/long-tail';

import type { AppConfig } from '../modules/config';

/** The site's line: its site and line ids and the machines on it. */
export function loadSiteLine(config: AppConfig): LineDef {
  return Machines.loadLine(resolve(config.line.file));
}

/** The machine print jobs go to. A machine id the line does not list throws. */
export function printerOf(line: LineDef, config: AppConfig): MachineDef {
  return Machines.machineById(line, config.line.printer);
}

/** The printer's first recipe at its newest version. */
export function printRecipe(printer: MachineDef): { id: string; version: string } {
  const [id, versions] = Object.entries(printer.recipes)[0] ?? [];
  const version = versions?.[versions.length - 1];
  if (!id || !version) throw new Error(`machine ${printer.machineId} declares no recipe`);
  return { id, version };
}
