import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/services/bot-key', () => ({ issueBotKey: vi.fn() }));

import type { CloudConfig } from '../../../src/modules/config';
import { BOT, ROLE_TYPE } from '../../../src/modules/constants';
import { issueBotKey } from '../../../src/services/bot-key';
import { cloudCredentials } from '../../../src/services/cloud-credentials';
import { INTAKE_ROLE } from '../../helpers/order-fixtures';

const issue = vi.mocked(issueBotKey);
const ADMIN = { username: 'admin', password: 'pw' };
const SITE = { siteId: 'site-1', role: INTAKE_ROLE };
const ISSUED = { botId: 'bot-1', apiKey: 'lt_bot_fresh' };

const cloudConfig = (access: CloudConfig['access']): CloudConfig => ({
  url: 'http://cloud.invalid', access, timeoutMs: 1000, downloadTimeoutMs: 1000,
  retry: { retries: 0, baseDelayMs: 1, maxDelayMs: 1 },
});

beforeEach(() => vi.resetAllMocks());

describe('cloudCredentials', () => {
  it('returns the key pair from the environment without a call', async () => {
    const credentials = cloudCredentials(cloudConfig({ apiKey: 'lt_bot_test', botId: 'bot-test' }), SITE);
    expect(await credentials()).toEqual({ apiKey: 'lt_bot_test', botId: 'bot-test' });
    expect(issue).not.toHaveBeenCalled();
  });

  it('does not sign in until the credentials are first asked for', () => {
    cloudCredentials(cloudConfig({ admin: ADMIN }), SITE);
    expect(issue).not.toHaveBeenCalled();
  });

  it('issues a key for the site bot with an admin login', async () => {
    issue.mockResolvedValue(ISSUED);
    const credentials = cloudCredentials(cloudConfig({ admin: ADMIN }), SITE);
    expect(await credentials()).toEqual(ISSUED);
    expect(issue).toHaveBeenCalledWith(
      'http://cloud.invalid',
      ADMIN,
      expect.objectContaining({ name: `${BOT.SITE_PREFIX}-${SITE.siteId}`, roles: [{ role: INTAKE_ROLE, type: ROLE_TYPE.MEMBER }] }),
      { attempts: 1 },
    );
  });

  it('issues one key however often it is asked', async () => {
    issue.mockResolvedValue(ISSUED);
    const credentials = cloudCredentials(cloudConfig({ admin: ADMIN }), SITE);
    const all = await Promise.all([credentials(), credentials(), credentials()]);
    expect(await credentials()).toEqual(ISSUED);
    expect(all).toEqual([ISSUED, ISSUED, ISSUED]);
    expect(issue).toHaveBeenCalledTimes(1);
  });

  it('keeps nothing from a failed sign-in, so the next call tries again', async () => {
    issue.mockRejectedValueOnce(new Error('cloud is down')).mockResolvedValue(ISSUED);
    const credentials = cloudCredentials(cloudConfig({ admin: ADMIN }), SITE);
    await expect(credentials()).rejects.toThrow('cloud is down');
    expect(await credentials()).toEqual(ISSUED);
    expect(issue).toHaveBeenCalledTimes(2);
  });

  it('keeps separate credentials per site', async () => {
    issue.mockResolvedValueOnce(ISSUED).mockResolvedValueOnce({ botId: 'bot-2', apiKey: 'lt_bot_other' });
    const first = cloudCredentials(cloudConfig({ admin: ADMIN }), SITE);
    const second = cloudCredentials(cloudConfig({ admin: ADMIN }), { ...SITE, siteId: 'site-2' });
    expect((await first()).botId).toBe('bot-1');
    expect((await second()).botId).toBe('bot-2');
    expect(issue.mock.calls[1][2].name).toBe(`${BOT.SITE_PREFIX}-site-2`);
  });
});
