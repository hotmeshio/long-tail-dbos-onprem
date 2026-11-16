import { resolve } from 'node:path';

import { Machines } from '@hotmeshio/long-tail';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { planOrder } from '../../../src/activities/plan';
import { ASSET } from '../../../src/modules/constants';
import { fabricateInput, sha256Of } from '../../helpers/order-fixtures';

const LINE_FILE = resolve(__dirname, '../../../lines/site-line.json');
const line = Machines.loadLine(LINE_FILE);
const printer = line.machines[0];
const SET = ['LINE_FILE', 'PRINT_MACHINE', 'PRINT_TIMEOUT', 'ASSET_BASE_URL', 'ASSET_PORT', 'REPORT_RETRY_BASE_SECONDS', 'REPORT_RETRY_CAP_SECONDS'];
const earlier = Object.fromEntries(SET.map((name) => [name, process.env[name]]));

beforeEach(() => {
  for (const name of SET) delete process.env[name];
  process.env.LINE_FILE = LINE_FILE;
  process.env.PRINT_MACHINE = printer.machineId;
});

afterEach(() => {
  for (const name of SET) {
    if (earlier[name] === undefined) delete process.env[name];
    else process.env[name] = earlier[name];
  }
});

describe('planOrder', () => {
  it('plans the print on the configured printer of the site line', async () => {
    const plan = await planOrder(fabricateInput());
    expect(plan.site).toBe(line.siteId);
    expect(plan.print).toMatchObject({
      role: Machines.machineRole(printer),
      process: printer.process,
      siteId: line.siteId,
      lineId: line.lineId,
      toMachine: printer.machineId,
    });
  });

  it('prints a recipe the printer declares', async () => {
    const { print } = await planOrder(fabricateInput());
    expect(printer.recipes[print.recipeId]).toContain(print.recipeVersion);
  });

  it('points the printer at the staged model on the asset server, with its checksum', async () => {
    process.env.ASSET_BASE_URL = 'http://site.invalid:3001/';
    const input = fabricateInput({ escalationId: 'esc-4' });
    const { print } = await planOrder(input);
    expect(print.artifactUrl).toBe('http://site.invalid:3001/esc-4/model.stl');
    expect(print.artifactSha256).toBe(input.assets[0].sha256);
  });

  it('picks the model among several assets', async () => {
    const model = fabricateInput().assets[0];
    const ticket = { as: ASSET.TICKET, name: 'ticket.pdf', sha256: sha256Of('ticket'), size: 6 };
    const { print } = await planOrder(fabricateInput({ assets: [ticket, model] }));
    expect(print.artifactUrl.endsWith('/model.stl')).toBe(true);
    expect(print.artifactSha256).toBe(model.sha256);
  });

  it('carries the print timeout and the report backoff from the environment', async () => {
    process.env.PRINT_TIMEOUT = '30m';
    process.env.REPORT_RETRY_BASE_SECONDS = '2';
    process.env.REPORT_RETRY_CAP_SECONDS = '16';
    const plan = await planOrder(fabricateInput());
    expect(plan.print.timeout).toBe('30m');
    expect(plan.report).toEqual({ baseSeconds: 2, capSeconds: 16 });
  });

  it('uses the defaults when the environment sets nothing', async () => {
    const plan = await planOrder(fabricateInput());
    expect(plan.print.timeout).toBe('4h');
    expect(plan.print.artifactUrl).toBe('http://localhost:3001/esc-1/model.stl');
    expect(plan.report).toEqual({ baseSeconds: 5, capSeconds: 300 });
  });

  it('throws for an order with no model to print', async () => {
    const ticket = { as: ASSET.TICKET, name: 'ticket.pdf', sha256: sha256Of('ticket'), size: 6 };
    await expect(planOrder(fabricateInput({ assets: [ticket] }))).rejects.toThrow(`order order-1001 has no "${ASSET.MODEL}" file to print`);
  });

  it('throws for a printer the line does not list', async () => {
    process.env.PRINT_MACHINE = 'printer-99';
    await expect(planOrder(fabricateInput())).rejects.toThrow('printer-99');
  });

  it('throws when the line file is missing', async () => {
    process.env.LINE_FILE = resolve(__dirname, 'no-such-line.json');
    await expect(planOrder(fabricateInput())).rejects.toThrow();
  });
});
