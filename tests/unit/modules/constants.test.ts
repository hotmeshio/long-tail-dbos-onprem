import { describe, expect, it } from 'vitest';

import {
  ASSET, BOT, ESCALATION_STATUS, ESCALATION_TYPE, FABRICATE_STATUS, LOG_EVENTS, PRINT_ERROR, REPORT_STATE, ROLE,
  inspectionKey, printFailedKey, reportClosedKey,
} from '../../../src/modules/constants';

describe('signal key builders', () => {
  it('builds the inspection key from the escalation id', () => {
    expect(inspectionKey('esc-1')).toBe('inspect-esc-1');
  });

  it('builds a print-failed key per attempt', () => {
    expect(printFailedKey('esc-1', 1)).toBe('print-failed-esc-1-1');
    expect(printFailedKey('esc-1', 2)).not.toBe(printFailedKey('esc-1', 1));
  });

  it('builds the report-closed key from the escalation id', () => {
    expect(reportClosedKey('esc-1')).toBe('report-closed-esc-1');
  });

  it('gives each wait of one order its own key', () => {
    const keys = [inspectionKey('esc-1'), printFailedKey('esc-1', 1), reportClosedKey('esc-1')];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('gives two orders different keys', () => {
    expect(inspectionKey('esc-1')).not.toBe(inspectionKey('esc-2'));
    expect(printFailedKey('esc-1', 1)).not.toBe(printFailedKey('esc-2', 1));
    expect(reportClosedKey('esc-1')).not.toBe(reportClosedKey('esc-2'));
  });
});

describe('constant groups', () => {
  const groups = { ASSET, BOT, ESCALATION_STATUS, ESCALATION_TYPE, FABRICATE_STATUS, LOG_EVENTS, PRINT_ERROR, REPORT_STATE, ROLE };

  it.each(Object.entries(groups))('%s holds distinct, non-empty strings', (_name, group) => {
    const values = Object.values(group);
    expect(values.every((value) => typeof value === 'string' && value.length > 0)).toBe(true);
    expect(new Set(values).size).toBe(values.length);
  });

  it('keeps the two floor roles apart', () => {
    expect(ROLE.INSPECTOR).not.toBe(ROLE.LEAD);
  });

  it('names the report states the workflow branches on', () => {
    expect(Object.keys(REPORT_STATE).sort()).toEqual(['CLOSED', 'REFUSED', 'RESOLVED', 'UNREACHABLE']);
  });
});
