import { BIN_DEFAULT, CLOUD_ROLE } from './constants';

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

export interface CloudConfig {
  url: string;
  /** The site's bot on the cloud: its key and its id. */
  credentials: { apiKey: string; botId: string };
  timeoutMs: number;
  /** Longest one file may take to arrive. */
  downloadTimeoutMs: number;
  /** Retries inside one call; a longer outage is the caller's next pass. */
  retry: { retries: number; baseDelayMs: number; maxDelayMs: number };
}

export interface AppConfig {
  port: number;
  admin: { user: string; password?: string; email?: string };
  /** The password the demo people sign in with. Unset, they are members who cannot sign in. */
  people: { password?: string };
  jwtSecret?: string;
  database: { connectionString?: string; host: string; port: number; user: string; password: string; database: string };
  nats?: { url: string; wsProxy?: string; token?: string };
  dbos: { name: string; executorId: string; appVersion: string; systemDatabaseUrl?: string };
  cloud: CloudConfig;
  intake: { role: string; pollMs: number; claimMinutes: number; batch: number };
  /** Where claimed orders keep their files, and where machines fetch them. */
  assets: { workDir: string; port: number; baseUrl: string };
  /** The print line: its file, the printer orders print on, and what that printer is. */
  line: { file: string; printer: string; printModel: string; printTimeout: string };
  /** The lens line: its file and how long one handoff may take. */
  lensLine: { file: string; handoffTimeout: string };
  /** The bin boxed orders are placed in. */
  bin: { key: string; destination: string; max: number; timeout: string };
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
    people: { password: env.PEOPLE_PASSWORD || undefined },
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
      credentials: { apiKey: envRequired(env, 'CLOUD_API_KEY'), botId: envRequired(env, 'CLOUD_BOT_ID') },
      timeoutMs: envPositive(env, 'CLOUD_TIMEOUT_MS', 15_000),
      downloadTimeoutMs: envPositive(env, 'CLOUD_DOWNLOAD_TIMEOUT_MS', 600_000),
      retry: {
        retries: envInt(env, 'CLOUD_MAX_RETRIES', 2),
        baseDelayMs: envPositive(env, 'CLOUD_RETRY_BASE_MS', 500),
        maxDelayMs: envPositive(env, 'CLOUD_RETRY_MAX_MS', 5_000),
      },
    },
    intake: {
      role: envStr(env, 'INTAKE_ROLE', CLOUD_ROLE.PRODUCTION),
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
      file: envStr(env, 'LINE_FILE', 'lines/print-line.json'),
      printer: envStr(env, 'PRINT_MACHINE', 'p1s-01'),
      printModel: envStr(env, 'PRINT_MODEL', 'model-b'),
      printTimeout: envStr(env, 'PRINT_TIMEOUT', '4h'),
    },
    lensLine: {
      file: envStr(env, 'LENS_LINE_FILE', 'lines/lens-line.json'),
      handoffTimeout: envStr(env, 'LENS_HANDOFF_TIMEOUT', '30m'),
    },
    bin: {
      key: envStr(env, 'BIN_KEY', BIN_DEFAULT.KEY),
      destination: envStr(env, 'BIN_DESTINATION', BIN_DEFAULT.DESTINATION),
      max: envPositive(env, 'BIN_MAX', BIN_DEFAULT.MAX),
      timeout: envStr(env, 'BIN_TIMEOUT', BIN_DEFAULT.TIMEOUT),
    },
    report,
  };
}

/** DBOS keeps its system tables in the same Postgres database as Long Tail unless DBOS_SYSTEM_DATABASE_URL names another. */
export function dbosSystemDatabaseUrl(config: AppConfig): string {
  if (config.dbos.systemDatabaseUrl) return config.dbos.systemDatabaseUrl;
  if (config.database.connectionString) return config.database.connectionString;
  const { user, password, host, port, database } = config.database;
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
}
