import { Machines, type LTRoleConfig } from '@hotmeshio/long-tail';

import { ROLE, SHIP_VIA } from '../modules/constants';

const ENTITY = { FACET: 'serialNumber', BY_SUBTYPE: 'subtype', BY_ROLE: 'role' } as const;
const ORDER = { entity_facet: 'orderId', entity_state_source: ENTITY.BY_ROLE } as const;

/** One step of the floor sequence on the Pace Board: its prior step and its targets. */
const step = (after: string | null, slaMinutes: number, perHour: number, workers = 1) => ({
  ops_visible: true,
  ...(after ? { parent_role: after } : {}),
  sla_minutes: slaMinutes,
  target_per_hour: perHour,
  worker_count: workers,
  priority_threshold_minutes: slaMinutes,
});

export const UNLOAD_FORM = {
  title: 'Unload the frame',
  required: ['unitsGood', 'unitsScrap'],
  'x-lt-order': ['serialNumber', 'orderId', 'jobId', 'unitsGood', 'unitsScrap', 'note'],
  properties: {
    serialNumber: { type: 'string', title: 'Printer', readOnly: true },
    orderId: { type: 'string', title: 'Order', readOnly: true },
    jobId: { type: 'string', title: 'Job', readOnly: true },
    unitsGood: { type: 'integer', title: 'Good parts', minimum: 0 },
    unitsScrap: { type: 'integer', title: 'Scrapped parts', minimum: 0 },
    note: { type: 'string', format: 'textarea', title: 'Note' },
  },
};

export const UNLOAD_LIST = {
  'x-lt-layout': 'facet-table',
  'x-lt-columns': [
    { label: 'Printer', value: '{{metadata.serialNumber}}', priority: 1 },
    { label: 'Model', value: '{{metadata.model}}', priority: 2 },
    { label: 'Order', value: '{{metadata.orderId}}', priority: 1 },
    { label: 'Job', value: '{{metadata.jobId}}', priority: 2 },
    { label: 'Waiting', value: '{{escalation.created_at}}', format: 'age' },
  ],
};

export const BIN_FORM = {
  title: 'Ship this bin now',
  required: ['shipVia'],
  'x-lt-submit-guard': { roster: 'packages', message: '{{count}} packages are still unaccounted for' },
  'x-lt-order': ['binKey', 'destination', 'packages', 'shipVia', 'note'],
  properties: {
    binKey: { type: 'string', title: 'Bin', readOnly: true },
    destination: { type: 'string', title: 'Destination', readOnly: true },
    packages: {
      type: 'string',
      readOnly: true,
      title: 'Boxed orders for this bin',
      'x-lt-widget': 'roster',
      'x-lt-roster': {
        expected: { query: { roles: [ROLE.PACKAGE], facets: { binKey: '{{metadata.binKey}}' } } },
        key: '{{metadata.orderId}}',
        in: ['items'],
        flagged: [{ when: 'resolver.outcome=missing', label: 'Missing' }],
      },
      'x-lt-columns': [{ label: 'Order', value: '{{metadata.orderId}}' }],
      'x-lt-actions': [
        {
          label: 'Missing',
          when: 'waiting',
          resolverPayload: { outcome: 'missing' },
          roles: [ROLE.SHIFT_LEAD],
          refuse: "A shift lead's badge is needed to mark a package missing.",
          confirm: 'Mark {{metadata.orderId}} missing?',
        },
      ],
    },
    shipVia: {
      type: 'string',
      title: 'Ship via',
      'x-lt-options': [
        { value: SHIP_VIA.PICKUP, label: 'Scheduled pickup' },
        { value: SHIP_VIA.COURIER, label: 'Courier' },
      ],
    },
    note: { type: 'string', format: 'textarea', title: 'Note' },
  },
};

export const BIN_LIST = {
  'x-lt-layout': 'facet-table',
  'x-lt-columns': [
    { label: 'Bin', value: '{{metadata.binKey}}', priority: 1 },
    { label: 'Destination', value: '{{metadata.destination}}', priority: 2 },
    { label: 'Packages', value: '{{metadata.accumulate_count}} of {{metadata.accumulate_max}}', priority: 2 },
    { label: 'Opened', value: '{{escalation.created_at}}', format: 'age' },
  ],
};

export const HANDOFF_LIST = {
  'x-lt-layout': 'facet-table',
  'x-lt-columns': [
    { label: 'Order', value: '{{metadata.orderId}}', priority: 1 },
    { label: 'From', value: '{{metadata.fromMachine}}', priority: 1 },
    { label: 'To', value: '{{metadata.toMachine}}', priority: 2 },
    { label: 'Recipe', value: '{{metadata.recipeId}}', priority: 2 },
    { label: 'Received by', value: '{{escalation.assigned_to}}', format: 'user', priority: 2 },
    { label: 'Handed off', value: '{{escalation.created_at}}', format: 'age' },
  ],
};

const waiting = (label: string, role: string) => ({
  label,
  url: `/escalations/available?role=${role}&view=table&layout=compact`,
  badge: true,
});

const printRoles: LTRoleConfig[] = [
  {
    role: ROLE.PRINTER_FLEET,
    title: 'Printer fleet',
    form_schema: Machines.HANDOFF_FORM_SCHEMA,
    entity_facet: ENTITY.FACET,
    entity_state_source: ENTITY.BY_SUBTYPE,
    ops_home_default: true,
    ...step(null, 45, 4),
  },
  {
    role: ROLE.PRINT_UNLOAD,
    title: 'Unload',
    form_schema: UNLOAD_FORM,
    list_schema: UNLOAD_LIST,
    entity_facet: ENTITY.FACET,
    entity_state_source: ENTITY.BY_ROLE,
    ...step(ROLE.PRINTER_FLEET, 30, 12),
  },
  {
    role: ROLE.PRINT_SERVICING,
    title: 'Servicing',
    form_schema: Machines.OPERATOR_FORM_SCHEMA,
    enforce_schema: true,
    entity_facet: ENTITY.FACET,
    entity_state_source: ENTITY.BY_ROLE,
  },
];

const lensRoles: LTRoleConfig[] = [
  { role: ROLE.EDGE_CELL, title: 'Edger', form_schema: Machines.HANDOFF_FORM_SCHEMA, list_schema: HANDOFF_LIST, ...ORDER, ...step(ROLE.PRINT_UNLOAD, 10, 30) },
  { role: ROLE.MOUNT_CELL, title: 'Mounting press', form_schema: Machines.HANDOFF_FORM_SCHEMA, list_schema: HANDOFF_LIST, ...ORDER, ...step(ROLE.EDGE_CELL, 10, 30) },
  { role: ROLE.INSPECT_CELL, title: 'Inspection camera', form_schema: Machines.HANDOFF_FORM_SCHEMA, list_schema: HANDOFF_LIST, ...ORDER, ...step(ROLE.MOUNT_CELL, 10, 30) },
  { role: ROLE.HAND_MOUNT, title: 'Hand mount', form_schema: Machines.HANDOFF_FORM_SCHEMA, list_schema: HANDOFF_LIST, ...ORDER },
  {
    role: ROLE.FITTER,
    title: 'Fitters',
    form_schema: Machines.HANDOFF_FORM_SCHEMA,
    list_schema: HANDOFF_LIST,
    properties: { kiosk: true },
    ...ORDER,
    ...step(ROLE.INSPECT_CELL, 20, 20, 2),
    upstream_roles: [ROLE.HAND_MOUNT],
  },
  {
    role: ROLE.LINE_OPERATOR,
    title: 'Line operator',
    form_schema: Machines.OPERATOR_FORM_SCHEMA,
    enforce_schema: true,
    portals: [
      {
        key: 'line-1',
        label: 'Lens line 1',
        counts: [
          { label: 'Decisions', url: `/escalations/available?role=${ROLE.LINE_OPERATOR}`, blurb: 'Stopped units, alarms, dark machines' },
        ],
        rows: [
          [
            waiting('Waiting at the edger', ROLE.EDGE_CELL),
            waiting('Waiting at the press', ROLE.MOUNT_CELL),
            waiting('Waiting at the camera', ROLE.INSPECT_CELL),
          ],
          [waiting('Waiting at fitting', ROLE.FITTER)],
        ],
      },
    ],
  },
];

const packRoles: LTRoleConfig[] = [
  {
    role: ROLE.BIN,
    title: 'Bins',
    form_schema: BIN_FORM,
    list_schema: BIN_LIST,
    properties: { badge_grant: { ttl_seconds: 600, max_uses: 0 } },
  },
  { role: ROLE.PACKAGE, title: 'Packages', ...ORDER, ...step(ROLE.FITTER, 30, 20) },
  { role: ROLE.SHIFT_LEAD, title: 'Shift leads' },
];

/** Every queue on the site. Each role owns the form and the list its rows show. */
export const roles: LTRoleConfig[] = [...printRoles, ...lensRoles, ...packRoles];

/** The roles a person works, one demo member each. */
export const HUMAN_ROLES: string[] = [
  ROLE.PRINT_UNLOAD,
  ROLE.PRINT_SERVICING,
  ROLE.LINE_OPERATOR,
  ROLE.HAND_MOUNT,
  ROLE.FITTER,
  ROLE.BIN,
  ROLE.SHIFT_LEAD,
];
