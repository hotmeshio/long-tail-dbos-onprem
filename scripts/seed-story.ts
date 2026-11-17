import { DBOSClient } from '@dbos-inc/dbos-sdk';

import { createFloorClient, signIn } from '../src/lib/floor-client';
import { log } from '../src/lib/logger';
import { dbosSystemDatabaseUrl, envInt, envStr, loadConfig } from '../src/modules/config';
import { LOG_EVENTS, TASK_QUEUE, WORKFLOW } from '../src/modules/constants';
import type { ProductionRuns } from '../src/services/intake';
import { seedStory } from '../src/services/story';

try { require('dotenv/config'); } catch { /* env comes from the platform */ }

const ENDED = new Set(['SUCCESS', 'ERROR', 'CANCELLED', 'MAX_RECOVERY_ATTEMPTS_EXCEEDED']);

/** Runs started through the DBOS client: the running site picks them up from its queue. */
function clientRuns(client: DBOSClient, appVersion: string): ProductionRuns {
  return {
    async has(runId) {
      return (await client.getWorkflow(runId)) !== undefined;
    },
    async start(input) {
      await client.enqueue({ queueName: TASK_QUEUE, workflowName: WORKFLOW.MAKE_GLASSES, workflowID: input.escalationId, appVersion }, input);
    },
  };
}

async function main(): Promise<void> {
  // 1. The running site this story is told on
  const config = loadConfig();
  const { admin } = config;
  if (!admin.password) throw new Error('LT_ADMIN_PASSWORD is required to work the story rows');
  const siteUrl = envStr(process.env, 'STORY_SITE_URL', `http://localhost:${config.port}`);
  const floor = createFloorClient(siteUrl, await signIn(siteUrl, { username: admin.user, password: admin.password }));

  // 2. Start each order and work it to its chapter's queue
  const client = await DBOSClient.create({ systemDatabaseUrl: dbosSystemDatabaseUrl(config) });
  try {
    const parked = await seedStory({
      floor,
      runs: clientRuns(client, config.dbos.appVersion),
      finished: async (runId) => ENDED.has((await client.getWorkflow(runId))?.status ?? ''),
      workDir: config.assets.workDir,
      park: { pollMs: envInt(process.env, 'STORY_POLL_MS', 1_000), timeoutMs: envInt(process.env, 'STORY_TIMEOUT_MS', 180_000) },
    });
    log(LOG_EVENTS.STORY_DONE, { orders: parked });
  } finally {
    await client.destroy();
  }
}

main().catch((err) => {
  log(LOG_EVENTS.STORY_FAILED, { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
