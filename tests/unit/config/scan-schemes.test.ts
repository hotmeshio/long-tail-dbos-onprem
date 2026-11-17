import { describe, expect, it } from 'vitest';

import { scanSchemes } from '../../../src/config/scan-schemes';
import { ESCALATION_STATUS, ESCALATION_SUBTYPE, ROLE, SCAN_SCHEME, SHIP_VIA } from '../../../src/modules/constants';

const schemeOf = (version: number) => {
  const scheme = scanSchemes.find((candidate) => candidate.version === version);
  if (!scheme) throw new Error(`no scheme ${version}`);
  return scheme;
};
const stepsOf = (version: number) => schemeOf(version).rules?.[0]?.steps ?? [];

describe('scanSchemes', () => {
  it('declares one scheme per version', () => {
    const versions = scanSchemes.map((scheme) => scheme.version);
    expect(versions).toEqual([SCAN_SCHEME.BADGE, SCAN_SCHEME.PACKAGE, SCAN_SCHEME.BIN, SCAN_SCHEME.PRINTER]);
    expect(new Set(versions).size).toBe(versions.length);
  });

  it('makes a badge a short grant spent by the next scan', () => {
    const badge = schemeOf(SCAN_SCHEME.BADGE);
    expect(badge.kind).toBe('identity');
    expect(badge.grant_ttl_seconds).toBe(120);
    expect(badge.grant_max_uses).toBe(1);
  });

  it('holds a scanned package and expects its bin next', () => {
    const [hold] = stepsOf(SCAN_SCHEME.PACKAGE);
    expect(schemeOf(SCAN_SCHEME.PACKAGE).target_facet).toBe('orderId');
    expect(hold.verb).toBe('hold');
    expect(hold.query).toEqual({ roles: [ROLE.PACKAGE], status: ESCALATION_STATUS.PENDING });
    expect(hold.params?.hold?.expect?.schemes).toEqual([SCAN_SCHEME.BIN]);
  });

  it('places the held package in the open bin under a badge', () => {
    const [place] = stepsOf(SCAN_SCHEME.BIN);
    expect(schemeOf(SCAN_SCHEME.BIN).target_facet).toBe('binKey');
    expect(place.verb).toBe('accumulate');
    expect(place.requireActingIdentity).toBe(true);
    expect(place.subject).toEqual({ schemes: [SCAN_SCHEME.PACKAGE] });
    expect(place.params?.itemKey).toBe('{subject.orderId}');
    expect(place.params?.accumulate?.container).toEqual({ roles: [ROLE.BIN], subtypes: [ESCALATION_SUBTYPE.BIN] });
  });

  it('lets a shift lead ship a scanned bin by courier', () => {
    const [, present] = stepsOf(SCAN_SCHEME.BIN);
    expect(present.verb).toBe('present');
    const ship = present.choices?.find((choice) => choice.verb === 'resolve');
    expect(ship?.roles).toEqual([ROLE.SHIFT_LEAD]);
    expect(ship?.requireActingIdentity).toBe(true);
    expect(ship?.params?.resolverPayload).toEqual({ shipVia: SHIP_VIA.COURIER });
  });

  it('opens the frame waiting on a scanned printer', () => {
    const printer = schemeOf(SCAN_SCHEME.PRINTER);
    const [unload] = stepsOf(SCAN_SCHEME.PRINTER);
    expect(printer.target_facet).toBe('serialNumber');
    expect(printer.rules?.[0]?.category).toBe('1');
    expect(unload.verb).toBe('claim-show-detail');
    expect(unload.query).toEqual({ roles: [ROLE.PRINT_UNLOAD], status: ESCALATION_STATUS.PENDING });
  });
});
