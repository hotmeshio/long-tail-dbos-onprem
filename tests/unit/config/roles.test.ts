import { describe, expect, it } from 'vitest';

import { roles } from '../../../src/config/roles';
import { ROLE } from '../../../src/modules/constants';

const roleOf = (name: string) => roles.find((entry) => entry.role === name);
type Schema = { type: string; properties: Record<string, { type: string }>; required?: string[] };

describe('roles', () => {
  it('declares the floor inspector and the floor lead, once each', () => {
    expect(roles.map((entry) => entry.role).sort()).toEqual([ROLE.INSPECTOR, ROLE.LEAD].sort());
  });

  it('gives every role a title, a description and an object form', () => {
    for (const entry of roles) {
      expect(entry.title).toBeTruthy();
      expect(entry.description).toBeTruthy();
      expect((entry.form_schema as Schema).type).toBe('object');
    }
  });

  it('asks the inspector for the decision and the unit count the workflow reads', () => {
    const schema = roleOf(ROLE.INSPECTOR)?.form_schema as Schema;
    expect(schema.required).toEqual(['passed', 'units']);
    expect(schema.properties.passed.type).toBe('boolean');
    expect(schema.properties.units.type).toBe('integer');
    expect(schema.properties.notes.type).toBe('string');
  });

  it('asks the lead whether to print again', () => {
    const schema = roleOf(ROLE.LEAD)?.form_schema as Schema;
    expect(schema.properties.retry.type).toBe('boolean');
    expect(schema.properties.notes.type).toBe('string');
  });
});
