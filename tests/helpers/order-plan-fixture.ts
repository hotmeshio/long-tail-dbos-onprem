import type { LensPlan, OrderPlan, PackPlan, PrintPlan, StationPlan } from '../../src/activities/plan';
import { ROLE } from '../../src/modules/constants';
import { FRAME_BYTES, FRAME_NAME, sha256Of } from './order-fixtures';

export const PRINTER: StationPlan = { machineId: 'p1s-01', role: ROLE.PRINTER_FLEET, process: 'print', recipeId: 'print-file', recipeVersion: '1' };
export const EDGER: StationPlan = { machineId: 'edge-01', role: ROLE.EDGE_CELL, process: 'edge', recipeId: 'RCP-EDGE-A', recipeVersion: '1' };
export const PRESS: StationPlan = { machineId: 'mount-01', role: ROLE.MOUNT_CELL, process: 'mount', recipeId: 'RCP-MOUNT-A', recipeVersion: '2' };
export const CAMERA: StationPlan = { machineId: 'inspect-01', role: ROLE.INSPECT_CELL, process: 'inspect', recipeId: 'RCP-INSPECT-A', recipeVersion: '1' };

export function printPlan(overrides: Partial<PrintPlan> = {}): PrintPlan {
  return {
    siteId: 'site-1',
    lineId: 'print-1',
    operatorRole: ROLE.PRINT_SERVICING,
    exitRole: ROLE.PRINT_UNLOAD,
    timeout: '4h',
    station: PRINTER,
    serialNumber: 'PRN-001',
    model: 'model-b',
    artifactUrl: `http://assets.invalid/esc-1/${FRAME_NAME}`,
    artifactSha256: sha256Of(FRAME_BYTES),
    ...overrides,
  };
}

export function lensPlan(overrides: Partial<LensPlan> = {}): LensPlan {
  return {
    siteId: 'site-1',
    lineId: 'line-1',
    operatorRole: ROLE.LINE_OPERATOR,
    exitRole: ROLE.FITTER,
    timeout: '30m',
    stations: [EDGER, PRESS, CAMERA],
    handRoles: { [PRESS.machineId]: ROLE.HAND_MOUNT },
    ...overrides,
  };
}

export function packPlan(overrides: Partial<PackPlan> = {}): PackPlan {
  return { binKey: 'bin-7', destination: 'Portland', max: 12, timeout: '4h', packageTimeout: '24h', ...overrides };
}

/** The plan of one order on the example lines. */
export function orderPlan(overrides: Partial<OrderPlan> = {}): OrderPlan {
  return {
    site: 'site-1',
    print: printPlan(),
    lens: lensPlan(),
    pack: packPlan(),
    report: { baseSeconds: 5, capSeconds: 300 },
    ...overrides,
  };
}
