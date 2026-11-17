import { Machines, type LineDef, type MachineDef } from '@hotmeshio/long-tail';

import { loadLensLine, loadPrintLine, printerOf, stationRecipe } from '../config/line';
import { loadConfig } from '../modules/config';
import { ASSET, ROLE, WAIT_TIMEOUT } from '../modules/constants';
import { assetUrl } from '../services/asset-server';
import type { MakeGlassesInput } from '../types/production';

/** One machine on a line as an order's route sees it. */
export interface StationPlan {
  machineId: string;
  role: string;
  process: string;
  recipeId: string;
  recipeVersion: string;
}

export interface LinePlan {
  siteId: string;
  lineId: string;
  /** People who decide a unit that stopped. */
  operatorRole: string;
  /** People who take a unit off the line. */
  exitRole: string;
  /** How long one handoff waits for its receipt. */
  timeout: string;
}

export interface PrintPlan extends LinePlan {
  station: StationPlan;
  serialNumber: string;
  model: string;
  artifactUrl: string;
  artifactSha256: string;
}

export interface LensPlan extends LinePlan {
  stations: StationPlan[];
  /** Per machine id, the people who do that station's work by hand. */
  handRoles: Record<string, string>;
}

export interface PackPlan {
  binKey: string;
  destination: string;
  max: number;
  timeout: string;
  packageTimeout: string;
}

export interface OrderPlan {
  site: string;
  print: PrintPlan;
  lens: LensPlan;
  pack: PackPlan;
  report: { baseSeconds: number; capSeconds: number };
}

const HAND_PROCESS = 'mount';

function stationPlan(station: MachineDef): StationPlan {
  const recipe = stationRecipe(station);
  return {
    machineId: station.machineId,
    role: Machines.machineRole(station),
    process: station.process,
    recipeId: recipe.id,
    recipeVersion: recipe.version,
  };
}

function linePlan(line: LineDef, timeout: string): LinePlan {
  return {
    siteId: line.siteId,
    lineId: line.lineId,
    operatorRole: Machines.operatorRole(line),
    exitRole: Machines.exitRole(line),
    timeout,
  };
}

/** The stations whose work a person can do by hand, when the line names those people as receivers. */
function handRoles(line: LineDef): Record<string, string> {
  if (!Machines.receiverRoles(line).includes(ROLE.HAND_MOUNT)) return {};
  const roles: Record<string, string> = {};
  for (const station of line.machines) {
    if (station.process === HAND_PROCESS) roles[station.machineId] = ROLE.HAND_MOUNT;
  }
  return roles;
}

/** Read the site's settings once per order, as a step, so a replay sees the values the order started with. */
export async function planOrder(input: MakeGlassesInput): Promise<OrderPlan> {
  const config = loadConfig();
  const printLine = loadPrintLine(config);
  const lensLine = loadLensLine(config);
  const printer = printerOf(printLine, config);
  const frame = input.assets.find((asset) => asset.as === ASSET.FRAME);
  if (!frame) throw new Error(`order ${input.orderId} has no "${ASSET.FRAME}" file to print`);
  return {
    site: printLine.siteId,
    print: {
      ...linePlan(printLine, config.line.printTimeout),
      station: stationPlan(printer),
      serialNumber: printer.address ?? printer.machineId,
      model: config.line.printModel,
      artifactUrl: assetUrl(config.assets.baseUrl, input.escalationId, frame.name),
      artifactSha256: frame.sha256,
    },
    lens: {
      ...linePlan(lensLine, config.lensLine.handoffTimeout),
      stations: lensLine.machines.map(stationPlan),
      handRoles: handRoles(lensLine),
    },
    pack: {
      binKey: config.bin.key,
      destination: config.bin.destination,
      max: config.bin.max,
      timeout: config.bin.timeout,
      packageTimeout: WAIT_TIMEOUT.PACKAGE,
    },
    report: config.report,
  };
}
