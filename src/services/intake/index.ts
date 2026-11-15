import { ApiRequestError } from '../../lib/api-request';
import type { CloudClient } from '../../lib/cloud-client';
import { log } from '../../lib/logger';
import { LOG_EVENTS } from '../../modules/constants';
import { readOrder } from './order';
import type { FabricationRuns } from './runs';
import { stageAssets } from './stage';

export { readOrder } from './order';
export { dbosRuns, type FabricationRuns } from './runs';
export { stageAssets } from './stage';

export interface IntakeOptions {
  cloud: CloudClient;
  runs: FabricationRuns;
  role: string;
  batch: number;
  claimMinutes: number;
  workDir: string;
  downloadTimeoutMs: number;
}

export interface IntakePass {
  claimed: number;
  started: string[];
  skipped: string[];
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * One pass: claim what the cloud advertises, then start every claimed order
 * that has no local run. The second half reads the site's own claims, so an
 * order claimed just before a crash starts on the next pass.
 */
export async function runIntakeOnce(options: IntakeOptions): Promise<IntakePass> {
  const { cloud, runs } = options;

  // 1. Claim open orders in one atomic call
  const claimed = await cloud.claim({ role: options.role, limit: options.batch, durationMinutes: options.claimMinutes });
  if (claimed.length) log(LOG_EVENTS.INTAKE_CLAIMED, { count: claimed.length, escalationIds: claimed.map((row) => row.id) });

  // 2. Every pending order this site holds
  const held = await cloud.listClaimed();

  // 3. Stage and start the ones with no run yet
  const pass: IntakePass = { claimed: claimed.length, started: [], skipped: [] };
  for (const row of held) {
    if (row.role !== options.role) continue;
    try {
      if (await runs.has(row.id)) continue;
      const order = readOrder(await cloud.read(row.id));
      const assets = await stageAssets(cloud, row.id, order, { workDir: options.workDir, timeoutMs: options.downloadTimeoutMs });
      await runs.start({ ...order, escalationId: row.id, assets });
      pass.started.push(row.id);
      log(LOG_EVENTS.INTAKE_ORDER_STARTED, { escalationId: row.id, orderId: order.orderId });
    } catch (err) {
      pass.skipped.push(row.id);
      log(LOG_EVENTS.INTAKE_ORDER_SKIPPED, { escalationId: row.id, error: message(err) });
    }
  }
  return pass;
}

/** Run a pass every `pollMs`, one at a time. An unreachable cloud is an expected state: the next pass tries again. */
export function startIntake(options: IntakeOptions & { pollMs: number }): { stop(): Promise<void> } {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> = Promise.resolve();

  const pass = async () => {
    try {
      await runIntakeOnce(options);
    } catch (err) {
      const unreachable = err instanceof ApiRequestError && (err.status === undefined || err.status >= 500);
      log(unreachable ? LOG_EVENTS.INTAKE_CLOUD_UNREACHABLE : LOG_EVENTS.INTAKE_FAILED, { error: message(err) });
    }
    if (!stopped) timer = setTimeout(() => { running = pass(); }, options.pollMs);
  };

  log(LOG_EVENTS.INTAKE_STARTED, { role: options.role, pollMs: options.pollMs });
  running = pass();
  return {
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await running;
    },
  };
}
