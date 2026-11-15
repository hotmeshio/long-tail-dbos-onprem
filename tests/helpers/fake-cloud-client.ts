import { vi, type Mock } from 'vitest';

import type { CloudClient } from '../../src/lib/cloud-client';
import { cloudRow } from './order-fixtures';

export const TEST_BOT_ID = 'bot-test';

export type FakeCloudClient = { [K in keyof CloudClient]: Mock<CloudClient[K]> };

/** A CloudClient of mocks: nothing to claim, nothing held, every call succeeds. */
export function fakeCloudClient(overrides: Partial<CloudClient> = {}): FakeCloudClient {
  return {
    botId: vi.fn(overrides.botId ?? (async () => TEST_BOT_ID)),
    claim: vi.fn(overrides.claim ?? (async () => [])),
    listClaimed: vi.fn(overrides.listClaimed ?? (async () => [])),
    files: vi.fn(overrides.files ?? (async () => [])),
    read: vi.fn(overrides.read ?? (async (escalationId: string) => cloudRow({ id: escalationId }))),
    resolve: vi.fn(overrides.resolve ?? (async () => undefined)),
  };
}
