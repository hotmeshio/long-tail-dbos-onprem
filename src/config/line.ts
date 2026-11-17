import { resolve } from 'node:path';

import { Machines, type LineDef, type MachineDef } from '@hotmeshio/long-tail';

import type { AppConfig } from '../modules/config';

/** The print line: the printers frames are printed on. */
export function loadPrintLine(config: AppConfig): LineDef {
  return Machines.loadLine(resolve(config.line.file));
}

/** The lens line: the stations a printed frame passes on its way to final fit. */
export function loadLensLine(config: AppConfig): LineDef {
  return Machines.loadLine(resolve(config.lensLine.file));
}

/** The machine print jobs go to. A machine id the line does not list throws. */
export function printerOf(line: LineDef, config: AppConfig): MachineDef {
  return Machines.machineById(line, config.line.printer);
}

/** A station's first recipe at its newest version. */
export function stationRecipe(station: MachineDef): { id: string; version: string } {
  const [id, versions] = Object.entries(station.recipes)[0] ?? [];
  const version = versions?.[versions.length - 1];
  if (!id || !version) throw new Error(`machine ${station.machineId} declares no recipe`);
  return { id, version };
}
