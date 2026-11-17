import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbos = vi.hoisted(() => ({
  getWorkflowStatus: vi.fn(),
  startWorkflow: vi.fn(),
}));
vi.mock('@dbos-inc/dbos-sdk', () => ({ DBOS: dbos }));

import { dbosRuns } from '../../../../src/services/intake/runs';
import { makeGlassesInput } from '../../../helpers/order-fixtures';

const workflow = vi.fn(async () => 'done');
const invoke = vi.fn(async () => ({ workflowID: 'esc-1' }));

beforeEach(() => {
  vi.resetAllMocks();
  dbos.startWorkflow.mockReturnValue(invoke);
});

describe('dbosRuns', () => {
  it('has a run when DBOS knows the workflow id', async () => {
    dbos.getWorkflowStatus.mockResolvedValue({ workflowID: 'esc-1', status: 'PENDING' });
    expect(await dbosRuns(workflow).has('esc-1')).toBe(true);
    expect(dbos.getWorkflowStatus).toHaveBeenCalledWith('esc-1');
  });

  it('has no run when DBOS has no status for the id', async () => {
    dbos.getWorkflowStatus.mockResolvedValue(null);
    expect(await dbosRuns(workflow).has('esc-2')).toBe(false);
  });

  it('passes a status lookup failure to the caller', async () => {
    dbos.getWorkflowStatus.mockRejectedValue(new Error('database is down'));
    await expect(dbosRuns(workflow).has('esc-1')).rejects.toThrow('database is down');
  });

  it('starts the workflow under the escalation id, with the input', async () => {
    const input = makeGlassesInput({ escalationId: 'esc-5' });
    await dbosRuns(workflow).start(input);
    expect(dbos.startWorkflow).toHaveBeenCalledWith(workflow, { workflowID: 'esc-5' });
    expect(invoke).toHaveBeenCalledWith(input);
  });

  it('starts without running the workflow body itself', async () => {
    await dbosRuns(workflow).start(makeGlassesInput());
    expect(workflow).not.toHaveBeenCalled();
  });

  it('passes a start failure to the caller', async () => {
    invoke.mockRejectedValue(new Error('queue is full'));
    await expect(dbosRuns(workflow).start(makeGlassesInput())).rejects.toThrow('queue is full');
  });
});
