import type { CloudClient } from './types';

export { downloadFile, type Downloaded } from './download';
export { HttpCloudClient, type HttpCloudClientOptions } from './http-cloud-client';
export { executeWithRetry, isRetryable, retryDelayMs } from './retry';
export type { ClaimQuery, CloudClient, CloudCredentials, CloudEscalation, CloudFile, RetryPolicy } from './types';

let configured: CloudClient | undefined;

/** Register the client intake and the workflow steps share. */
export function configureCloud(client: CloudClient | undefined): void {
  configured = client;
}

export function getCloud(): CloudClient {
  if (!configured) throw new Error('No cloud client is configured: set CLOUD_URL and call configureCloud() at startup');
  return configured;
}
