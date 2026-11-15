type Env = NodeJS.ProcessEnv;

export function envStr(env: Env, name: string, fallback: string): string {
  return env[name] || fallback;
}

export function envInt(env: Env, name: string, fallback: number): number {
  const raw = env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value)) throw new Error(`${name} must be an integer, got "${raw}"`);
  return value;
}

export function envRequired(env: Env, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function envPositive(env: Env, name: string, fallback: number): number {
  const value = envInt(env, name, fallback);
  if (value <= 0) throw new Error(`${name} must be greater than 0, got "${value}"`);
  return value;
}

/** How the site signs in to the cloud: a bot key issued ahead of time, or an admin login that issues one. */
export type CloudAccess =
  | { apiKey: string; botId: string }
  | { admin: { username: string; password: string } };

export interface CloudConfig {
  url: string;
  access: CloudAccess;
  timeoutMs: number;
  /** Longest one file may take to arrive. */
  downloadTimeoutMs: number;
  /** Retries inside one call; a longer outage is the caller's next pass. */
  retry: { retries: number; baseDelayMs: number; maxDelayMs: number };
}

export interface AppConfig {
  port: number;
  admin: { user: string; password?: string; email?: string };
  jwtSecret?: string;
  database: { connectionString?: string; host: string; port: number; user: string; password: string; database: string };
  nats?: { url: string; wsProxy?: string; token?: string };
  dbos: { name: string; executorId: string; appVersion: string; systemDatabaseUrl?: string };
  cloud: CloudConfig;
  intake: { role: string; pollMs: number; claimMinutes: number; batch: number };
  /** Where claimed orders keep their files, and where machines fetch them. */
  assets: { workDir: string; port: number; baseUrl: string };
  line: { file: string; printer: string; printTimeout: string };
  /** Wait between attempts to report an outcome while the cloud is unreachable. */
  report: { baseSeconds: number; capSeconds: number };
}

export function loadConfig(env: Env = process.env): AppConfig {
  const assetPort = envPositive(env, 'ASSET_PORT', 3001);
  const report = { baseSeconds: envPositive(env, 'REPORT_RETRY_BASE_SECONDS', 5), capSeconds: envPositive(env, 'REPORT_RETRY_CAP_SECONDS', 300) };
  if (report.capSeconds < report.baseSeconds) {
    throw new Error(`REPORT_RETRY_CAP_SECONDS (${report.capSeconds}) must be at least REPORT_RETRY_BASE_SECONDS (${report.baseSeconds})`);
  }
  return {
    port: envInt(env, 'PORT', 3000),
    admin: {
      user: envStr(env, 'LT_ADMIN_USER', 'superadmin'),
      password: env.LT_ADMIN_PASSWORD || undefined,
      email: env.LT_ADMIN_EMAIL || undefined,
    },
    jwtSecret: env.JWT_SECRET || undefined,
    database: {
      connectionString: env.DATABASE_URL || undefined,
      host: envStr(env, 'POSTGRES_HOST', 'localhost'),
      port: envInt(env, 'POSTGRES_PORT', 5432),
      user: envStr(env, 'POSTGRES_USER', 'postgres'),
      password: envStr(env, 'POSTGRES_PASSWORD', 'password'),
      database: envStr(env, 'POSTGRES_DB', 'longtail'),
    },
    nats: env.NATS_URL
      ? { url: env.NATS_URL, wsProxy: env.NATS_WS_TARGET || undefined, token: env.NATS_TOKEN || undefined }
      : undefined,
    dbos: {
      name: envStr(env, 'DBOS_APP_NAME', 'long-tail-dbos-onprem'),
      executorId: envStr(env, 'DBOS__VMID', 'site-1'),
      appVersion: envStr(env, 'DBOS__APPVERSION', 'onprem-v1'),
      systemDatabaseUrl: env.DBOS_SYSTEM_DATABASE_URL || undefined,
    },
    cloud: {
      url: envRequired(env, 'CLOUD_URL').replace(/\/+$/, ''),
      access: cloudAccess(env),
      timeoutMs: envPositive(env, 'CLOUD_TIMEOUT_MS', 15_000),
      downloadTimeoutMs: envPositive(env, 'CLOUD_DOWNLOAD_TIMEOUT_MS', 600_000),
      retry: {
        retries: envInt(env, 'CLOUD_MAX_RETRIES', 2),
        baseDelayMs: envPositive(env, 'CLOUD_RETRY_BASE_MS', 500),
        maxDelayMs: envPositive(env, 'CLOUD_RETRY_MAX_MS', 5_000),
      },
    },
    intake: {
      role: envStr(env, 'INTAKE_ROLE', 'fabrication'),
      pollMs: envPositive(env, 'INTAKE_POLL_MS', 15_000),
      claimMinutes: envPositive(env, 'INTAKE_CLAIM_MINUTES', 10_080),
      batch: envPositive(env, 'INTAKE_BATCH', 5),
    },
    assets: {
      workDir: envStr(env, 'WORK_DIR', './work'),
      port: assetPort,
      baseUrl: envStr(env, 'ASSET_BASE_URL', `http://localhost:${assetPort}`).replace(/\/+$/, ''),
    },
    line: {
      file: envStr(env, 'LINE_FILE', 'lines/site-line.json'),
      printer: envStr(env, 'PRINT_MACHINE', 'printer-01'),
      printTimeout: envStr(env, 'PRINT_TIMEOUT', '4h'),
    },
    report,
  };
}

function cloudAccess(env: Env): CloudAccess {
  const { CLOUD_API_KEY: apiKey, CLOUD_BOT_ID: botId, CLOUD_ADMIN_USER: username, CLOUD_ADMIN_PASSWORD: password } = env;
  if (apiKey || botId) {
    if (!apiKey || !botId) throw new Error('CLOUD_API_KEY and CLOUD_BOT_ID are set together: the key and the id of the bot it belongs to');
    return { apiKey, botId };
  }
  if (username && password) return { admin: { username, password } };
  throw new Error('Cloud sign-in is not configured: set CLOUD_API_KEY and CLOUD_BOT_ID, or CLOUD_ADMIN_USER and CLOUD_ADMIN_PASSWORD for a local demo');
}

/** DBOS keeps its system tables in the same Postgres database as Long Tail unless DBOS_SYSTEM_DATABASE_URL names another. */
export function dbosSystemDatabaseUrl(config: AppConfig): string {
  if (config.dbos.systemDatabaseUrl) return config.dbos.systemDatabaseUrl;
  if (config.database.connectionString) return config.database.connectionString;
  const { user, password, host, port, database } = config.database;
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
}
