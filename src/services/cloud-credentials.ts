import type { CloudCredentials } from '../lib/cloud-client';
import type { CloudConfig } from '../modules/config';
import { BOT, ROLE_TYPE } from '../modules/constants';
import { issueBotKey } from './bot-key';

export interface SiteBot {
  siteId: string;
  role: string;
}

/**
 * The site's sign-in to the cloud, read on first use and kept. With a key in
 * the environment that is the answer. With an admin login (a local demo) the
 * first call that reaches the cloud issues the site's bot a key; a failed
 * call keeps nothing, so the next one tries again.
 */
export function cloudCredentials(cloud: CloudConfig, bot: SiteBot): () => Promise<CloudCredentials> {
  const { access } = cloud;
  if ('apiKey' in access) {
    const fixed = { apiKey: access.apiKey, botId: access.botId };
    return async () => fixed;
  }
  let issued: Promise<CloudCredentials> | undefined;
  return () => {
    issued ??= issueBotKey(
      cloud.url,
      access.admin,
      {
        name: `${BOT.SITE_PREFIX}-${bot.siteId}`,
        description: `Claims and reports ${bot.role} work for ${bot.siteId}`,
        roles: [{ role: bot.role, type: ROLE_TYPE.MEMBER }],
      },
      { attempts: 1 },
    ).catch((err) => {
      issued = undefined;
      throw err;
    });
    return issued;
  };
}
