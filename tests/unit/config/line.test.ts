import { resolve } from 'node:path';

import { Machines, type MachineDef } from '@hotmeshio/long-tail';
import { describe, expect, it } from 'vitest';

import { loadLensLine, loadPrintLine, printerOf, stationRecipe } from '../../../src/config/line';
import { loadConfig } from '../../../src/modules/config';
import { ROLE } from '../../../src/modules/constants';

const LINE_FILE = resolve(__dirname, '../../../lines/print-line.json');
const LENS_LINE_FILE = resolve(__dirname, '../../../lines/lens-line.json');
const configOf = (env: NodeJS.ProcessEnv = {}) => loadConfig({ ...process.env, LINE_FILE, LENS_LINE_FILE, ...env });

describe('loadPrintLine', () => {
  it('loads the print line the config names', () => {
    const line = loadPrintLine(configOf());
    expect([line.siteId, line.lineId]).toEqual(['site-1', 'print-1']);
    expect(line.machines.map((machine) => machine.machineId)).toEqual(['p1s-01']);
    expect(Machines.exitRole(line)).toBe(ROLE.PRINT_UNLOAD);
    expect(Machines.operatorRole(line)).toBe(ROLE.PRINT_SERVICING);
  });

  it('throws for a file that is not there', () => {
    expect(() => loadPrintLine(configOf({ LINE_FILE: resolve(__dirname, 'no-such-line.json') }))).toThrow();
  });
});

describe('loadLensLine', () => {
  it('loads the lens line the config names', () => {
    const line = loadLensLine(configOf());
    expect([line.siteId, line.lineId]).toEqual(['site-1', 'line-1']);
    expect(line.machines.map((machine) => Machines.machineRole(machine))).toEqual([ROLE.EDGE_CELL, ROLE.MOUNT_CELL, ROLE.INSPECT_CELL]);
    expect(Machines.exitRole(line)).toBe(ROLE.FITTER);
    expect(Machines.operatorRole(line)).toBe(ROLE.LINE_OPERATOR);
    expect(Machines.receiverRoles(line)).toContain(ROLE.HAND_MOUNT);
  });

  it('throws for a file that is not there', () => {
    expect(() => loadLensLine(configOf({ LENS_LINE_FILE: resolve(__dirname, 'no-such-line.json') }))).toThrow();
  });
});

describe('printerOf', () => {
  it('returns the machine the config names', () => {
    const config = configOf();
    const printer = printerOf(loadPrintLine(config), config);
    expect(printer.machineId).toBe(config.line.printer);
    expect(Machines.machineRole(printer)).toBe(ROLE.PRINTER_FLEET);
    expect(printer.address).toBe('PRN-001');
  });

  it('throws for a machine the line does not list', () => {
    const config = configOf({ PRINT_MACHINE: 'p1s-99' });
    expect(() => printerOf(loadPrintLine(config), config)).toThrow('p1s-99');
  });
});

describe('stationRecipe', () => {
  const printer = printerOf(loadPrintLine(configOf()), configOf());

  it('returns a recipe each shipped machine declares', () => {
    for (const machine of [printer, ...loadLensLine(configOf()).machines]) {
      const recipe = stationRecipe(machine);
      expect(machine.recipes[recipe.id]).toContain(recipe.version);
    }
  });

  it('takes the first recipe at its newest version', () => {
    const many: MachineDef = { ...printer, recipes: { 'RCP-A': ['1', '2', '3'], 'RCP-B': ['1'] } };
    expect(stationRecipe(many)).toEqual({ id: 'RCP-A', version: '3' });
  });

  it('throws for a machine with no recipe', () => {
    expect(() => stationRecipe({ ...printer, recipes: {} })).toThrow(`machine ${printer.machineId} declares no recipe`);
  });

  it('throws for a recipe with no version', () => {
    expect(() => stationRecipe({ ...printer, recipes: { 'RCP-A': [] } })).toThrow('declares no recipe');
  });
});
