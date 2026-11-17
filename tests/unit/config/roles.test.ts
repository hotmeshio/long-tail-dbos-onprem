import { Machines } from '@hotmeshio/long-tail';
import { describe, expect, it } from 'vitest';

import { BIN_FORM, BIN_LIST, HANDOFF_LIST, HUMAN_ROLES, UNLOAD_FORM, UNLOAD_LIST, roles } from '../../../src/config/roles';
import { ROLE, SHIP_VIA } from '../../../src/modules/constants';

const roleOf = (name: string) => {
  const found = roles.find((entry) => entry.role === name);
  if (!found) throw new Error(`no role ${name}`);
  return found;
};

describe('roles', () => {
  it('declares every site queue once', () => {
    expect(roles.map((entry) => entry.role).sort()).toEqual(Object.values(ROLE).sort());
  });

  it('gives every role a title', () => {
    for (const entry of roles) expect(entry.title).toBeTruthy();
  });

  it('gives the unload queue its form, its list and a priority threshold', () => {
    const unload = roleOf(ROLE.PRINT_UNLOAD);
    expect(unload.form_schema).toBe(UNLOAD_FORM);
    expect(unload.list_schema).toBe(UNLOAD_LIST);
    expect(unload.priority_threshold_minutes).toBe(30);
    expect(UNLOAD_FORM.required).toEqual(['unitsGood', 'unitsScrap']);
  });

  it('lists every line queue by order, sender, receiver and recipe', () => {
    for (const name of [ROLE.EDGE_CELL, ROLE.MOUNT_CELL, ROLE.INSPECT_CELL, ROLE.HAND_MOUNT, ROLE.FITTER]) {
      expect(roleOf(name).list_schema).toBe(HANDOFF_LIST);
    }
    expect(HANDOFF_LIST['x-lt-columns'].map((column) => column.label)).toEqual([
      'Order', 'From', 'To', 'Recipe', 'Received by', 'Handed off',
    ]);
  });

  it('charts the floor as one sequence from the printers to the packages', () => {
    const sequence = [
      ROLE.PRINTER_FLEET, ROLE.PRINT_UNLOAD, ROLE.EDGE_CELL, ROLE.MOUNT_CELL,
      ROLE.INSPECT_CELL, ROLE.FITTER, ROLE.PACKAGE,
    ];
    sequence.forEach((name, i) => {
      const entry = roleOf(name);
      expect(entry.ops_visible).toBe(true);
      expect(entry.parent_role).toBe(i ? sequence[i - 1] : undefined);
      expect(entry.sla_minutes).toBeGreaterThan(0);
      expect(entry.target_per_hour).toBeGreaterThan(0);
    });
    expect(roleOf(ROLE.PRINTER_FLEET).ops_home_default).toBe(true);
    expect(roleOf(ROLE.FITTER).upstream_roles).toEqual([ROLE.HAND_MOUNT]);
  });

  it('keys the lens line and the packages by order', () => {
    for (const name of [ROLE.EDGE_CELL, ROLE.MOUNT_CELL, ROLE.INSPECT_CELL, ROLE.HAND_MOUNT, ROLE.FITTER, ROLE.PACKAGE]) {
      expect(roleOf(name).entity_facet).toBe('orderId');
    }
  });

  it('lists every field of its own forms in the order it shows', () => {
    for (const form of [UNLOAD_FORM, BIN_FORM]) {
      expect(form['x-lt-order']).toEqual(Object.keys(form.properties));
    }
  });

  it('keys the printer roles by serial number', () => {
    for (const name of [ROLE.PRINTER_FLEET, ROLE.PRINT_UNLOAD, ROLE.PRINT_SERVICING]) {
      expect(roleOf(name).entity_facet).toBe('serialNumber');
    }
  });

  it('enforces the operator form where a person decides a stopped unit', () => {
    for (const name of [ROLE.PRINT_SERVICING, ROLE.LINE_OPERATOR]) {
      expect(roleOf(name)).toMatchObject({ form_schema: Machines.OPERATOR_FORM_SCHEMA, enforce_schema: true });
    }
  });

  it('gives the printer queue the handoff form', () => {
    expect(roleOf(ROLE.PRINTER_FLEET).form_schema).toBe(Machines.HANDOFF_FORM_SCHEMA);
  });

  it('gives the stations and the hands on the lens line the handoff form', () => {
    for (const name of [ROLE.EDGE_CELL, ROLE.MOUNT_CELL, ROLE.INSPECT_CELL, ROLE.HAND_MOUNT, ROLE.FITTER]) {
      expect(roleOf(name).form_schema).toBe(Machines.HANDOFF_FORM_SCHEMA);
    }
  });

  it('runs the fitters as a kiosk', () => {
    expect(roleOf(ROLE.FITTER).properties).toEqual({ kiosk: true });
  });

  it('gives the line operator a portal that counts every station queue', () => {
    const [portal] = roleOf(ROLE.LINE_OPERATOR).portals ?? [];
    expect(portal.key).toBe('line-1');
    const urls = JSON.stringify(portal);
    for (const name of [ROLE.LINE_OPERATOR, ROLE.EDGE_CELL, ROLE.MOUNT_CELL, ROLE.INSPECT_CELL, ROLE.FITTER]) {
      expect(urls).toContain(`role=${name}`);
    }
  });

  it('gives the bin its form and list, with both ways to ship', () => {
    const bin = roleOf(ROLE.BIN);
    expect(bin.form_schema).toBe(BIN_FORM);
    expect(bin.list_schema).toBe(BIN_LIST);
    expect(BIN_FORM.required).toEqual(['shipVia']);
    expect(BIN_FORM.properties.shipVia['x-lt-options'].map((option) => option.value)).toEqual([SHIP_VIA.PICKUP, SHIP_VIA.COURIER]);
  });

  it('lists the bin roster from the package queue', () => {
    expect(BIN_FORM.properties.packages['x-lt-roster'].expected.query.roles).toEqual([ROLE.PACKAGE]);
  });
});

describe('HUMAN_ROLES', () => {
  it('lists declared roles, once each, and no machine queue', () => {
    expect(new Set(HUMAN_ROLES).size).toBe(HUMAN_ROLES.length);
    for (const name of HUMAN_ROLES) expect(roleOf(name).role).toBe(name);
    for (const name of [ROLE.PRINTER_FLEET, ROLE.EDGE_CELL, ROLE.MOUNT_CELL, ROLE.INSPECT_CELL, ROLE.PACKAGE]) {
      expect(HUMAN_ROLES).not.toContain(name);
    }
  });
});
