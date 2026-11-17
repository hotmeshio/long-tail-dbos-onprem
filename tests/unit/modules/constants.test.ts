import { describe, expect, it } from 'vitest';

import {
  ASSET, BOT, CLOUD_ROLE, ESCALATION_STATUS, ESCALATION_SUBTYPE, ESCALATION_TYPE, LOG_EVENTS, ORDER_STATUS, REPORT_STATE, ROLE,
  ROUTE_STATUS, SCAN_SCHEME, SHIP_VIA, TASK_QUEUE, TRIGGER, WORKFLOW,
  binWaitKey, binWorkflowId, packageKey, productionKey, reportClosedKey, routeKey, storyRunId,
} from '../../../src/modules/constants';

describe('key builders', () => {
  it('builds one route key per line of an order', () => {
    expect(routeKey.print('A-1042')).toBe('A-1042-print');
    expect(routeKey.lens('A-1042')).toBe('A-1042-lens');
  });

  it('builds the package key from the order id', () => {
    expect(packageKey('A-1042')).toBe('package-A-1042');
  });

  it('builds the bin wait key and a workflow id per fill of the bin', () => {
    expect(binWaitKey('bin-7')).toBe('bin-bin-7');
    expect(binWorkflowId('bin-7', 1)).toBe('rollup-bin-7-g1');
    expect(binWorkflowId('bin-7', 2)).not.toBe(binWorkflowId('bin-7', 1));
  });

  it('builds the report-closed key from the escalation id', () => {
    expect(reportClosedKey('esc-1')).toBe('report-closed-esc-1');
  });

  it('builds the cloud signal key and the story run id from the order id', () => {
    expect(productionKey('A-1042')).toBe('production-A-1042');
    expect(storyRunId('A-1042')).toBe('story-A-1042');
  });

  it('gives each wait of one order its own key', () => {
    const keys = [routeKey.print('A-1042'), routeKey.lens('A-1042'), packageKey('A-1042'), reportClosedKey('A-1042')];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('gives two orders different keys', () => {
    expect(routeKey.print('A-1042')).not.toBe(routeKey.print('A-1043'));
    expect(packageKey('A-1042')).not.toBe(packageKey('A-1043'));
  });
});

describe('constant groups', () => {
  const groups = {
    ASSET, BOT, CLOUD_ROLE, ESCALATION_STATUS, ESCALATION_SUBTYPE, ESCALATION_TYPE, LOG_EVENTS, ORDER_STATUS, REPORT_STATE, ROLE,
    ROUTE_STATUS, SHIP_VIA, TRIGGER, WORKFLOW,
  };

  it.each(Object.entries(groups))('%s holds distinct, non-empty strings', (_name, group) => {
    const values = Object.values(group);
    expect(values.every((value) => typeof value === 'string' && value.length > 0)).toBe(true);
    expect(new Set(values).size).toBe(values.length);
  });

  it('names the cloud queue, the task queue and the two workflows', () => {
    expect(CLOUD_ROLE.PRODUCTION).toBe('production');
    expect(TASK_QUEUE).toBe('production');
    expect(WORKFLOW).toEqual({ MAKE_GLASSES: 'makeGlasses', ROLLUP_BIN: 'rollupBin' });
  });

  it('names the files of an order', () => {
    expect(ASSET).toEqual({ FRAME: 'frame', PRESCRIPTION: 'prescription' });
  });

  it('gives each scan scheme its own version', () => {
    const versions = Object.values(SCAN_SCHEME);
    expect(new Set(versions).size).toBe(versions.length);
  });

  it('names the report states the workflow branches on', () => {
    expect(Object.keys(REPORT_STATE).sort()).toEqual(['CLOSED', 'REFUSED', 'RESOLVED', 'UNREACHABLE']);
  });
});
