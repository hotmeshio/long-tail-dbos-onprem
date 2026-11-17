// Plain values only: workflows, services and tests all import from here.

export const ROLE = {
  /** The printers. A frame waiting for a printer, or printing, is a row here. */
  PRINTER_FLEET: 'printer-fleet',
  /** People who take a printed frame off its printer. */
  PRINT_UNLOAD: 'print-unload',
  /** People who decide a print that stopped. */
  PRINT_SERVICING: 'print-servicing',
  EDGE_CELL: 'edge-cell',
  MOUNT_CELL: 'mount-cell',
  INSPECT_CELL: 'inspect-cell',
  /** People who decide a unit that stopped on the lens line. */
  LINE_OPERATOR: 'line-operator',
  /** People who mount lenses by hand when the press cannot. */
  HAND_MOUNT: 'hand-mount',
  /** People who do the final fit. */
  FITTER: 'fitter',
  /** One boxed order waiting to be scanned into a bin. */
  PACKAGE: 'package',
  /** One open bin per destination. */
  BIN: 'bin',
  /** People who decide an order the cloud stopped waiting for, and who ship a bin early. */
  SHIFT_LEAD: 'shift-lead',
} as const;

/** The cloud queue this site claims its orders from. */
export const CLOUD_ROLE = { PRODUCTION: 'production' } as const;

export const ROLE_TYPE = { SUPERADMIN: 'superadmin', MEMBER: 'member' } as const;
export const ROLE_SCOPE = { ALL: 'all', NONE: 'none' } as const;

export const ESCALATION_TYPE = {
  ROLLUP: 'rollup',
  REPORT_CLOSED: 'report-closed',
} as const;

export const ESCALATION_SUBTYPE = {
  PRINTING: 'printing',
  UNLOAD: 'unload',
  EXIT: 'exit',
  BIN: 'bin',
  PACKAGE: 'package',
} as const;

export const ESCALATION_STATUS = {
  PENDING: 'pending',
  RESOLVED: 'resolved',
  EXPIRED: 'expired',
  CANCELLED: 'cancelled',
} as const;

/** How the files of a cloud order are named in `files[].as`. */
export const ASSET = { FRAME: 'frame', PRESCRIPTION: 'prescription' } as const;
export type AssetAlias = typeof ASSET[keyof typeof ASSET];

export const BOT = {
  /** Opens the waits the site's workflows park on. */
  WORKFLOWS: 'dbos-workflows',
} as const;

export const WORKFLOW = { MAKE_GLASSES: 'makeGlasses', ROLLUP_BIN: 'rollupBin' } as const;
export const TASK_QUEUE = 'production';

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

export const ORDER_STATUS = {
  REPORTED: 'reported',
  CLOSED: 'closed',
} as const;
export type OrderStatus = typeof ORDER_STATUS[keyof typeof ORDER_STATUS];

/** How a unit's trip along a line ended. */
export const ROUTE_STATUS = { COMPLETE: 'complete', SCRAPPED: 'scrapped', REFUSED: 'refused' } as const;
export type RouteStatus = typeof ROUTE_STATUS[keyof typeof ROUTE_STATUS];

/** What ended an accumulating wait. */
export const TRIGGER = { COUNT: 'count', TIMEOUT: 'timeout', RESOLVE: 'resolve' } as const;

export const SHIP_VIA = { PICKUP: 'pickup', COURIER: 'courier' } as const;
export type ShipVia = typeof SHIP_VIA[keyof typeof SHIP_VIA];

export const SCAN_SCHEME = { BADGE: 11, PACKAGE: 12, BIN: 13, PRINTER: 21 } as const;

/** Where boxed orders go unless the environment names another bin. */
export const BIN_DEFAULT = { KEY: 'bin-7', DESTINATION: 'Portland', MAX: 12, TIMEOUT: '4h' } as const;

export const WAIT_TIMEOUT = { OPERATOR: '7d', PACKAGE: '24h' } as const;

export const routeKey = {
  print: (orderId: string) => `${orderId}-print`,
  lens: (orderId: string) => `${orderId}-lens`,
};
export const packageKey = (orderId: string) => `package-${orderId}`;
export const binWaitKey = (binKey: string) => `bin-${binKey}`;
export const binWorkflowId = (binKey: string, generation: number) => `rollup-${binKey}-g${generation}`;
/** The run a story order is started under: its own id, so starting it twice starts it once. */
export const storyRunId = (orderId: string) => `story-${orderId}`;
/** The signal key the cloud gives the production wait of one order. */
export const productionKey = (orderId: string) => `production-${orderId}`;
export const reportClosedKey = (escalationId: string) => `report-closed-${escalationId}`;

export const LOG_EVENTS = {
  SITE_STARTED: 'site.started',
  SITE_STOPPED: 'site.stopped',
  DBOS_LAUNCHED: 'site.dbos.launched',
  ASSETS_SERVING: 'site.assets.serving',
  PEOPLE_SEEDED: 'site.people.seeded',
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
  STATION_ONLINE: 'station.online',
  STATION_JOB_QUEUED: 'station.job.queued',
  STATION_JOB_DONE: 'station.job.done',
  STATION_JOB_FAILED: 'station.job.failed',
  STORY_ORDER_STARTED: 'story.order.started',
  STORY_ORDER_PARKED: 'story.order.parked',
  STORY_ORDER_FINISHED: 'story.order.finished',
  STORY_DONE: 'story.done',
  STORY_FAILED: 'story.failed',
} as const;
export type LogEvent = typeof LOG_EVENTS[keyof typeof LOG_EVENTS];
