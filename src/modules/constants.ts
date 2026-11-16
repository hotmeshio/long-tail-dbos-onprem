// Plain values only: workflows, services and tests all import from here.

export const ROLE = {
  /** People who check finished parts. */
  INSPECTOR: 'floor-inspector',
  /** People who decide a failed print or an order the cloud stopped waiting for. */
  LEAD: 'floor-lead',
} as const;

export const ROLE_TYPE = { MEMBER: 'member', SUPERADMIN: 'superadmin' } as const;

export const ESCALATION_TYPE = {
  INSPECTION: 'inspection',
  PRINT_FAILED: 'print-failed',
  REPORT_CLOSED: 'report-closed',
} as const;

export const ESCALATION_STATUS = {
  PENDING: 'pending',
  RESOLVED: 'resolved',
  EXPIRED: 'expired',
  CANCELLED: 'cancelled',
} as const;

/** How the files of a cloud order are named in `files[].as`. */
export const ASSET = { MODEL: 'model', TICKET: 'ticket' } as const;

export const BOT = {
  /** Opens the waits the site's workflows park on. */
  WORKFLOWS: 'dbos-workflows',
  /** Prefix of the account this site holds on the cloud; the site id follows. */
  SITE_PREFIX: 'fabrication',
} as const;

export const WORKFLOW = { FABRICATE: 'fabricate' } as const;
export const TASK_QUEUE = 'fabrication';

/** How one attempt to report an outcome to the cloud ended. */
export const REPORT_STATE = {
  RESOLVED: 'resolved',
  /** The cloud row ended some other way: expired, cancelled or resolved by someone else. */
  CLOSED: 'closed',
  /** The cloud refused the report; trying again will not change the answer. */
  REFUSED: 'refused',
  UNREACHABLE: 'unreachable',
} as const;
export type ReportState = typeof REPORT_STATE[keyof typeof REPORT_STATE];

export const FABRICATE_STATUS = {
  REPORTED: 'reported',
  CLOSED: 'closed',
} as const;
export type FabricateStatus = typeof FABRICATE_STATUS[keyof typeof FABRICATE_STATUS];

export const PRINT_ERROR = { CANCELLED: 'cancelled', TIMEOUT: 'handoff-timeout', UNKNOWN: 'unknown' } as const;

export const inspectionKey = (escalationId: string) => `inspect-${escalationId}`;
export const printFailedKey = (escalationId: string, attempt: number) => `print-failed-${escalationId}-${attempt}`;
export const reportClosedKey = (escalationId: string) => `report-closed-${escalationId}`;

export const LOG_EVENTS = {
  SITE_STARTED: 'site.started',
  SITE_STOPPED: 'site.stopped',
  DBOS_LAUNCHED: 'site.dbos.launched',
  ASSETS_SERVING: 'site.assets.serving',
  INTAKE_STARTED: 'site.intake.started',
  INTAKE_CLAIMED: 'site.intake.claimed',
  INTAKE_ORDER_STARTED: 'site.intake.order_started',
  INTAKE_ORDER_SKIPPED: 'site.intake.order_skipped',
  INTAKE_CLOUD_UNREACHABLE: 'site.intake.cloud_unreachable',
  INTAKE_FAILED: 'site.intake.failed',
  REPORT_UNREACHABLE: 'site.report.unreachable',
  REPORT_SETTLED: 'site.report.settled',
  SHUTDOWN_ERROR: 'site.shutdown.error',
  FATAL: 'site.fatal',
  PRINTER_ONLINE: 'printer.online',
  PRINTER_JOB_QUEUED: 'printer.job.queued',
  PRINTER_JOB_DONE: 'printer.job.done',
  PRINTER_JOB_FAILED: 'printer.job.failed',
} as const;
export type LogEvent = typeof LOG_EVENTS[keyof typeof LOG_EVENTS];
