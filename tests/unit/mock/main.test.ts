import { describe, expect, it } from 'vitest';

import { parseRejects } from '../../../mock/main';

describe('parseRejects', () => {
  it('reads nothing from an unset or empty value', () => {
    expect(parseRejects(undefined)).toEqual({});
    expect(parseRejects('')).toEqual({});
  });

  it('reads one order per machine', () => {
    expect(parseRejects('inspect-01:A-1044,p1s-01:A-1045')).toEqual({ 'inspect-01': ['A-1044'], 'p1s-01': ['A-1045'] });
  });

  it('gathers several orders for one machine', () => {
    expect(parseRejects('mount-01:A-1042,mount-01:A-1043')).toEqual({ 'mount-01': ['A-1042', 'A-1043'] });
  });

  it('skips blank entries and trims spaces', () => {
    expect(parseRejects(' edge-01:A-1042 , ,')).toEqual({ 'edge-01': ['A-1042'] });
  });

  it('throws on an entry with no order', () => {
    expect(() => parseRejects('edge-01')).toThrow('STATION_REJECTS entries read machine:order, got "edge-01"');
  });

  it('throws on an entry with no machine', () => {
    expect(() => parseRejects(':A-1042')).toThrow('got ":A-1042"');
  });
});
