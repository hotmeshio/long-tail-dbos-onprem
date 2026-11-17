import { resolve } from 'node:path';

import { Machines } from '@hotmeshio/long-tail';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { planOrder } from '../../../src/activities/plan';
import { ASSET, BIN_DEFAULT, ROLE, WAIT_TIMEOUT } from '../../../src/modules/constants';
import { FRAME_NAME, makeGlassesInput, sha256Of } from '../../helpers/order-fixtures';

const PRINT_LINE = resolve(__dirname, '../../../lines/print-line.json');
const LENS_LINE = resolve(__dirname, '../../../lines/lens-line.json');
const printLine = Machines.loadLine(PRINT_LINE);
const lensLine = Machines.loadLine(LENS_LINE);
const printer = printLine.machines[0];
const SET = [
  'LINE_FILE', 'LENS_LINE_FILE', 'PRINT_MACHINE', 'PRINT_MODEL', 'PRINT_TIMEOUT', 'LENS_HANDOFF_TIMEOUT', 'ASSET_BASE_URL', 'ASSET_PORT',
  'BIN_KEY', 'BIN_DESTINATION', 'BIN_MAX', 'BIN_TIMEOUT', 'REPORT_RETRY_BASE_SECONDS', 'REPORT_RETRY_CAP_SECONDS',
];
const earlier = Object.fromEntries(SET.map((name) => [name, process.env[name]]));
const prescription = { as: ASSET.PRESCRIPTION, name: 'prescription.json', sha256: sha256Of('{}'), size: 2 };

beforeEach(() => {
  for (const name of SET) delete process.env[name];
  process.env.LINE_FILE = PRINT_LINE;
  process.env.LENS_LINE_FILE = LENS_LINE;
});

afterEach(() => {
  for (const name of SET) {
    if (earlier[name] === undefined) delete process.env[name];
    else process.env[name] = earlier[name];
  }
});

describe('planOrder print', () => {
  it('plans the print on the configured printer of the print line', async () => {
    const plan = await planOrder(makeGlassesInput());
    expect(plan.site).toBe(printLine.siteId);
    expect(plan.print).toMatchObject({
      siteId: 'site-1',
      lineId: 'print-1',
      operatorRole: ROLE.PRINT_SERVICING,
      exitRole: ROLE.PRINT_UNLOAD,
      serialNumber: 'PRN-001',
      model: 'model-b',
      timeout: '4h',
    });
    expect(plan.print.station).toMatchObject({ machineId: 'p1s-01', role: ROLE.PRINTER_FLEET, process: printer.process });
  });

  it('prints a recipe the printer declares', async () => {
    const { station } = (await planOrder(makeGlassesInput())).print;
    expect(printer.recipes[station.recipeId]).toContain(station.recipeVersion);
  });

  it('points the printer at the staged frame on the asset server, with its checksum', async () => {
    process.env.ASSET_BASE_URL = 'http://site.invalid:3001/';
    const input = makeGlassesInput({ escalationId: 'esc-4' });
    const { print } = await planOrder(input);
    expect(print.artifactUrl).toBe(`http://site.invalid:3001/esc-4/${FRAME_NAME}`);
    expect(print.artifactSha256).toBe(input.assets[0].sha256);
  });

  it('picks the frame among several assets', async () => {
    const frame = makeGlassesInput().assets[0];
    const { print } = await planOrder(makeGlassesInput({ assets: [prescription, frame] }));
    expect(print.artifactUrl).toBe(`http://localhost:3001/esc-1/${FRAME_NAME}`);
    expect(print.artifactSha256).toBe(frame.sha256);
  });

  it('throws for an order with no frame to print', async () => {
    await expect(planOrder(makeGlassesInput({ assets: [prescription] }))).rejects.toThrow(`order A-1042 has no "${ASSET.FRAME}" file to print`);
  });

  it('throws for a printer the line does not list', async () => {
    process.env.PRINT_MACHINE = 'p1s-99';
    await expect(planOrder(makeGlassesInput())).rejects.toThrow('p1s-99');
  });

  it('throws when a line file is missing', async () => {
    process.env.LENS_LINE_FILE = resolve(__dirname, 'no-such-line.json');
    await expect(planOrder(makeGlassesInput())).rejects.toThrow();
  });
});

describe('planOrder lens line, pack and report', () => {
  it('plans every station of the lens line in order, each with a recipe it declares', async () => {
    const { lens } = await planOrder(makeGlassesInput());
    expect(lens).toMatchObject({ siteId: 'site-1', lineId: 'line-1', operatorRole: ROLE.LINE_OPERATOR, exitRole: ROLE.FITTER, timeout: '30m' });
    expect(lens.stations.map((station) => [station.machineId, station.role, station.recipeId])).toEqual([
      ['edge-01', ROLE.EDGE_CELL, 'RCP-EDGE-A'],
      ['mount-01', ROLE.MOUNT_CELL, 'RCP-MOUNT-A'],
      ['inspect-01', ROLE.INSPECT_CELL, 'RCP-INSPECT-A'],
    ]);
    lens.stations.forEach((station, index) => {
      expect(lensLine.machines[index].recipes[station.recipeId]).toContain(station.recipeVersion);
    });
  });

  it('names the people who mount by hand for the press', async () => {
    expect((await planOrder(makeGlassesInput())).lens.handRoles).toEqual({ 'mount-01': ROLE.HAND_MOUNT });
  });

  it('packs into the default bin', async () => {
    expect((await planOrder(makeGlassesInput())).pack).toEqual({
      binKey: BIN_DEFAULT.KEY,
      destination: BIN_DEFAULT.DESTINATION,
      max: BIN_DEFAULT.MAX,
      timeout: BIN_DEFAULT.TIMEOUT,
      packageTimeout: WAIT_TIMEOUT.PACKAGE,
    });
  });

  it('carries the timeouts, the bin and the report backoff from the environment', async () => {
    Object.assign(process.env, {
      PRINT_TIMEOUT: '30m', PRINT_MODEL: 'model-c', LENS_HANDOFF_TIMEOUT: '5m', BIN_KEY: 'bin-9', BIN_DESTINATION: 'Austin', BIN_MAX: '4',
      BIN_TIMEOUT: '1h', REPORT_RETRY_BASE_SECONDS: '2', REPORT_RETRY_CAP_SECONDS: '16',
    });
    const plan = await planOrder(makeGlassesInput());
    expect(plan.print).toMatchObject({ timeout: '30m', model: 'model-c' });
    expect(plan.lens.timeout).toBe('5m');
    expect(plan.pack).toMatchObject({ binKey: 'bin-9', destination: 'Austin', max: 4, timeout: '1h' });
    expect(plan.report).toEqual({ baseSeconds: 2, capSeconds: 16 });
  });

  it('defaults the report backoff', async () => {
    expect((await planOrder(makeGlassesInput())).report).toEqual({ baseSeconds: 5, capSeconds: 300 });
  });
});
