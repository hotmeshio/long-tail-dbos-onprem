import { createHash, randomUUID } from 'node:crypto';

import { Machines, type LineDef, type MachineDef, type MachineIdent, type MachineLink } from '@hotmeshio/long-tail';

import { log } from '../src/lib/logger';
import { LOG_EVENTS } from '../src/modules/constants';

type Command = ReturnType<typeof Machines.parsePayload>;

const { CHANNEL, JOB_EVENT, MODE, OP, QOS, REPLY_STATUS } = Machines;

const JOB_STATUS = { QUEUED: 'queued', RUNNING: 'running', DONE: 'done' } as const;
const ARTIFACT_TIMEOUT_MS = 5_000;
const PROGRESS_STEPS = 4;

export interface PrinterSettings {
  topicRoot: string;
  /** How long one job prints. */
  printMs: number;
  /** Presence and snapshot on a timer; tests turn it off. */
  heartbeats: boolean;
}

interface PrintJob {
  jobId: string;
  orderRef: string;
  recipe: { id: string; version: string };
  units: Array<{ unitId: string; carrierId: string | null }>;
  from: string | null;
  status: typeof JOB_STATUS[keyof typeof JOB_STATUS];
}

interface Reply { status: string; reason: string }

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * A printer that speaks the machine protocol and prints nothing: it takes a
 * dispatched job, checks the file it was pointed at, reports progress, and
 * reports each unit arrived when the job is done.
 */
export class MockPrinter {
  readonly ident: MachineIdent;
  private readonly bootId = randomUUID();
  private sessionId = randomUUID();
  private readonly jobs = new Map<string, PrintJob>();
  private readonly replied = new Map<string, Reply>();
  private commands: Promise<void> = Promise.resolve();
  private printing: Promise<void> = Promise.resolve();
  private beats: NodeJS.Timeout[] = [];
  private cycles = 0;

  constructor(
    private readonly def: MachineDef,
    line: LineDef,
    private readonly link: MachineLink,
    private readonly settings: PrinterSettings,
  ) {
    this.ident = Machines.identOf(line, def.machineId);
  }

  async start(): Promise<void> {
    // 1. Connect with a will, so a lost link reads as offline
    this.sessionId = randomUUID();
    const will = { topic: this.topic(CHANNEL.PRESENCE), payload: this.wrap({ online: false, sessionId: this.sessionId }), retain: true };
    await this.link.connect({ clientId: Machines.clientIdOf(this.ident), will, onRestored: () => void this.announce() });

    // 2. Take commands
    await this.link.subscribe(this.topic(CHANNEL.CMD), (msg) => this.enqueue(Machines.parsePayload(msg.payload)));

    // 3. Say what this machine is and holds
    await this.announce();
    if (this.settings.heartbeats) {
      this.beats.push(setInterval(() => void this.publishPresence(), Machines.PRESENCE_HEARTBEAT_SEC * 1000));
      this.beats.push(setInterval(() => void this.publishSnapshot(), Machines.SNAPSHOT_HEARTBEAT_SEC * 1000));
    }
    log(LOG_EVENTS.PRINTER_ONLINE, { machineId: this.def.machineId, topicRoot: this.settings.topicRoot });
  }

  async stop(): Promise<void> {
    for (const beat of this.beats) clearInterval(beat);
    this.beats = [];
    if (!this.link.connected) return;
    await this.publish(CHANNEL.PRESENCE, { online: false, sessionId: this.sessionId, reason: 'graceful' }, true);
    await this.link.disconnect(true);
  }

  /** Resolves when every command received so far is answered and every accepted job is printed. */
  async idle(): Promise<void> {
    await this.commands;
    await this.printing;
  }

  private enqueue(envelope: Command): void {
    this.commands = this.commands.then(() => this.handle(envelope)).catch(() => undefined);
  }

  private async handle(envelope: Command): Promise<void> {
    const { cmdId, op, args } = (envelope?.body ?? {}) as { cmdId?: string; op?: string; args?: Record<string, any> };
    if (!cmdId || !op) return;
    const earlier = this.replied.get(cmdId);
    if (earlier) return this.reply(cmdId, { status: earlier.status, reason: `${earlier.reason} (repeat)` });
    const answer = await this.answer(op, args ?? {});
    this.replied.set(cmdId, answer);
    await this.reply(cmdId, answer);
  }

  private async answer(op: string, args: Record<string, any>): Promise<Reply> {
    if (args.expiresAt && Date.parse(args.expiresAt) < Date.now()) return { status: REPLY_STATUS.REFUSED, reason: `expired at ${args.expiresAt}` };
    if (op === OP.DISPATCH) return this.dispatch(args);
    if (op === OP.CANCEL) return this.cancel(args);
    if (op === OP.SNAPSHOT) {
      await this.publishSnapshot();
      return { status: REPLY_STATUS.ACCEPTED, reason: 'snapshot published' };
    }
    return { status: REPLY_STATUS.REFUSED, reason: `unknown op ${op}` };
  }

  private async dispatch(args: Record<string, any>): Promise<Reply> {
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
    const job: PrintJob = { jobId, orderRef, recipe, units, from: args.from ?? null, status: JOB_STATUS.QUEUED };
    this.jobs.set(jobId, job);
    await this.publishUnits(job, JOB_EVENT.QUEUED);
    await this.publishSnapshot();
    log(LOG_EVENTS.PRINTER_JOB_QUEUED, { jobId, units: units.length });
    this.printing = this.printing.then(() => this.print(job)).catch((err) => {
      log(LOG_EVENTS.PRINTER_JOB_FAILED, { jobId, reason: err instanceof Error ? err.message : String(err) });
    });
    return { status: REPLY_STATUS.ACCEPTED, reason: `queued ${jobId}` };
  }

  private async cancel(args: Record<string, any>): Promise<Reply> {
    const job = this.jobs.get(args.jobId);
    if (!job || job.status === JOB_STATUS.DONE) return { status: REPLY_STATUS.REFUSED, reason: `no open job ${args.jobId}` };
    this.jobs.delete(job.jobId);
    await this.publishUnits(job, JOB_EVENT.WITHDRAWN);
    await this.publishSnapshot();
    return { status: REPLY_STATUS.ACCEPTED, reason: `withdrew ${job.jobId}` };
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

  private async print(job: PrintJob): Promise<void> {
    if (!this.jobs.has(job.jobId)) return;
    job.status = JOB_STATUS.RUNNING;
    await this.publishUnits(job, JOB_EVENT.STARTED);
    await this.publishSnapshot();
    for (let step = 1; step <= PROGRESS_STEPS; step++) {
      await sleep(this.settings.printMs / PROGRESS_STEPS);
      if (!this.jobs.has(job.jobId)) return;
      if (step < PROGRESS_STEPS) await this.publishUnits(job, JOB_EVENT.PROGRESS, { percent: Math.round((step / PROGRESS_STEPS) * 100) });
    }
    job.status = JOB_STATUS.DONE;
    this.cycles += job.units.length;
    await this.publishUnits(job, JOB_EVENT.ARRIVED, { peer: job.from });
    await this.publishSnapshot();
    log(LOG_EVENTS.PRINTER_JOB_DONE, { jobId: job.jobId, units: job.units.length });
  }

  private async publishUnits(job: PrintJob, event: string, extra: Record<string, unknown> = {}): Promise<void> {
    for (const unit of job.units) {
      await this.publish(CHANNEL.JOB, {
        event, jobId: job.jobId, unitId: unit.unitId, orderRef: job.orderRef, recipe: job.recipe, carrierId: unit.carrierId, ...extra,
      });
    }
  }

  private async announce(): Promise<void> {
    await this.publishPresence();
    await this.publishSnapshot();
  }

  private publishPresence(): Promise<void> {
    return this.publish(CHANNEL.PRESENCE, { online: true, software: this.def.software ?? '1.0.0', sessionId: this.sessionId }, true);
  }

  private publishSnapshot(): Promise<void> {
    const open = [...this.jobs.values()].filter((job) => job.status !== JOB_STATUS.DONE);
    return this.publish(CHANNEL.SNAPSHOT, {
      bootId: this.bootId,
      software: this.def.software ?? '1.0.0',
      mode: open.some((job) => job.status === JOB_STATUS.RUNNING) ? MODE.RUNNING : MODE.IDLE,
      enabled: true,
      recipe: null,
      jobs: open.map((job) => ({ jobId: job.jobId, units: job.units.map((unit) => unit.unitId), status: job.status })),
      alarms: [],
      cycles: this.cycles,
    }, true);
  }

  private reply(cmdId: string, answer: Reply): Promise<void> {
    return this.publish(CHANNEL.REPLY, { cmdId, ...answer });
  }

  private async publish(channel: string, body: Record<string, unknown>, retain = false): Promise<void> {
    if (!this.link.connected) return;
    await this.link.publish(this.topic(channel), this.wrap(body), { qos: QOS.RELIABLE, retain });
  }

  private topic(channel: string): string {
    return Machines.machineTopic(this.settings.topicRoot, this.ident, channel);
  }

  private wrap(body: Record<string, unknown>): string {
    return JSON.stringify(Machines.buildEnvelope(this.ident, body));
  }
}
