import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FloorClient, FloorRow } from '../../../src/lib/floor-client';
import { ASSET, LOG_EVENTS, ROLE, productionKey, storyRunId } from '../../../src/modules/constants';
import { parkOrder, seedStory, stageStoryOrder, storyOrders, type StoryDeps } from '../../../src/services/story';
import { spyOnLog } from '../../helpers/log-spy';
import { sha256Of } from '../../helpers/order-fixtures';
import { makeWorkDir, type TempWorkDir } from '../../helpers/temp-work-dir';

const ORDER_ID = 'A-1042';
const PARK = { pollMs: 1, timeoutMs: 1_000, sleep: async () => undefined };
const row = (id: string, role: string): FloorRow => ({ id, role, metadata: { orderId: ORDER_ID } });

/** A floor that shows one list of rows per poll and holds on the last. */
function scriptFloor(polls: FloorRow[][]) {
  let poll = 0;
  const floor = {
    pendingRows: vi.fn(async () => polls[Math.min(poll++, polls.length - 1)]),
    resolveRow: vi.fn(async () => undefined),
    placeInBin: vi.fn(async () => undefined),
  };
  return floor satisfies FloorClient;
}

let work: TempWorkDir;
beforeEach(async () => {
  work = await makeWorkDir();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await work.remove();
});

describe('storyOrders', () => {
  it('parks one order in the queue of each site chapter', () => {
    expect(storyOrders.map((order) => order.orderId)).toEqual(['A-1042', 'A-1043', 'A-1044', 'A-1045']);
    expect(storyOrders.map((order) => order.parkAt)).toEqual([ROLE.PACKAGE, ROLE.FITTER, ROLE.PRINT_UNLOAD, ROLE.PRINTER_FLEET]);
  });
});

describe('stageStoryOrder', () => {
  it('writes the frame and prescription files and describes them', async () => {
    const input = await stageStoryOrder(work.path, ORDER_ID);
    expect(input.assets.map((asset) => asset.as)).toEqual([ASSET.FRAME, ASSET.PRESCRIPTION]);
    for (const asset of input.assets) {
      const content = await readFile(join(work.path, storyRunId(ORDER_ID), asset.name), 'utf8');
      expect(asset.sha256).toBe(sha256Of(content));
      expect(asset.size).toBe(Buffer.byteLength(content));
    }
  });

  it('runs under the story id and carries the cloud signal key', async () => {
    const input = await stageStoryOrder(work.path, ORDER_ID);
    expect(input.escalationId).toBe(storyRunId(ORDER_ID));
    expect(input.signalKey).toBe(productionKey(ORDER_ID));
    expect(input.orderId).toBe(ORDER_ID);
  });

  it('stages the same files for the same order every time', async () => {
    const first = await stageStoryOrder(work.path, ORDER_ID);
    expect(await stageStoryOrder(work.path, ORDER_ID)).toEqual(first);
  });
});

describe('parkOrder', () => {
  it('answers the stations before the parking queue and returns the parked row', async () => {
    const floor = scriptFloor([
      [row('print', ROLE.PRINTER_FLEET)],
      [row('unload', ROLE.PRINT_UNLOAD)],
      [row('edge', ROLE.EDGE_CELL)],
      [row('fit', ROLE.FITTER)],
      [row('box', ROLE.PACKAGE)],
    ]);
    const parked = await parkOrder(floor, { orderId: ORDER_ID, parkAt: ROLE.PACKAGE }, PARK);
    expect(parked.id).toBe('box');
    expect(floor.resolveRow.mock.calls).toEqual([
      ['unload', { unitsGood: 1, unitsScrap: 0 }],
      ['fit', { received: true }],
    ]);
    expect(floor.pendingRows).toHaveBeenCalledWith({ orderId: ORDER_ID });
  });

  it('answers a row once while it is still listed', async () => {
    const unload = row('unload', ROLE.PRINT_UNLOAD);
    const floor = scriptFloor([[unload], [unload], [row('fit', ROLE.FITTER)]]);
    await parkOrder(floor, { orderId: ORDER_ID, parkAt: ROLE.FITTER }, PARK);
    expect(floor.resolveRow).toHaveBeenCalledTimes(1);
  });

  it('leaves the parked row unanswered', async () => {
    const floor = scriptFloor([[row('unload', ROLE.PRINT_UNLOAD)]]);
    const parked = await parkOrder(floor, { orderId: ORDER_ID, parkAt: ROLE.PRINT_UNLOAD }, PARK);
    expect(parked.role).toBe(ROLE.PRINT_UNLOAD);
    expect(floor.resolveRow).not.toHaveBeenCalled();
  });

  it('stops on a row in a queue where a person decides', async () => {
    const floor = scriptFloor([[row('stopped', ROLE.PRINT_SERVICING)]]);
    const parked = await parkOrder(floor, { orderId: ORDER_ID, parkAt: ROLE.PACKAGE }, PARK);
    expect(parked.role).toBe(ROLE.PRINT_SERVICING);
  });

  it('throws when the order never reaches its queue', async () => {
    const floor = scriptFloor([[row('edge', ROLE.EDGE_CELL)]]);
    const park = { ...PARK, timeoutMs: 0, sleep: async () => new Promise<void>((resolve) => setTimeout(resolve, 2)) };
    await expect(parkOrder(floor, { orderId: ORDER_ID, parkAt: ROLE.PACKAGE }, park)).rejects.toThrow(`order ${ORDER_ID} did not reach ${ROLE.PACKAGE}`);
  });
});

describe('seedStory', () => {
  const ORDERS = [{ orderId: ORDER_ID, parkAt: ROLE.PRINT_UNLOAD }];

  function deps(existing: boolean, finished = false) {
    const floor = scriptFloor([[row('unload', ROLE.PRINT_UNLOAD)]]);
    const runs = { has: vi.fn(async () => existing), start: vi.fn(async () => undefined) };
    const made: StoryDeps = { floor, runs, finished: vi.fn(async () => finished), workDir: work.path, park: PARK };
    return { made, floor, runs };
  }

  it('starts a missing run and reports where the order parked', async () => {
    const logged = spyOnLog();
    const { made, runs } = deps(false);
    expect(await seedStory(made, ORDERS)).toEqual([{ orderId: ORDER_ID, role: ROLE.PRINT_UNLOAD, rowId: 'unload', finished: false }]);
    expect(runs.has).toHaveBeenCalledWith(storyRunId(ORDER_ID));
    expect(runs.start).toHaveBeenCalledWith(expect.objectContaining({ orderId: ORDER_ID, escalationId: storyRunId(ORDER_ID) }));
    expect(logged.events()).toEqual([LOG_EVENTS.STORY_ORDER_STARTED, LOG_EVENTS.STORY_ORDER_PARKED]);
    expect(logged.contexts(LOG_EVENTS.STORY_ORDER_PARKED)).toEqual([{ orderId: ORDER_ID, role: ROLE.PRINT_UNLOAD, rowId: 'unload' }]);
  });

  it('parks a run that already exists and starts nothing', async () => {
    spyOnLog();
    const { made, runs } = deps(true);
    const [result] = await seedStory(made, ORDERS);
    expect(runs.start).not.toHaveBeenCalled();
    expect(result.rowId).toBe('unload');
  });

  it('reports a run that has ended and leaves the floor alone', async () => {
    const logged = spyOnLog();
    const { made, floor, runs } = deps(true, true);
    expect(await seedStory(made, ORDERS)).toEqual([{ orderId: ORDER_ID, finished: true }]);
    expect(runs.start).not.toHaveBeenCalled();
    expect(floor.pendingRows).not.toHaveBeenCalled();
    expect(logged.events()).toEqual([LOG_EVENTS.STORY_ORDER_FINISHED]);
  });

  it('works the orders in turn', async () => {
    spyOnLog();
    const { made, runs } = deps(false);
    const results = await seedStory(made, [...ORDERS, { orderId: 'A-1043', parkAt: ROLE.PRINT_UNLOAD }]);
    expect(results.map((result) => result.orderId)).toEqual([ORDER_ID, 'A-1043']);
    expect(runs.start).toHaveBeenCalledTimes(2);
  });

  it('seeds the four story orders by default', async () => {
    spyOnLog();
    const { made, runs } = deps(false);
    made.floor = scriptFloor([[row('lead', ROLE.SHIFT_LEAD)]]);
    await seedStory(made);
    expect(runs.start).toHaveBeenCalledTimes(storyOrders.length);
  });
});
