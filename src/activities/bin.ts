import { api } from '@hotmeshio/long-tail';

import { workflowBotId } from '../config/workflow-bot';
import { ESCALATION_STATUS, ESCALATION_SUBTYPE, ROLE } from '../modules/constants';

async function countBinRows(binKey: string, userId: string, status?: string): Promise<number> {
  const result = await api.escalations.listEscalations({
    role: ROLE.BIN,
    subtype: ESCALATION_SUBTYPE.BIN,
    facets: { binKey },
    limit: 1,
    ...(status ? { status } : {}),
  }, { userId });
  if (result.status >= 400) throw new Error(`list bin rows for ${binKey}: ${result.error ?? result.status}`);
  return (result.data as { total: number }).total;
}

/**
 * Which fill of a bin is open: every shipped fill counts one, and the open
 * fill is the next. Orders packed while a bin is open share its number.
 */
export async function binGeneration(binKey: string): Promise<number> {
  const userId = await workflowBotId();
  const [all, open] = await Promise.all([
    countBinRows(binKey, userId),
    countBinRows(binKey, userId, ESCALATION_STATUS.PENDING),
  ]);
  return all - open + 1;
}
