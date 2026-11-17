import { beforeEach, describe, expect, it, vi } from 'vitest';

const users = vi.hoisted(() => ({ listUsers: vi.fn(), createUser: vi.fn() }));
vi.mock('@hotmeshio/long-tail', () => ({ api: { users } }));

import { people, seedPeople } from '../../../src/config/people';
import { ROLE, ROLE_SCOPE, ROLE_TYPE } from '../../../src/modules/constants';

const PASSWORD = 'pw-for-test';

describe('seedPeople', () => {
  beforeEach(() => {
    users.listUsers.mockReset();
    users.createUser.mockReset();
    users.listUsers.mockResolvedValue({ status: 200, data: { users: [] } });
    users.createUser.mockResolvedValue({ status: 201, data: {} });
  });

  it('names a person for every queue a person works', () => {
    const roles = people.flatMap((person) => person.roles);
    expect(roles).toEqual([
      ROLE.PRINT_UNLOAD, ROLE.PRINT_SERVICING, ROLE.LINE_OPERATOR, ROLE.HAND_MOUNT, ROLE.FITTER,
      ROLE.PACKAGE, ROLE.BIN, ROLE.SHIFT_LEAD,
    ]);
    expect(new Set(people.map((person) => person.externalId)).size).toBe(people.length);
  });

  it('creates each missing person as a member of their queues', async () => {
    const created = await seedPeople(PASSWORD);
    expect(created).toEqual(people.map((person) => person.externalId));
    expect(users.createUser).toHaveBeenCalledWith({
      external_id: 'fay-fitter',
      display_name: 'Fay (fitter)',
      password: PASSWORD,
      roles: [{ role: ROLE.FITTER, type: ROLE_TYPE.MEMBER }],
    });
  });

  it('gives the line operator a read-only seat on each lens line queue', async () => {
    await seedPeople(PASSWORD);
    const olive = users.createUser.mock.calls.map(([input]) => input).find((input) => input.external_id === 'olive-operator');
    const watch = (role: string) => ({ role, type: ROLE_TYPE.MEMBER, read_scope: ROLE_SCOPE.ALL, write_scope: ROLE_SCOPE.NONE });
    expect(olive.roles).toEqual([
      { role: ROLE.LINE_OPERATOR, type: ROLE_TYPE.MEMBER },
      watch(ROLE.EDGE_CELL), watch(ROLE.MOUNT_CELL), watch(ROLE.INSPECT_CELL), watch(ROLE.FITTER),
    ]);
  });

  it('creates people without a password when none is set', async () => {
    await seedPeople();
    for (const [input] of users.createUser.mock.calls) expect(input).not.toHaveProperty('password');
  });

  it('leaves a person who already exists', async () => {
    users.listUsers.mockImplementation(async ({ search }: { search: string }) => ({
      status: 200,
      data: { users: search === 'fay-fitter' ? [{ external_id: 'fay-fitter' }] : [] },
    }));
    const created = await seedPeople(PASSWORD);
    expect(created).not.toContain('fay-fitter');
    expect(created).toHaveLength(people.length - 1);
  });

  it('matches the whole id, not a search hit that contains it', async () => {
    users.listUsers.mockResolvedValue({ status: 200, data: { users: [{ external_id: 'fay-fitter-2' }] } });
    expect(await seedPeople(PASSWORD)).toHaveLength(people.length);
  });

  it('skips a person another start created first', async () => {
    users.createUser.mockResolvedValueOnce({ status: 409, error: 'exists' });
    const created = await seedPeople(PASSWORD);
    expect(created).toEqual(people.slice(1).map((person) => person.externalId));
  });

  it('throws when a person cannot be created', async () => {
    users.createUser.mockResolvedValue({ status: 500, error: 'boom' });
    await expect(seedPeople(PASSWORD)).rejects.toThrow('create user uma-unload: boom');
  });

  it('throws when people cannot be listed', async () => {
    users.listUsers.mockResolvedValue({ status: 500, error: 'down' });
    await expect(seedPeople(PASSWORD)).rejects.toThrow('list users: down');
  });
});
