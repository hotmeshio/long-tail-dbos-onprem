import { describe, expect, it } from 'vitest';

import { WORKER_QUEUES, workers } from '../../../src/config/workers';
import { TASK_QUEUE, WORKFLOW } from '../../../src/modules/constants';

describe('workers', () => {
  it('registers the fabricate workflow on the site task queue', () => {
    expect(workers).toHaveLength(1);
    expect(workers[0]).toMatchObject({ taskQueue: TASK_QUEUE, workflow: WORKFLOW.FABRICATE });
  });

  it('keeps fabricate off the invoke page and describes it', () => {
    expect(workers[0].config).toMatchObject({ invocable: false });
    expect(workers[0].config?.description).toBeTruthy();
  });

  it('lists each task queue once', () => {
    expect(WORKER_QUEUES).toEqual([TASK_QUEUE]);
    expect(new Set(WORKER_QUEUES).size).toBe(WORKER_QUEUES.length);
  });
});
