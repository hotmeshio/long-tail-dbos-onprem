import type { LTRoleConfig } from '@hotmeshio/long-tail';

import { ROLE } from '../modules/constants';

/** The people on the floor. The printer's own role comes from the line file. */
export const roles: LTRoleConfig[] = [
  {
    role: ROLE.INSPECTOR,
    title: 'Floor inspector',
    description: 'Checks finished units before the site reports an order',
    form_schema: {
      type: 'object',
      properties: {
        passed: { type: 'boolean', title: 'Order passes inspection', default: true },
        units: { type: 'integer', title: 'Good units', minimum: 0 },
        notes: { type: 'string', title: 'Notes' },
      },
      required: ['passed', 'units'],
    },
  },
  {
    role: ROLE.LEAD,
    title: 'Floor lead',
    description: 'Decides failed prints and orders the cloud stopped waiting for',
    form_schema: {
      type: 'object',
      properties: {
        retry: { type: 'boolean', title: 'Print again', default: true },
        notes: { type: 'string', title: 'Notes' },
      },
    },
  },
];
