import type { LogEvent } from '../modules/constants';

/** One JSON line per event on stdout. */
export function log(event: LogEvent, context: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ event, at: new Date().toISOString(), ...context }));
}
