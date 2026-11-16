import { Machines } from '@hotmeshio/long-tail';

import { loadSiteLine, printerOf, printRecipe } from '../config/line';
import { loadConfig } from '../modules/config';
import { ASSET } from '../modules/constants';
import { assetUrl } from '../services/asset-server';
import type { FabricateInput } from '../types/fabrication';

/** Where and how one order prints: the facets of its machine row. */
export interface PrintPlan {
  role: string;
  process: string;
  siteId: string;
  lineId: string;
  toMachine: string;
  recipeId: string;
  recipeVersion: string;
  artifactUrl: string;
  artifactSha256: string;
  timeout: string;
}

export interface OrderPlan {
  site: string;
  print: PrintPlan;
  report: { baseSeconds: number; capSeconds: number };
}

/** Read the site's settings once per order, as a step, so a replay sees the values the order started with. */
export async function planOrder(input: FabricateInput): Promise<OrderPlan> {
  const config = loadConfig();
  const line = loadSiteLine(config);
  const printer = printerOf(line, config);
  const recipe = printRecipe(printer);
  const model = input.assets.find((asset) => asset.as === ASSET.MODEL);
  if (!model) throw new Error(`order ${input.orderId} has no "${ASSET.MODEL}" file to print`);
  return {
    site: line.siteId,
    print: {
      role: Machines.machineRole(printer),
      process: printer.process,
      siteId: line.siteId,
      lineId: line.lineId,
      toMachine: printer.machineId,
      recipeId: recipe.id,
      recipeVersion: recipe.version,
      artifactUrl: assetUrl(config.assets.baseUrl, input.escalationId, model.name),
      artifactSha256: model.sha256,
      timeout: config.line.printTimeout,
    },
    report: config.report,
  };
}
