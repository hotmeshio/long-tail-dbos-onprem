import { api } from '@hotmeshio/long-tail';

import { ROLE, ROLE_SCOPE, ROLE_TYPE } from '../modules/constants';

export interface Person { externalId: string; displayName: string; roles: string[]; watches?: string[] }

const LENS_LINE = [ROLE.EDGE_CELL, ROLE.MOUNT_CELL, ROLE.INSPECT_CELL, ROLE.FITTER];

/**
 * A member for every queue a person works, so each queue has someone to sign in as.
 * `watches` are queues the person reads and leaves to others to work.
 */
export const people: Person[] = [
  { externalId: 'uma-unload', displayName: 'Uma (unload)', roles: [ROLE.PRINT_UNLOAD] },
  { externalId: 'sam-servicing', displayName: 'Sam (servicing)', roles: [ROLE.PRINT_SERVICING] },
  { externalId: 'olive-operator', displayName: 'Olive (line operator)', roles: [ROLE.LINE_OPERATOR], watches: LENS_LINE },
  { externalId: 'hank-hand-mount', displayName: 'Hank (hand mount)', roles: [ROLE.HAND_MOUNT] },
  { externalId: 'fay-fitter', displayName: 'Fay (fitter)', roles: [ROLE.FITTER] },
  { externalId: 'pat-packer', displayName: 'Pat (packer)', roles: [ROLE.PACKAGE, ROLE.BIN] },
  { externalId: 'lee-shift-lead', displayName: 'Lee (shift lead)', roles: [ROLE.SHIFT_LEAD] },
];

const CONFLICT = 409;

async function exists(externalId: string): Promise<boolean> {
  const listed = await api.users.listUsers({ search: externalId, limit: 50 });
  if (listed.status >= 400) throw new Error(`list users: ${listed.error ?? listed.status}`);
  const users = (listed.data as { users?: Array<{ external_id?: string }> } | undefined)?.users ?? [];
  return users.some((user) => user.external_id === externalId);
}

/**
 * Create the people who are missing. A person signs in with `password`; with
 * none set the account exists as a member of its queue. Returns the ids created.
 */
export async function seedPeople(password?: string): Promise<string[]> {
  const created: string[] = [];
  for (const person of people) {
    if (await exists(person.externalId)) continue;
    const result = await api.users.createUser({
      external_id: person.externalId,
      display_name: person.displayName,
      ...(password ? { password } : {}),
      roles: [
        ...person.roles.map((role) => ({ role, type: ROLE_TYPE.MEMBER })),
        ...(person.watches ?? []).map((role) => ({
          role,
          type: ROLE_TYPE.MEMBER,
          read_scope: ROLE_SCOPE.ALL,
          write_scope: ROLE_SCOPE.NONE,
        })),
      ],
    });
    if (result.status === CONFLICT) continue;
    if (result.status >= 400) throw new Error(`create user ${person.externalId}: ${result.error ?? result.status}`);
    created.push(person.externalId);
  }
  return created;
}
