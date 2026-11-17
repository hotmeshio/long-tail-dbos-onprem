import { createHash } from 'node:crypto';

import { Machines, type LineDef, type MachineDef, type MachineLink } from '@hotmeshio/long-tail';

import { log } from '../src/lib/logger';
import { LOG_EVENTS } from '../src/modules/constants';
import { JOB_STATUS, MockMachine, sleep, type MachineJob, type MachineSettings, type Reply } from './machine';

const { JOB_EVENT, REPLY_STATUS, TRANSFER_FAILURE } = Machines;

const ARTIFACT_TIMEOUT_MS = 5_000;
const PROGRESS_STEPS = 4;

export type PrinterSettings = MachineSettings;

/**
 * A printer that speaks the machine protocol and prints nothing: it takes a
 * dispatched job, checks the file it was pointed at, reports progress, and
 * reports each unit arrived when the job is done.
 */
export class MockPrinter extends MockMachine {
  constructor(def: MachineDef, line: LineDef, link: MachineLink, settings: PrinterSettings) {
    super(def, line, link, settings, {
      online: LOG_EVENTS.PRINTER_ONLINE,
      queued: LOG_EVENTS.PRINTER_JOB_QUEUED,
      done: LOG_EVENTS.PRINTER_JOB_DONE,
      failed: LOG_EVENTS.PRINTER_JOB_FAILED,
    });
  }

  protected async dispatch(args: Record<string, any>): Promise<Reply> {
    const { jobId, orderRef, recipe, units, artifact } = args;
    if (!jobId || !recipe?.id || !Array.isArray(units) || !units.length) {
      return { status: REPLY_STATUS.REFUSED, reason: 'missing jobId, recipe or units' };
    }
    if (this.jobs.has(jobId)) return { status: REPLY_STATUS.ACCEPTED, reason: 'job already queued' };
    if (!artifact?.url || !artifact?.sha256) return { status: REPLY_STATUS.REFUSED, reason: 'missing artifact' };
    const problem = await this.checkArtifact(artifact);
    if (problem) {
      log(LOG_EVENTS.PRINTER_JOB_FAILED, { jobId, reason: problem });
      return { status: REPLY_STATUS.FAILED, reason: problem };
    }
    const job: MachineJob = { jobId, orderRef, recipe, units, from: args.from ?? null, status: JOB_STATUS.QUEUED };
    this.jobs.set(jobId, job);
    await this.publishUnits(job, JOB_EVENT.QUEUED);
    await this.publishSnapshot();
    log(LOG_EVENTS.PRINTER_JOB_QUEUED, { jobId, units: units.length });
    this.schedule(job, () => this.print(job));
    return { status: REPLY_STATUS.ACCEPTED, reason: `queued ${jobId}` };
  }

  /** The file is fetched and hashed before the job is accepted. Returns what is wrong with it, or null. */
  private async checkArtifact(artifact: { url: string; sha256: string }): Promise<string | null> {
    try {
      const response = await fetch(artifact.url, { signal: AbortSignal.timeout(ARTIFACT_TIMEOUT_MS) });
      if (!response.ok) return `artifact fetch ${response.status}`;
      const sha256 = createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex');
      return sha256 === artifact.sha256 ? null : 'artifact checksum mismatch';
    } catch (err) {
      return `artifact fetch failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  private async print(job: MachineJob): Promise<void> {
    if (!this.jobs.has(job.jobId)) return;
    job.status = JOB_STATUS.RUNNING;
    await this.publishUnits(job, JOB_EVENT.STARTED);
    await this.publishSnapshot();
    for (let step = 1; step <= PROGRESS_STEPS; step++) {
      await sleep(this.settings.cycleMs / PROGRESS_STEPS);
      if (!this.jobs.has(job.jobId)) return;
      if (step < PROGRESS_STEPS) await this.publishUnits(job, JOB_EVENT.PROGRESS, { percent: Math.round((step / PROGRESS_STEPS) * 100) });
    }
    job.status = JOB_STATUS.DONE;
    if (this.faults(job)) {
      await this.publishUnits(job, JOB_EVENT.TRANSFER_FAILED, { failure: TRANSFER_FAILURE.JAM });
      await this.publishSnapshot();
      log(LOG_EVENTS.PRINTER_JOB_FAILED, { jobId: job.jobId, reason: TRANSFER_FAILURE.JAM });
      return;
    }
    this.cycles += job.units.length;
    await this.publishUnits(job, JOB_EVENT.ARRIVED, { peer: job.from });
    await this.publishSnapshot();
    log(LOG_EVENTS.PRINTER_JOB_DONE, { jobId: job.jobId, units: job.units.length });
  }
}
