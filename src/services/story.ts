import { mkdir, writeFile } from 'node:fs/promises';

import type { FloorClient, FloorRow } from '../lib/floor-client';
import { log } from '../lib/logger';
import { assetPath, hashFile, orderDir } from '../lib/work-dir';
import { ASSET, LOG_EVENTS, ROLE, productionKey, storyRunId, type AssetAlias } from '../modules/constants';
import type { Eye, MakeGlassesInput, StagedAsset } from '../types/production';
import type { ProductionRuns } from './intake';

export interface StoryOrder {
  orderId: string;
  /** The queue this order stops in, so its row stays on screen. */
  parkAt: string;
}

/** One order per chapter of the site's story, in the order they take the printer. */
export const storyOrders: StoryOrder[] = [
  { orderId: 'A-1042', parkAt: ROLE.PACKAGE },
  { orderId: 'A-1043', parkAt: ROLE.FITTER },
  { orderId: 'A-1044', parkAt: ROLE.PRINT_UNLOAD },
  { orderId: 'A-1045', parkAt: ROLE.PRINTER_FLEET },
];

/** The queues an order passes through, first to last. */
const ROUTE: string[] = [
  ROLE.PRINTER_FLEET, ROLE.PRINT_UNLOAD, ROLE.EDGE_CELL, ROLE.MOUNT_CELL, ROLE.INSPECT_CELL, ROLE.FITTER, ROLE.PACKAGE,
];

/** What the person at each station submits. Machines answer their own rows. */
const STATION_ANSWER: Record<string, Record<string, unknown>> = {
  [ROLE.PRINT_UNLOAD]: { unitsGood: 1, unitsScrap: 0 },
  [ROLE.FITTER]: { received: true },
};

const ORDER = { FRAME_STYLE: 'round-48', LENS_MATERIAL: 'polycarbonate', COATING: 'anti-glare', LOT_NUMBER: 'LOT-4417', PD: 63 } as const;
const RIGHT: Eye = { sphere: -1.25, cylinder: -0.5, axis: 90, add: 0 };
const LEFT: Eye = { sphere: -1, cylinder: -0.25, axis: 85, add: 0 };
const PRESCRIPTION_FILE = 'prescription.json';
const frameFile = (frameStyle: string) => `${frameStyle}.gcode.3mf`;
const frameBytes = (orderId: string) => `; ${ORDER.FRAME_STYLE} frame for ${orderId}\nG28\nG1 X48 Y20\n`;

async function stageFile(workDir: string, runId: string, as: AssetAlias, name: string, content: string): Promise<StagedAsset> {
  const path = assetPath(workDir, runId, name);
  await writeFile(path, content);
  return { as, name, ...(await hashFile(path)) };
}

/** Write a story order's frame and prescription files where a claimed order keeps them. */
export async function stageStoryOrder(workDir: string, orderId: string): Promise<MakeGlassesInput> {
  const runId = storyRunId(orderId);
  const prescription = { right: RIGHT, left: LEFT, pd: ORDER.PD };
  await mkdir(orderDir(workDir, runId), { recursive: true });
  const assets = [
    await stageFile(workDir, runId, ASSET.FRAME, frameFile(ORDER.FRAME_STYLE), frameBytes(orderId)),
    await stageFile(workDir, runId, ASSET.PRESCRIPTION, PRESCRIPTION_FILE, JSON.stringify(prescription)),
  ];
  return {
    orderId,
    frameStyle: ORDER.FRAME_STYLE,
    lensMaterial: ORDER.LENS_MATERIAL,
    coating: ORDER.COATING,
    lotNumber: ORDER.LOT_NUMBER,
    prescription,
    signalKey: productionKey(orderId),
    escalationId: runId,
    assets,
  };
}

export interface ParkOptions {
  pollMs: number;
  timeoutMs: number;
  sleep?: (ms: number) => Promise<void>;
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Work an order's rows as the people at its stations would until it reaches
 * the queue it parks in. Returns the row it stopped on: the parked row, or a
 * row in a queue where a person decides.
 */
export async function parkOrder(floor: FloorClient, order: StoryOrder, options: ParkOptions): Promise<FloorRow> {
  const sleep = options.sleep ?? pause;
  const parkRank = ROUTE.indexOf(order.parkAt);
  const answered = new Set<string>();
  const deadline = performance.now() + options.timeoutMs;
  for (;;) {
    const rows = (await floor.pendingRows({ orderId: order.orderId })).filter((row) => !answered.has(row.id));
    for (const row of rows) {
      const rank = ROUTE.indexOf(row.role);
      if (rank === -1 || rank >= parkRank) return row;
      const answer = STATION_ANSWER[row.role];
      if (!answer) continue;
      await floor.resolveRow(row.id, answer);
      answered.add(row.id);
    }
    if (performance.now() > deadline) throw new Error(`order ${order.orderId} did not reach ${order.parkAt} within ${options.timeoutMs}ms`);
    await sleep(options.pollMs);
  }
}

export interface StoryDeps {
  floor: FloorClient;
  runs: ProductionRuns;
  /** Whether a started run has ended. */
  finished(runId: string): Promise<boolean>;
  workDir: string;
  park: ParkOptions;
}

export interface StoryResult { orderId: string; role?: string; rowId?: string; finished: boolean }

/**
 * Start each story order once and move it to its chapter's queue. Orders go
 * one at a time, so each takes the printer after the one before it.
 */
export async function seedStory(deps: StoryDeps, orders: StoryOrder[] = storyOrders): Promise<StoryResult[]> {
  const results: StoryResult[] = [];
  for (const order of orders) {
    const { orderId } = order;
    const runId = storyRunId(orderId);

    // 1. Start the run unless it exists
    if (!(await deps.runs.has(runId))) {
      await deps.runs.start(await stageStoryOrder(deps.workDir, orderId));
      log(LOG_EVENTS.STORY_ORDER_STARTED, { orderId, runId });
    } else if (await deps.finished(runId)) {
      log(LOG_EVENTS.STORY_ORDER_FINISHED, { orderId, runId });
      results.push({ orderId, finished: true });
      continue;
    }

    // 2. Work it to the queue it parks in
    const row = await parkOrder(deps.floor, order, deps.park);
    log(LOG_EVENTS.STORY_ORDER_PARKED, { orderId, role: row.role, rowId: row.id });
    results.push({ orderId, role: row.role, rowId: row.id, finished: false });
  }
  return results;
}
