import { beforeEach, describe, expect, it, vi } from 'vitest';

const escalations = vi.hoisted(() => ({ listEscalations: vi.fn() }));
const bot = vi.hoisted(() => ({ workflowBotId: vi.fn() }));
vi.mock('@hotmeshio/long-tail', () => ({ api: { escalations } }));
vi.mock('../../../src/config/workflow-bot', () => bot);

import { binGeneration } from '../../../src/activities/bin';
import { ESCALATION_STATUS, ESCALATION_SUBTYPE, ROLE } from '../../../src/modules/constants';

const BIN_KEY = 'bin-7';
const BOT_ID = 'bot-1';

/** Answer the all-rows count and the pending count. */
function scriptCounts(all: number, pending: number): void {
  escalations.listEscalations.mockImplementation(async (query: { status?: string }) => ({
    status: 200,
    data: { total: query.status ? pending : all },
  }));
}

describe('binGeneration', () => {
  beforeEach(() => {
    escalations.listEscalations.mockReset();
    bot.workflowBotId.mockReset();
    bot.workflowBotId.mockResolvedValue(BOT_ID);
  });

  it('starts a bin never filled at one', async () => {
    scriptCounts(0, 0);
    expect(await binGeneration(BIN_KEY)).toBe(1);
  });

  it('shares the open fill among orders packed while it is open', async () => {
    scriptCounts(3, 1);
    expect(await binGeneration(BIN_KEY)).toBe(3);
  });

  it('moves to the next fill once every earlier one shipped', async () => {
    scriptCounts(3, 0);
    expect(await binGeneration(BIN_KEY)).toBe(4);
  });

  it('counts bin rows for that bin as the workflows bot', async () => {
    scriptCounts(1, 1);
    await binGeneration(BIN_KEY);
    const scope = { role: ROLE.BIN, subtype: ESCALATION_SUBTYPE.BIN, facets: { binKey: BIN_KEY }, limit: 1 };
    expect(escalations.listEscalations).toHaveBeenCalledWith(scope, { userId: BOT_ID });
    expect(escalations.listEscalations).toHaveBeenCalledWith({ ...scope, status: ESCALATION_STATUS.PENDING }, { userId: BOT_ID });
  });

  it('throws when the rows cannot be listed', async () => {
    escalations.listEscalations.mockResolvedValue({ status: 500, error: 'down' });
    await expect(binGeneration(BIN_KEY)).rejects.toThrow('list bin rows for bin-7: down');
  });
});
