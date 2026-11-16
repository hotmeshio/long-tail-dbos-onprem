import { vi } from 'vitest';

import * as logger from '../../src/lib/logger';
import type { LOG_EVENTS } from '../../src/modules/constants';

type LogEvent = (typeof LOG_EVENTS)[keyof typeof LOG_EVENTS];

/** Silence the logger and record its calls. Restore with vi.restoreAllMocks(). */
export function spyOnLog() {
  const spy = vi.spyOn(logger, 'log').mockImplementation(() => undefined);
  return {
    spy,
    /** The context of every line logged under one event. */
    contexts: (event: LogEvent) => spy.mock.calls.filter(([logged]) => logged === event).map(([, context]) => context),
    events: () => spy.mock.calls.map(([logged]) => logged),
  };
}
