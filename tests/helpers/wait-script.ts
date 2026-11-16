import type { Mock } from 'vitest';

type Answer = unknown | (() => unknown);

/** Answer each wait of a mocked `conditional` by its key; a key with no answer throws. */
export function scriptWaits(conditional: Mock, answers: Record<string, Answer>): void {
  conditional.mockImplementation(async (key: string) => {
    if (!(key in answers)) throw new Error(`unexpected wait ${key}`);
    const answer = answers[key];
    return typeof answer === 'function' ? answer() : answer;
  });
}

/** The keys waited on, in order. */
export const waitKeys = (conditional: Mock): string[] => conditional.mock.calls.map(([key]) => key as string);

/** The config one wait was opened with. */
export function waitConfig(conditional: Mock, key: string): Record<string, any> {
  const call = conditional.mock.calls.find(([waited]) => waited === key);
  if (!call) throw new Error(`no wait ${key}`);
  return call[1] as Record<string, any>;
}
