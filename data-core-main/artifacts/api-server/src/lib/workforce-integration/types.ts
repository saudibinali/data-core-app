/**
 * P20-E — Vendor-agnostic connector contracts
 */

export type ConnectorCapability =
  | "webhook"
  | "poll"
  | "employee_resolve"
  | "device_resolve"
  | "test_connection";

export type RawEventDraft = {
  externalEventId: string;
  externalEmployeeId: string;
  eventTypeHint: "clock_in" | "clock_out" | "import_row";
  occurredAt: Date;
  payload: Record<string, unknown>;
  externalDeviceId?: string;
};

export type ConnectorContext = {
  workspaceId: number;
  integrationId: number;
  connectorKey: string;
  config: Record<string, unknown>;
  credentials: Record<string, string>;
};

export type ConnectionTestResult = {
  ok: boolean;
  message: string;
  latencyMs?: number;
};

export type PollResult = {
  events: RawEventDraft[];
  nextCursor?: string;
  hasMore: boolean;
};

export type WebhookParseResult = {
  events: RawEventDraft[];
  replayToken?: string;
};

export interface AttendanceConnector {
  readonly connectorKey: string;
  readonly capabilities: ConnectorCapability[];
  validateConfig(config: Record<string, unknown>): void;
  testConnection(ctx: ConnectorContext): Promise<ConnectionTestResult>;
  poll(ctx: ConnectorContext, cursor?: string): Promise<PollResult>;
  parseWebhook(
    ctx: ConnectorContext,
    headers: Record<string, string | string[] | undefined>,
    body: unknown,
  ): Promise<WebhookParseResult>;
  resolveEmployee(ctx: ConnectorContext, externalEmployeeId: string): Promise<number | null>;
  resolveDevice(ctx: ConnectorContext, externalDeviceId: string): Promise<number | null>;
}
