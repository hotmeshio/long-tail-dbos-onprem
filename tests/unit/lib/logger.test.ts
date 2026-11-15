import { afterEach, describe, expect, it, vi } from 'vitest';

import { log } from '../../../src/lib/logger';
import { LOG_EVENTS } from '../../../src/modules/constants';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('log', () => {
  it('writes one JSON line with the event, the time and the context', () => {
    vi.useFakeTimers({ now: new Date('2030-01-01T00:00:00.000Z') });
    const out = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    log(LOG_EVENTS.INTAKE_CLAIMED, { count: 2 });
    expect(out).toHaveBeenCalledTimes(1);
    expect(JSON.parse(out.mock.calls[0][0] as string)).toEqual({ event: LOG_EVENTS.INTAKE_CLAIMED, at: '2030-01-01T00:00:00.000Z', count: 2 });
  });

  it('writes the event alone when no context is given', () => {
    const out = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    log(LOG_EVENTS.SITE_STARTED);
    const line = JSON.parse(out.mock.calls[0][0] as string);
    expect(Object.keys(line)).toEqual(['event', 'at']);
    expect(line.event).toBe(LOG_EVENTS.SITE_STARTED);
  });

  it('writes a single line', () => {
    const out = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    log(LOG_EVENTS.INTAKE_FAILED, { error: 'first\nsecond' });
    expect(out.mock.calls[0][0]).not.toContain('\n');
  });
});
