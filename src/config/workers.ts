import type { LTStartConfig } from '@hotmeshio/long-tail';

import { TASK_QUEUE, WORKFLOW } from '../modules/constants';

/** Intake starts `fabricate` from a claimed cloud order, so the dashboard lists it without an invoke form. */
export const workers: NonNullable<LTStartConfig['workers']> = [
  {
    taskQueue: TASK_QUEUE,
    workflow: WORKFLOW.FABRICATE,
    config: {
      invocable: false,
      description: 'Builds one claimed cloud order: verify the files, print, inspect, report the outcome',
    },
  },
];

export const WORKER_QUEUES = [...new Set(workers.map((worker) => worker.taskQueue))];
