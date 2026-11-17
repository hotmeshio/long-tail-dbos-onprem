import { Machines, type LineDef, type MachineDef, type MachineLink } from '@hotmeshio/long-tail';

import { log } from '../src/lib/logger';
import { LOG_EVENTS } from '../src/modules/constants';
import type { Floor } from './floor';
import { JOB_STATUS, MockMachine, sleep, type MachineJob, type MachineSettings, type Reply } from './machine';

const { JOB_EVENT, JOB_RESULT, REPLY_STATUS } = Machines;

export type StationSettings = MachineSettings;

/**
 * A line station that speaks the machine protocol and works on nothing: it
 * takes a dispatched job, runs it when the unit arrives, reports the result,
 * and holds a good unit until the next station takes it.
 */
export class MockStation extends MockMachine {
  constructor(def: MachineDef, line: LineDef, link: MachineLink, settings: StationSettings, private readonly floor: Floor) {
    super(def, line, link, settings, {
      online: LOG_EVENTS.STATION_ONLINE,
      queued: LOG_EVENTS.STATION_JOB_QUEUED,
      done: LOG_EVENTS.STATION_JOB_DONE,
      failed: LOG_EVENTS.STATION_JOB_FAILED,
    });
  }

  protected async dispatch(args: Record<string, any>): Promise<Reply> {
    const { jobId, orderRef, recipe, units } = args;
    if (!jobId || !recipe?.id || !Array.isArray(units) || !units.length) {
      return { status: REPLY_STATUS.REFUSED, reason: 'missing jobId, recipe or units' };
    }
    if (this.jobs.has(jobId)) return { status: REPLY_STATUS.ACCEPTED, reason: 'job already queued' };
    if (!this.def.recipes[recipe.id]?.includes(recipe.version)) {
      return { status: REPLY_STATUS.REFUSED, reason: `recipe ${recipe.id} v${recipe.version} is not held` };
    }
    const job: MachineJob = { jobId, orderRef, recipe, units, from: args.from ?? null, status: JOB_STATUS.QUEUED };
    this.jobs.set(jobId, job);
    await this.publishUnits(job, JOB_EVENT.QUEUED);
    await this.publishSnapshot();
    log(LOG_EVENTS.STATION_JOB_QUEUED, { machineId: this.machineId, jobId, units: units.length });
    return { status: REPLY_STATUS.ACCEPTED, reason: `queued ${jobId}`, after: () => this.awaitUnits(job) };
  }

  protected async cancel(args: Record<string, any>): Promise<Reply> {
    const job = this.jobs.get(args.jobId);
    if (job) for (const unit of job.units) this.floor.forget(unit.unitId, this.machineId);
    return super.cancel(args);
  }

  /** A unit entering the line is here already; one from another station comes when that station lets it go. */
  private async awaitUnits(job: MachineJob): Promise<void> {
    const from = job.from;
    if (from === null) return this.arrive(job);
    let waiting = job.units.length;
    for (const unit of job.units) {
      await this.floor.expect(unit.unitId, from, this.machineId, async () => {
        waiting -= 1;
        if (!waiting) await this.arrive(job);
      });
    }
  }

  private async arrive(job: MachineJob): Promise<void> {
    if (!this.jobs.has(job.jobId)) return;
    await this.publishUnits(job, JOB_EVENT.ARRIVED, { peer: job.from });
    this.schedule(job, () => this.run(job));
  }

  private async run(job: MachineJob): Promise<void> {
    if (!this.jobs.has(job.jobId)) return;
    job.status = JOB_STATUS.RUNNING;
    const startedAt = new Date();
    await this.publishUnits(job, JOB_EVENT.STARTED);
    await this.publishSnapshot();
    await sleep(this.settings.cycleMs);
    if (!this.jobs.has(job.jobId)) return;

    job.status = JOB_STATUS.DONE;
    const rejected = this.faults(job);
    const endedAt = new Date();
    await this.publishUnits(job, JOB_EVENT.FINISHED, {
      result: rejected ? JOB_RESULT.REJECT : JOB_RESULT.OK,
      reason: rejected ? this.def.rejectReason : null,
      measurements: [],
      materials: [],
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationMs: endedAt.getTime() - startedAt.getTime(),
    });
    if (!rejected) this.cycles += job.units.length;
    await this.publishSnapshot();
    if (rejected) {
      log(LOG_EVENTS.STATION_JOB_FAILED, { machineId: this.machineId, jobId: job.jobId, reason: this.def.rejectReason });
      return;
    }
    log(LOG_EVENTS.STATION_JOB_DONE, { machineId: this.machineId, jobId: job.jobId, units: job.units.length });
    for (const unit of job.units) {
      await this.floor.offer(unit.unitId, this.machineId, (to) => this.publishUnit(job, unit.unitId, JOB_EVENT.RELEASED, { peer: to }));
    }
  }
}
