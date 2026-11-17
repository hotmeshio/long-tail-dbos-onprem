import { DBOS } from '@dbos-inc/dbos-sdk';

import type { MakeGlassesInput } from '../../types/production';

/** The site's record of which cloud orders it has started work on. */
export interface ProductionRuns {
  has(escalationId: string): Promise<boolean>;
  start(input: MakeGlassesInput): Promise<void>;
}

/** Runs kept by DBOS: the workflow id is the cloud escalation id, so an order starts once. */
export function dbosRuns<R>(workflow: (input: MakeGlassesInput) => Promise<R>): ProductionRuns {
  return {
    async has(escalationId) {
      return (await DBOS.getWorkflowStatus(escalationId)) !== null;
    },
    async start(input) {
      await DBOS.startWorkflow(workflow, { workflowID: input.escalationId })(input);
    },
  };
}
