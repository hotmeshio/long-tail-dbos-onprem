import { resolve } from 'node:path';

import { Machines, type MachineDef } from '@hotmeshio/long-tail';
import { describe, expect, it } from 'vitest';

import { loadSiteLine, printRecipe, printerOf } from '../../../src/config/line';
import { loadConfig } from '../../../src/modules/config';

const LINE_FILE = resolve(__dirname, '../../../lines/site-line.json');
const configOf = (env: NodeJS.ProcessEnv = {}) => loadConfig({ ...process.env, LINE_FILE, ...env });

describe('loadSiteLine', () => {
  it('loads the line the config names', () => {
    const line = loadSiteLine(configOf());
    expect(line.siteId).toBeTruthy();
    expect(line.lineId).toBeTruthy();
    expect(line.machines.length).toBeGreaterThan(0);
  });

  it('throws for a file that is not there', () => {
    expect(() => loadSiteLine(configOf({ LINE_FILE: resolve(__dirname, 'no-such-line.json') }))).toThrow();
  });
});

describe('printerOf', () => {
  it('returns the machine the config names', () => {
    const config = configOf();
    const printer = printerOf(loadSiteLine(config), config);
    expect(printer.machineId).toBe(config.line.printer);
    expect(Machines.machineRole(printer)).toBeTruthy();
  });

  it('throws for a machine the line does not list', () => {
    const config = configOf({ PRINT_MACHINE: 'printer-99' });
    expect(() => printerOf(loadSiteLine(config), config)).toThrow('printer-99');
  });
});

describe('printRecipe', () => {
  const printer = printerOf(loadSiteLine(configOf()), configOf());

  it('returns a recipe the shipped printer declares', () => {
    const recipe = printRecipe(printer);
    expect(printer.recipes[recipe.id]).toContain(recipe.version);
  });

  it('takes the first recipe at its newest version', () => {
    const many: MachineDef = { ...printer, recipes: { 'RCP-A': ['1', '2', '3'], 'RCP-B': ['1'] } };
    expect(printRecipe(many)).toEqual({ id: 'RCP-A', version: '3' });
  });

  it('throws for a machine with no recipe', () => {
    expect(() => printRecipe({ ...printer, recipes: {} })).toThrow(`machine ${printer.machineId} declares no recipe`);
  });

  it('throws for a recipe with no version', () => {
    expect(() => printRecipe({ ...printer, recipes: { 'RCP-A': [] } })).toThrow('declares no recipe');
  });
});
