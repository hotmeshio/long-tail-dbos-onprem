import { describe, expect, it } from 'vitest';

import { dbosSystemDatabaseUrl, envInt, envRequired, envStr, loadConfig } from '../../../src/modules/config';

const KEYED = { CLOUD_URL: 'http://cloud.invalid', CLOUD_API_KEY: 'lt_bot_test', CLOUD_BOT_ID: 'bot-test' };
const load = (env: NodeJS.ProcessEnv = {}) => loadConfig({ ...KEYED, ...env });

describe('env readers', () => {
  it('envStr falls back for a missing or empty value', () => {
    expect(envStr({ NAME: 'set' }, 'NAME', 'fallback')).toBe('set');
    expect(envStr({}, 'NAME', 'fallback')).toBe('fallback');
    expect(envStr({ NAME: '' }, 'NAME', 'fallback')).toBe('fallback');
  });

  it('envInt reads an integer and falls back when unset', () => {
    expect(envInt({ PORT: '8080' }, 'PORT', 3000)).toBe(8080);
    expect(envInt({}, 'PORT', 3000)).toBe(3000);
  });

  it.each(['abc', '1.5', '10s'])('envInt throws for "%s", naming the variable', (raw) => {
    expect(() => envInt({ PORT: raw }, 'PORT', 3000)).toThrow(`PORT must be an integer, got "${raw}"`);
  });

  it('envRequired returns the value or throws naming the variable', () => {
    expect(envRequired({ CLOUD_URL: 'http://cloud.invalid' }, 'CLOUD_URL')).toBe('http://cloud.invalid');
    expect(() => envRequired({}, 'CLOUD_URL')).toThrow('CLOUD_URL is required');
    expect(() => envRequired({ CLOUD_URL: '' }, 'CLOUD_URL')).toThrow('CLOUD_URL is required');
  });
});

describe('loadConfig defaults', () => {
  const config = load();

  it('defaults the server, the database and DBOS', () => {
    expect(config.port).toBe(3000);
    expect(config.admin).toEqual({ user: 'superadmin', password: undefined, email: undefined });
    expect(config.jwtSecret).toBeUndefined();
    expect(config.database).toEqual({ connectionString: undefined, host: 'localhost', port: 5432, user: 'postgres', password: 'password', database: 'longtail' });
    expect(config.nats).toBeUndefined();
    expect(config.dbos).toEqual({ name: 'long-tail-dbos-onprem', executorId: 'site-1', appVersion: 'onprem-v1', systemDatabaseUrl: undefined });
  });

  it('defaults the cloud timeouts and retry policy', () => {
    expect(config.cloud).toEqual({
      url: 'http://cloud.invalid',
      credentials: { apiKey: 'lt_bot_test', botId: 'bot-test' },
      timeoutMs: 15_000,
      downloadTimeoutMs: 600_000,
      retry: { retries: 2, baseDelayMs: 500, maxDelayMs: 5_000 },
    });
  });

  it('defaults intake, assets, the line and the report backoff', () => {
    expect(config.intake).toEqual({ role: 'fabrication', pollMs: 15_000, claimMinutes: 10_080, batch: 5 });
    expect(config.assets).toEqual({ workDir: './work', port: 3001, baseUrl: 'http://localhost:3001' });
    expect(config.line).toEqual({ file: 'lines/site-line.json', printer: 'printer-01', printTimeout: '4h' });
    expect(config.report).toEqual({ baseSeconds: 5, capSeconds: 300 });
  });

  it('reads process.env when no env is given', () => {
    expect(loadConfig().cloud.url).toBe(process.env.CLOUD_URL);
  });
});

describe('loadConfig overrides', () => {
  it('reads every tunable from the environment', () => {
    const config = load({
      PORT: '8080', POSTGRES_HOST: 'db', POSTGRES_PORT: '5433', DBOS__VMID: 'site-2', CLOUD_TIMEOUT_MS: '2000', CLOUD_MAX_RETRIES: '0',
      INTAKE_ROLE: 'assembly', INTAKE_POLL_MS: '1000', INTAKE_BATCH: '1', WORK_DIR: '/data/work', LINE_FILE: 'lines/other.json',
      PRINT_MACHINE: 'printer-02', PRINT_TIMEOUT: '30m', REPORT_RETRY_BASE_SECONDS: '1', REPORT_RETRY_CAP_SECONDS: '8',
    });
    expect(config.port).toBe(8080);
    expect(config.database).toMatchObject({ host: 'db', port: 5433 });
    expect(config.dbos.executorId).toBe('site-2');
    expect(config.cloud).toMatchObject({ timeoutMs: 2000, retry: { retries: 0 } });
    expect(config.intake).toMatchObject({ role: 'assembly', pollMs: 1000, batch: 1 });
    expect(config.assets.workDir).toBe('/data/work');
    expect(config.line).toEqual({ file: 'lines/other.json', printer: 'printer-02', printTimeout: '30m' });
    expect(config.report).toEqual({ baseSeconds: 1, capSeconds: 8 });
  });

  it('strips trailing slashes from the cloud url and the asset base url', () => {
    const config = load({ CLOUD_URL: 'http://cloud.invalid//', ASSET_BASE_URL: 'http://site.invalid:9000/' });
    expect(config.cloud.url).toBe('http://cloud.invalid');
    expect(config.assets.baseUrl).toBe('http://site.invalid:9000');
  });

  it('derives the asset base url from the asset port', () => {
    expect(load({ ASSET_PORT: '4100' }).assets).toMatchObject({ port: 4100, baseUrl: 'http://localhost:4100' });
  });

  it('configures NATS only when a url is given', () => {
    expect(load({ NATS_URL: 'nats://nats:4222', NATS_TOKEN: 'secret' }).nats).toEqual({ url: 'nats://nats:4222', wsProxy: undefined, token: 'secret' });
    expect(load({ NATS_TOKEN: 'secret' }).nats).toBeUndefined();
  });
});

describe('loadConfig validation', () => {
  it('throws without CLOUD_URL', () => {
    expect(() => loadConfig({ CLOUD_API_KEY: 'lt_bot_test', CLOUD_BOT_ID: 'bot-test' })).toThrow('CLOUD_URL is required');
  });

  it('throws without the bot key or its bot id', () => {
    expect(() => loadConfig({ CLOUD_URL: 'http://cloud.invalid', CLOUD_BOT_ID: 'bot-test' })).toThrow('CLOUD_API_KEY is required');
    expect(() => loadConfig({ CLOUD_URL: 'http://cloud.invalid', CLOUD_API_KEY: 'lt_bot_test' })).toThrow('CLOUD_BOT_ID is required');
  });

  it.each([
    'ASSET_PORT', 'CLOUD_TIMEOUT_MS', 'CLOUD_DOWNLOAD_TIMEOUT_MS', 'CLOUD_RETRY_BASE_MS', 'CLOUD_RETRY_MAX_MS',
    'INTAKE_POLL_MS', 'INTAKE_CLAIM_MINUTES', 'INTAKE_BATCH', 'REPORT_RETRY_BASE_SECONDS', 'REPORT_RETRY_CAP_SECONDS',
  ])('throws when %s is zero or negative', (name) => {
    expect(() => load({ [name]: '0' })).toThrow(`${name} must be greater than 0, got "0"`);
    expect(() => load({ [name]: '-3' })).toThrow(`${name} must be greater than 0`);
  });

  it('throws for a tunable that is not an integer', () => {
    expect(() => load({ INTAKE_POLL_MS: 'fast' })).toThrow('INTAKE_POLL_MS must be an integer');
  });

  it('throws when the report cap is below its base', () => {
    expect(() => load({ REPORT_RETRY_BASE_SECONDS: '10', REPORT_RETRY_CAP_SECONDS: '5' })).toThrow('REPORT_RETRY_CAP_SECONDS (5) must be at least REPORT_RETRY_BASE_SECONDS (10)');
    expect(load({ REPORT_RETRY_BASE_SECONDS: '10', REPORT_RETRY_CAP_SECONDS: '10' }).report).toEqual({ baseSeconds: 10, capSeconds: 10 });
  });
});

describe('dbosSystemDatabaseUrl', () => {
  it('prefers the DBOS url, then the connection string', () => {
    expect(dbosSystemDatabaseUrl(load({ DBOS_SYSTEM_DATABASE_URL: 'postgresql://dbos/sys', DATABASE_URL: 'postgresql://app/db' }))).toBe('postgresql://dbos/sys');
    expect(dbosSystemDatabaseUrl(load({ DATABASE_URL: 'postgresql://app/db' }))).toBe('postgresql://app/db');
  });

  it('builds a url from the parts, encoding the user and the password', () => {
    const config = load({ POSTGRES_HOST: 'db', POSTGRES_PORT: '5433', POSTGRES_USER: 'site user', POSTGRES_PASSWORD: 'p@ss/word', POSTGRES_DB: 'site' });
    expect(dbosSystemDatabaseUrl(config)).toBe('postgresql://site%20user:p%40ss%2Fword@db:5433/site');
  });
});
