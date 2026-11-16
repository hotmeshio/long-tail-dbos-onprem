import { DBOS } from '@dbos-inc/dbos-sdk';
import { start } from '@hotmeshio/long-tail';
import { configureLongTail } from '@hotmeshio/long-tail-dbos';
import { dbosProvider } from '@hotmeshio/long-tail-dbos/provider';

import { loadSiteLine } from './config/line';
import { roles } from './config/roles';
import { WORKER_QUEUES, workers } from './config/workers';
import { workflowConnection } from './config/workflow-bot';
import { HttpCloudClient, configureCloud } from './lib/cloud-client';
import { log } from './lib/logger';
import { dbosSystemDatabaseUrl, loadConfig } from './modules/config';
import { LOG_EVENTS } from './modules/constants';
import { startAssetServer } from './services/asset-server';
import { dbosRuns, startIntake } from './services/intake';
import { fabricateWorkflow } from './workflows';

try { require('dotenv/config'); } catch { /* env comes from the platform */ }

const SHUTDOWN_GRACE_MS = 8000;

async function main(): Promise<void> {
  // 1. Settings and the line this site runs
  const config = loadConfig();
  const line = loadSiteLine(config);
  const systemDatabaseUrl = dbosSystemDatabaseUrl(config);
  const { admin, database, jwtSecret, nats } = config;

  // 2. DBOS system tables, then the provider Long Tail resolves waits through
  await DBOS.migrate(systemDatabaseUrl);
  const provider = await dbosProvider({ systemDatabaseUrl });

  // 3. Long Tail: dashboard, queues, and the gateway to the machines on the line
  const lt = await start({
    database,
    server: { port: config.port },
    ...(jwtSecret ? { auth: { secret: jwtSecret } } : {}),
    ...(admin.password ? { seed: { admin: { externalId: admin.user, email: admin.email, password: admin.password } } } : {}),
    ...(nats ? { events: { nats } } : {}),
    durable: { provider },
    roles,
    workers,
    machines: { lines: [line] },
  });
  configureLongTail(await workflowConnection());

  // 4. The cloud this site takes work from
  const cloud = new HttpCloudClient({
    url: config.cloud.url,
    credentials: config.cloud.credentials,
    retry: config.cloud.retry,
    timeoutMs: config.cloud.timeoutMs,
  });
  configureCloud(cloud);

  // 5. DBOS: recover the orders in flight, then run new ones
  DBOS.setConfig({
    name: config.dbos.name,
    systemDatabaseUrl,
    executorID: config.dbos.executorId,
    applicationVersion: config.dbos.appVersion,
    runAdminServer: false,
  });
  await DBOS.launch();
  for (const queue of WORKER_QUEUES) await DBOS.registerQueue(queue);
  log(LOG_EVENTS.DBOS_LAUNCHED, { executorId: config.dbos.executorId, appVersion: config.dbos.appVersion });

  // 6. Staged files, served to the machines on the LAN
  const assets = await startAssetServer(config.assets.workDir, config.assets.port);
  log(LOG_EVENTS.ASSETS_SERVING, { port: assets.port, workDir: config.assets.workDir });

  // 7. Intake: claim cloud orders and start a run for each
  const intake = startIntake({
    cloud,
    runs: dbosRuns(fabricateWorkflow),
    role: config.intake.role,
    batch: config.intake.batch,
    claimMinutes: config.intake.claimMinutes,
    workDir: config.assets.workDir,
    downloadTimeoutMs: config.cloud.downloadTimeoutMs,
    pollMs: config.intake.pollMs,
  });
  log(LOG_EVENTS.SITE_STARTED, { port: config.port, siteId: line.siteId, lineId: line.lineId });

  // 8. Stop taking work, then close in reverse order
  const closers: Array<[string, () => Promise<unknown> | unknown]> = [
    ['intake', () => intake.stop()],
    ['assets', () => assets.close()],
    ['dbos', () => DBOS.shutdown()],
    ['long-tail', () => lt.shutdown()],
    ['provider', () => provider.close()],
  ];
  let stopping = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    setTimeout(() => process.exit(0), SHUTDOWN_GRACE_MS).unref();
    for (const [name, close] of closers) {
      try {
        await close();
      } catch (err) {
        log(LOG_EVENTS.SHUTDOWN_ERROR, { closing: name, error: err instanceof Error ? err.message : String(err) });
      }
    }
    log(LOG_EVENTS.SITE_STOPPED, { signal });
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  log(LOG_EVENTS.FATAL, { error: err instanceof Error ? err.stack : String(err) });
  process.exit(1);
});
