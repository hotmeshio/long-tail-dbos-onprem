/** One escalation row as the cloud API returns it. `envelope` and `escalation_payload` arrive as JSON text. */
export interface CloudEscalation {
  id: string;
  role: string;
  type: string;
  status: string;
  assigned_to: string | null;
  workflow_id?: string | null;
  metadata: Record<string, unknown> | null;
  envelope: string | Record<string, unknown> | null;
  escalation_payload: string | Record<string, unknown> | null;
}

/** One file of an escalation with a link that works for a few hours. */
export interface CloudFile {
  as: string;
  path: string;
  name: string;
  contentType?: string;
  url?: string;
  error?: string;
}

export interface ClaimQuery {
  role: string;
  limit: number;
  durationMinutes: number;
}

export interface CloudCredentials {
  apiKey: string;
  botId: string;
}

/** What the site asks of the cloud. Every call is outbound from the site. */
export interface CloudClient {
  /** The bot the site acts as; the first call signs in. */
  botId(): Promise<string>;
  /** Claim open rows of a role in one atomic call. */
  claim(query: ClaimQuery): Promise<CloudEscalation[]>;
  /** Every pending row this site holds a claim on. */
  listClaimed(): Promise<CloudEscalation[]>;
  files(escalationId: string): Promise<CloudFile[]>;
  read(escalationId: string): Promise<CloudEscalation>;
  resolve(signalKey: string, payload: Record<string, unknown>): Promise<void>;
}

export interface RetryPolicy {
  retries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}
