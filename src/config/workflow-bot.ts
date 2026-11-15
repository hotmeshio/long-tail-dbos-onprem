import { api, createClient } from '@hotmeshio/long-tail';
import type { LongTailConnection } from '@hotmeshio/long-tail-dbos';

import { BOT, ROLE_TYPE } from '../modules/constants';

// Superadmin: the workflows open waits on the machine role the line file declares as well as the floor roles.
const BOT_ROLES = [{ role: ROLE_TYPE.SUPERADMIN, type: ROLE_TYPE.SUPERADMIN }];

interface Bot { id: string; external_id: string }

function ok<T>(what: string, result: { status: number; data?: unknown; error?: string }): T {
  if (result.status >= 400) throw new Error(`${what}: ${result.error ?? result.status}`);
  return result.data as T;
}

async function findOrCreateBot(): Promise<Bot> {
  const listed = ok<{ bots?: Bot[] } | Bot[]>('list bots', await api.botAccounts.listBots({ search: BOT.WORKFLOWS, limit: 50 }));
  const bots = Array.isArray(listed) ? listed : listed.bots ?? [];
  const existing = bots.find((bot) => bot.external_id === BOT.WORKFLOWS);
  if (existing) {
    for (const role of BOT_ROLES) await api.botAccounts.addBotRole({ id: existing.id, ...role });
    return existing;
  }
  return ok<Bot>('create bot', await api.botAccounts.createBot({
    name: BOT.WORKFLOWS,
    display_name: 'Site workflows',
    description: 'Opens the escalations the site workflows wait on',
    roles: BOT_ROLES,
  }));
}

/** How conditional() reaches this site's Long Tail: in process, as the workflow bot. */
export async function workflowConnection(): Promise<LongTailConnection> {
  const bot = await findOrCreateBot();
  return { client: createClient({ auth: { userId: bot.id } }) };
}
