import { randomUUID } from 'node:crypto';

import { Machines, type LineDef, type MachineDef, type MachineIdent, type MachineLink } from '@hotmeshio/long-tail';

import { log } from '../src/lib/logger';
import type { LogEvent } from '../src/modules/constants';

type Command = ReturnType<typeof Machines.parsePayload>;

const { CHANNEL, JOB_EVENT, MODE, OP, QOS, REPLY_STATUS } = Machines;

export const JOB_STATUS = { QUEUED: 'queued', RUNNING: 'running', DONE: 'done' } as const;
const DEFAULT_SOFTWARE = '1.0.0';

export interface MachineSettings {
  topicRoot: string;
  /** How long one job runs. */
  cycleMs: number;
  /** Presence and snapshot on a timer; tests turn it off. */
  heartbeats: boolean;
  /** Orders whose first job on this machine ends in a fault. */
  failOrders?: string[];
}

export interface MachineJob {
  jobId: string;
  orderRef: string;
  recipe: { id: string; version: string };
  units: Array<{ unitId: string; carrierId: string | null }>;
  from: string | null;
  status: typeof JOB_STATUS[keyof typeof JOB_STATUS];
}

export interface Reply {
  status: string;
  reason: string;
  /** Runs once the answer is on the wire. */
  after?: () => Promise<void>;
}

/** The log events one kind of machine reports under. */
export interface MachineEvents { online: LogEvent; queued: LogEvent; done: LogEvent; failed: LogEvent }

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * What every mock machine does on the wire: presence with a will, a retained
 * snapshot, one answer per command id, and job events signed with its identity.
 */
export abstract class MockMachine {
  readonly ident: MachineIdent;
  protected readonly jobs = new Map<string, MachineJob>();
  protected work: Promise<void> = Promise.resolve();
  protected cycles = 0;
  private readonly bootId = randomUUID();
  private sessionId = randomUUID();
  private readonly replied = new Map<string, Reply>();
  private readonly faulted = new Set<string>();
  private commands: Promise<void> = Promise.resolve();
  private beats: NodeJS.Timeout[] = [];

  constructor(
    protected readonly def: MachineDef,
    line: LineDef,
    private readonly link: MachineLink,
    protected readonly settings: MachineSettings,
    protected readonly events: MachineEvents,
  ) {
    this.ident = Machines.identOf(line, def.machineId);
  }

  get machineId(): string {
    return this.def.machineId;
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
    log(this.events.online, { machineId: this.def.machineId, topicRoot: this.settings.topicRoot });
  }

  async stop(): Promise<void> {
    for (const beat of this.beats) clearInterval(beat);
    this.beats = [];
    if (!this.link.connected) return;
    await this.publish(CHANNEL.PRESENCE, { online: false, sessionId: this.sessionId, reason: 'graceful' }, true);
    await this.link.disconnect(true);
  }

  /** Resolves when every command received so far is answered and every started job has run. */
  async idle(): Promise<void> {
    await this.commands;
    await this.work;
  }

  protected abstract dispatch(args: Record<string, any>): Promise<Reply>;

  /** Run one job after the work already queued. */
  protected schedule(job: MachineJob, run: () => Promise<void>): void {
    this.work = this.work.then(run).catch((err) => {
      log(this.events.failed, { jobId: job.jobId, reason: err instanceof Error ? err.message : String(err) });
    });
  }

  /** Whether this job is the one a listed order faults on. Each order faults once. */
  protected faults(job: MachineJob): boolean {
    if (!this.settings.failOrders?.includes(job.orderRef) || this.faulted.has(job.orderRef)) return false;
    this.faulted.add(job.orderRef);
    return true;
  }

  protected openJobs(): MachineJob[] {
    return [...this.jobs.values()].filter((job) => job.status !== JOB_STATUS.DONE);
  }

  protected async cancel(args: Record<string, any>): Promise<Reply> {
    const job = this.jobs.get(args.jobId);
    if (!job || job.status === JOB_STATUS.DONE) return { status: REPLY_STATUS.REFUSED, reason: `no open job ${args.jobId}` };
    this.jobs.delete(job.jobId);
    await this.publishUnits(job, JOB_EVENT.WITHDRAWN);
    await this.publishSnapshot();
    return { status: REPLY_STATUS.ACCEPTED, reason: `withdrew ${job.jobId}` };
  }

  protected async publishUnits(job: MachineJob, event: string, extra: Record<string, unknown> = {}): Promise<void> {
    for (const unit of job.units) await this.publishUnit(job, unit.unitId, event, extra);
  }

  protected publishUnit(job: MachineJob, unitId: string, event: string, extra: Record<string, unknown> = {}): Promise<void> {
    const carrierId = job.units.find((unit) => unit.unitId === unitId)?.carrierId ?? null;
    return this.publish(CHANNEL.JOB, { event, jobId: job.jobId, unitId, orderRef: job.orderRef, recipe: job.recipe, carrierId, ...extra });
  }

  protected publishSnapshot(): Promise<void> {
    const open = this.openJobs();
    return this.publish(CHANNEL.SNAPSHOT, {
      bootId: this.bootId,
      software: this.def.software ?? DEFAULT_SOFTWARE,
      mode: open.some((job) => job.status === JOB_STATUS.RUNNING) ? MODE.RUNNING : MODE.IDLE,
      enabled: true,
      recipe: null,
      jobs: open.map((job) => ({ jobId: job.jobId, units: job.units.map((unit) => unit.unitId), status: job.status })),
      alarms: [],
      cycles: this.cycles,
    }, true);
  }

  private enqueue(envelope: Command): void {
    this.commands = this.commands.then(() => this.handle(envelope)).catch(() => undefined);
  }

  private async handle(envelope: Command): Promise<void> {
    const { cmdId, op, args } = (envelope?.body ?? {}) as { cmdId?: string; op?: string; args?: Record<string, any> };
    if (!cmdId || !op) return;
    const earlier = this.replied.get(cmdId);
    if (earlier) return this.reply(cmdId, { status: earlier.status, reason: `${earlier.reason} (repeat)` });
    const { after, ...answer } = await this.answer(op, args ?? {});
    this.replied.set(cmdId, answer);
    await this.reply(cmdId, answer);
    await after?.();
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

  private async announce(): Promise<void> {
    await this.publishPresence();
    await this.publishSnapshot();
  }

  private publishPresence(): Promise<void> {
    return this.publish(CHANNEL.PRESENCE, { online: true, software: this.def.software ?? DEFAULT_SOFTWARE, sessionId: this.sessionId }, true);
  }

  private reply(cmdId: string, answer: Reply): Promise<void> {
    return this.publish(CHANNEL.REPLY, { cmdId, status: answer.status, reason: answer.reason });
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
