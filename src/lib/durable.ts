import { DBOS, type StepConfig } from '@dbos-inc/dbos-sdk';

/** Ten attempts doubling from 1 s, about 17 minutes in all. */
export const STEP_RETRY: StepConfig = { retriesAllowed: true, maxAttempts: 10, intervalSeconds: 1, backoffRate: 2 };

/** One attempt: the workflow reads the step's result and decides what comes next. */
export const STEP_ONCE: StepConfig = { retriesAllowed: false };

type Activity = (...args: any[]) => Promise<any>;
type Activities<T> = { [K in keyof T as T[K] extends Activity ? K : never]: T[K] };

/** Every function a module exports, called as a checkpointed DBOS step named after it. */
export function proxySteps<T extends object>(activities: T, config: StepConfig = STEP_RETRY): Activities<T> {
  const steps: Record<string, Activity> = {};
  for (const [name, fn] of Object.entries(activities)) {
    if (typeof fn !== 'function') continue;
    steps[name] = (...args: unknown[]) => DBOS.runStep(() => (fn as Activity)(...args), { ...config, name });
  }
  return steps as Activities<T>;
}

/** The running workflow's id. */
export function workflowId(): string {
  const id = DBOS.workflowID;
  if (!id) throw new Error('workflowId() must run inside a DBOS workflow');
  return id;
}

/** Durable sleep in seconds. */
export function sleepSeconds(seconds: number): Promise<void> {
  return DBOS.sleep(seconds * 1000);
}
