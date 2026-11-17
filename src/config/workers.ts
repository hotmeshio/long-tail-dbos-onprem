import type { LTStartConfig } from '@hotmeshio/long-tail';

import { TASK_QUEUE, WORKFLOW } from '../modules/constants';

/** Intake starts `makeGlasses` from a claimed cloud order, so the dashboard lists both workflows without an invoke form. */
export const workers: NonNullable<LTStartConfig['workers']> = [
  {
    taskQueue: TASK_QUEUE,
    workflow: WORKFLOW.MAKE_GLASSES,
    config: {
      invocable: false,
      description: 'Makes one claimed cloud order: print the frame, run the lens line, fit, pack, report the outcome',
    },
  },
  {
    taskQueue: TASK_QUEUE,
    workflow: WORKFLOW.ROLLUP_BIN,
    config: {
      invocable: false,
      description: 'Keeps one bin open for a destination until it fills, the pickup arrives or a shift lead ships it',
    },
  },
];

export const WORKER_QUEUES = [...new Set(workers.map((worker) => worker.taskQueue))];
