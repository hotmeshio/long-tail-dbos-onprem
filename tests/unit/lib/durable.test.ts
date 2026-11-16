import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbos = vi.hoisted(() => ({
  workflowID: undefined as string | undefined,
  runStep: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  sleep: vi.fn(async () => undefined),
}));
vi.mock('@dbos-inc/dbos-sdk', () => ({ DBOS: dbos }));

import { STEP_ONCE, STEP_RETRY, proxySteps, sleepSeconds, workflowId } from '../../../src/lib/durable';

beforeEach(() => {
  vi.clearAllMocks();
  dbos.workflowID = undefined;
});

describe('proxySteps', () => {
  const activities = {
    addOne: async (value: number) => value + 1,
    join: async (left: string, right: string) => `${left}-${right}`,
    LIMIT: 3,
  };

  it('runs each function as a step named after it and returns its result', async () => {
    const steps = proxySteps(activities);
    expect(await steps.addOne(1)).toBe(2);
    expect(await steps.join('a', 'b')).toBe('a-b');
    expect(dbos.runStep.mock.calls.map((call) => (call as unknown[])[1])).toEqual([
      { ...STEP_RETRY, name: 'addOne' },
      { ...STEP_RETRY, name: 'join' },
    ]);
  });

  it('retries by default with a bounded policy', () => {
    expect(STEP_RETRY.retriesAllowed).toBe(true);
    expect(STEP_RETRY.maxAttempts).toBeGreaterThan(1);
  });

  it('uses the given step config', async () => {
    await proxySteps(activities, STEP_ONCE).addOne(1);
    expect(dbos.runStep).toHaveBeenCalledWith(expect.any(Function), { retriesAllowed: false, name: 'addOne' });
  });

  it('leaves out exports that are not functions', () => {
    expect(Object.keys(proxySteps(activities))).toEqual(['addOne', 'join']);
  });

  it('passes a step failure to the caller', async () => {
    const steps = proxySteps({ fail: async () => { throw new Error('disk full'); } });
    await expect(steps.fail()).rejects.toThrow('disk full');
  });
});

describe('workflowId', () => {
  it('returns the running workflow id', () => {
    dbos.workflowID = 'esc-1';
    expect(workflowId()).toBe('esc-1');
  });

  it('throws outside a workflow', () => {
    expect(() => workflowId()).toThrow('must run inside a DBOS workflow');
  });
});

describe('sleepSeconds', () => {
  it('sleeps durably for the seconds given', async () => {
    await sleepSeconds(5);
    expect(dbos.sleep).toHaveBeenCalledWith(5000);
  });
});
