import type { OrderPlan } from '../../src/activities/plan';
import { sha256Of, MODEL_BYTES } from './order-fixtures';

/** The plan of one order on the example line. */
export function orderPlan(overrides: Partial<OrderPlan> = {}): OrderPlan {
  return {
    site: 'site-1',
    print: {
      role: 'line-print',
      process: 'print',
      siteId: 'site-1',
      lineId: 'line-1',
      toMachine: 'printer-01',
      recipeId: 'RCP-PRINT',
      recipeVersion: '1',
      artifactUrl: 'http://assets.invalid/esc-1/model.stl',
      artifactSha256: sha256Of(MODEL_BYTES),
      timeout: '4h',
    },
    report: { baseSeconds: 5, capSeconds: 300 },
    ...overrides,
  };
}
