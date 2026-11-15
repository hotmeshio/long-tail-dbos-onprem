import { DBOS } from '@dbos-inc/dbos-sdk';

import type { FabricateInput } from '../../types/fabrication';

/** The site's record of which cloud orders it has started work on. */
export interface FabricationRuns {
  has(escalationId: string): Promise<boolean>;
  start(input: FabricateInput): Promise<void>;
}

/** Runs kept by DBOS: the workflow id is the cloud escalation id, so an order starts once. */
export function dbosRuns<R>(workflow: (input: FabricateInput) => Promise<R>): FabricationRuns {
  return {
    async has(escalationId) {
      return (await DBOS.getWorkflowStatus(escalationId)) !== null;
    },
    async start(input) {
      await DBOS.startWorkflow(workflow, { workflowID: input.escalationId })(input);
    },
  };
}
