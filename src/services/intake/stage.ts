import { downloadFile, type CloudClient } from '../../lib/cloud-client';
import { assetPath, hashFile } from '../../lib/work-dir';
import type { ProductionOrder, StagedAsset } from '../../types/production';

export interface StageOptions {
  workDir: string;
  timeoutMs: number;
}

async function alreadyStaged(path: string, sha256: string): Promise<boolean> {
  try {
    return (await hashFile(path)).sha256 === sha256;
  } catch {
    return false;
  }
}

/**
 * Bring an order's files to the site's disk and check each against the
 * checksum the order declares. A file already on disk and intact is kept.
 */
export async function stageAssets(cloud: CloudClient, escalationId: string, order: ProductionOrder, options: StageOptions): Promise<StagedAsset[]> {
  // 1. Signed links for the row's files
  const files = await cloud.files(escalationId);

  // 2. Each declared asset, downloaded and verified
  const staged: StagedAsset[] = [];
  for (const asset of order.assets) {
    const file = files.find((candidate) => candidate.as === asset.as);
    if (!file) throw new Error(`order ${order.orderId}: the cloud lists no "${asset.as}" file`);
    const path = assetPath(options.workDir, escalationId, file.name);
    if (!(await alreadyStaged(path, asset.sha256))) {
      if (!file.url) throw new Error(`order ${order.orderId}: no link for "${asset.as}": ${file.error ?? 'none given'}`);
      const arrived = await downloadFile(file.url, path, options.timeoutMs);
      if (arrived.sha256 !== asset.sha256) {
        throw new Error(`order ${order.orderId}: "${asset.as}" arrived as ${arrived.sha256}, the order declares ${asset.sha256}`);
      }
    }
    staged.push({ ...asset, name: file.name });
  }
  return staged;
}
