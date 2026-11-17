import { rm } from 'node:fs/promises';

import { assetPath, hashFile, orderDir } from '../lib/work-dir';
import { loadConfig } from '../modules/config';
import type { StagedAsset } from '../types/production';

export interface AssetCheck {
  verified: boolean;
  detail?: string;
}

/** Check every staged file against the checksum and size its order declares. */
export async function verifyAssets(escalationId: string, assets: StagedAsset[]): Promise<AssetCheck> {
  const { workDir } = loadConfig().assets;
  for (const asset of assets) {
    let found: { sha256: string; size: number };
    try {
      found = await hashFile(assetPath(workDir, escalationId, asset.name));
    } catch (err) {
      return { verified: false, detail: `${asset.name} is not on the site's disk: ${(err as Error).message}` };
    }
    if (found.sha256 !== asset.sha256 || found.size !== asset.size) {
      return { verified: false, detail: `${asset.name} does not match the checksum the order declares` };
    }
  }
  return { verified: true };
}

/** Remove an order's files once its outcome is settled. */
export async function cleanWorkDir(escalationId: string): Promise<void> {
  await rm(orderDir(loadConfig().assets.workDir, escalationId), { recursive: true, force: true });
}
