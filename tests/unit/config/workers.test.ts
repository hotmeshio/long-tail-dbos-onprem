import { describe, expect, it } from 'vitest';

import { WORKER_QUEUES, workers } from '../../../src/config/workers';
import { TASK_QUEUE, WORKFLOW } from '../../../src/modules/constants';

describe('workers', () => {
  it('registers the order workflow and the bin workflow on the site task queue', () => {
    expect(workers.map((worker) => worker.workflow)).toEqual([WORKFLOW.MAKE_GLASSES, WORKFLOW.ROLLUP_BIN]);
    for (const worker of workers) expect(worker.taskQueue).toBe(TASK_QUEUE);
  });

  it('keeps both off the invoke page and describes them', () => {
    for (const worker of workers) {
      expect(worker.config).toMatchObject({ invocable: false });
      expect(worker.config?.description).toBeTruthy();
    }
  });

  it('lists each task queue once', () => {
    expect(WORKER_QUEUES).toEqual([TASK_QUEUE]);
  });
});
