import type { AttendanceConnector, ConnectorContext, WebhookParseResult } from "../types";

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export const genericWebhookConnector: AttendanceConnector = {
  connectorKey: "generic_webhook",
  capabilities: ["webhook", "employee_resolve", "test_connection"],

  validateConfig(_config) {
    /* optional event path mapping in config */
  },

  async testConnection(_ctx) {
    return { ok: true, message: "Webhook endpoint ready; POST events to the integration webhook URL." };
  },

  async poll() {
    return { events: [], hasMore: false };
  },

  async parseWebhook(
    _ctx: ConnectorContext,
    _headers: Record<string, string | string[] | undefined>,
    body: unknown,
  ): Promise<WebhookParseResult> {
    const events: WebhookParseResult["events"] = [];
    const root = asRecord(body);
    if (!root) throw new Error("Webhook body must be a JSON object");

    const items = Array.isArray(root.events) ? root.events : [root];
    for (const item of items) {
      const rec = asRecord(item);
      if (!rec) continue;
      const externalEventId = String(rec.externalEventId ?? rec.id ?? rec.eventId ?? "");
      const externalEmployeeId = String(
        rec.externalEmployeeId ?? rec.employeeId ?? rec.employeeCode ?? "",
      );
      if (!externalEventId || !externalEmployeeId) continue;
      const typeRaw = String(rec.eventType ?? rec.type ?? "clock_in").toLowerCase();
      const eventTypeHint =
        typeRaw.includes("out") || typeRaw === "clock_out" ? "clock_out" : "clock_in";
      const occurredAt = rec.occurredAt
        ? new Date(String(rec.occurredAt))
        : new Date();
      if (Number.isNaN(occurredAt.getTime())) continue;
      events.push({
        externalEventId,
        externalEmployeeId,
        eventTypeHint,
        occurredAt,
        payload: rec,
        externalDeviceId: rec.externalDeviceId ? String(rec.externalDeviceId) : undefined,
      });
    }

    if (events.length === 0) throw new Error("No valid events in webhook payload");
    const replayToken =
      root.replayToken != null ? String(root.replayToken) : externalIdFromFirst(events);
    return { events, replayToken };
  },

  async resolveEmployee() {
    return null;
  },

  async resolveDevice() {
    return null;
  },
};

function externalIdFromFirst(events: WebhookParseResult["events"]): string | undefined {
  return events[0]?.externalEventId;
}
