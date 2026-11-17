/** A unit a station finished and still holds. */
interface Held { machineId: string; release: (to: string) => Promise<void> }

/** A station with a job for a unit that is still upstream. */
interface Expected { from: string; machineId: string; arrive: () => Promise<void> }

/**
 * The floor between the mock stations of one line: a unit moves when the
 * station holding it has finished it and the station it comes from is the one
 * the next job names.
 */
export class Floor {
  private readonly held = new Map<string, Held>();
  private readonly expected = new Map<string, Expected>();

  /** `machineId` finished the unit and holds it until a receiver takes it. */
  async offer(unitId: string, machineId: string, release: Held['release']): Promise<void> {
    this.held.set(unitId, { machineId, release });
    await this.move(unitId);
  }

  /** `machineId` has a job for the unit and waits for it to come from `from`. */
  async expect(unitId: string, from: string, machineId: string, arrive: Expected['arrive']): Promise<void> {
    this.expected.set(unitId, { from, machineId, arrive });
    await this.move(unitId);
  }

  /** The job that waited for the unit is gone. */
  forget(unitId: string, machineId: string): void {
    if (this.expected.get(unitId)?.machineId === machineId) this.expected.delete(unitId);
  }

  holder(unitId: string): string | undefined {
    return this.held.get(unitId)?.machineId;
  }

  private async move(unitId: string): Promise<void> {
    const held = this.held.get(unitId);
    const expected = this.expected.get(unitId);
    if (!held || !expected || expected.from !== held.machineId) return;
    this.held.delete(unitId);
    this.expected.delete(unitId);
    await held.release(expected.machineId);
    await expected.arrive();
  }
}
