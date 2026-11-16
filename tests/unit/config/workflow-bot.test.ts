import { beforeEach, describe, expect, it, vi } from 'vitest';

const longTail = vi.hoisted(() => ({
  listBots: vi.fn(),
  addBotRole: vi.fn(),
  createBot: vi.fn(),
  createClient: vi.fn((options: unknown) => ({ options })),
}));
vi.mock('@hotmeshio/long-tail', () => ({
  api: { botAccounts: { listBots: longTail.listBots, addBotRole: longTail.addBotRole, createBot: longTail.createBot } },
  createClient: longTail.createClient,
}));

import { workflowConnection } from '../../../src/config/workflow-bot';
import { BOT, ROLE_TYPE } from '../../../src/modules/constants';

const BOT_ROLE = { role: ROLE_TYPE.SUPERADMIN, type: ROLE_TYPE.SUPERADMIN };
const existing = { id: 'bot-7', external_id: BOT.WORKFLOWS };

beforeEach(() => {
  vi.clearAllMocks();
  longTail.addBotRole.mockResolvedValue({ status: 200 });
  longTail.createBot.mockResolvedValue({ status: 201, data: { id: 'bot-new', external_id: BOT.WORKFLOWS } });
});

describe('workflowConnection', () => {
  it('searches for the workflow bot by name', async () => {
    longTail.listBots.mockResolvedValue({ status: 200, data: { bots: [existing] } });
    await workflowConnection();
    expect(longTail.listBots).toHaveBeenCalledWith({ search: BOT.WORKFLOWS, limit: 50 });
  });

  it('reuses the bot it finds, makes sure of its role and connects as it', async () => {
    longTail.listBots.mockResolvedValue({ status: 200, data: { bots: [{ id: 'bot-1', external_id: 'another-bot' }, existing] } });
    const connection = await workflowConnection();
    expect(longTail.addBotRole).toHaveBeenCalledWith({ id: existing.id, ...BOT_ROLE });
    expect(longTail.createBot).not.toHaveBeenCalled();
    expect(longTail.createClient).toHaveBeenCalledWith({ auth: { userId: existing.id } });
    expect(connection).toEqual({ client: longTail.createClient.mock.results[0].value });
  });

  it('accepts a bare array of bots', async () => {
    longTail.listBots.mockResolvedValue({ status: 200, data: [existing] });
    await workflowConnection();
    expect(longTail.createClient).toHaveBeenCalledWith({ auth: { userId: existing.id } });
  });

  it('creates the bot when the search finds only near matches', async () => {
    longTail.listBots.mockResolvedValue({ status: 200, data: { bots: [{ id: 'bot-1', external_id: `${BOT.WORKFLOWS}-old` }] } });
    await workflowConnection();
    expect(longTail.createBot).toHaveBeenCalledWith(expect.objectContaining({ name: BOT.WORKFLOWS, roles: [BOT_ROLE] }));
    expect(longTail.addBotRole).not.toHaveBeenCalled();
    expect(longTail.createClient).toHaveBeenCalledWith({ auth: { userId: 'bot-new' } });
  });

  it('creates the bot when the list carries no bots', async () => {
    longTail.listBots.mockResolvedValue({ status: 200, data: {} });
    await workflowConnection();
    expect(longTail.createBot).toHaveBeenCalledTimes(1);
  });

  it('throws when the bots cannot be listed', async () => {
    longTail.listBots.mockResolvedValue({ status: 500, error: 'database is down' });
    await expect(workflowConnection()).rejects.toThrow('list bots: database is down');
    expect(longTail.createClient).not.toHaveBeenCalled();
  });

  it('throws when the bot cannot be created, with the status when no error is given', async () => {
    longTail.listBots.mockResolvedValue({ status: 200, data: [] });
    longTail.createBot.mockResolvedValue({ status: 403 });
    await expect(workflowConnection()).rejects.toThrow('create bot: 403');
  });
});
