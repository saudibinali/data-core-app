import type { AttendanceConnector, ConnectorContext, PollResult } from "../types";

export const genericRestPollConnector: AttendanceConnector = {
  connectorKey: "generic_rest_poll",
  capabilities: ["poll", "employee_resolve", "test_connection"],

  validateConfig(config) {
    if (!config.pollUrl || typeof config.pollUrl !== "string") {
      throw new Error("config.pollUrl is required for generic_rest_poll");
    }
  },

  async testConnection(ctx) {
    const url = String(ctx.config.pollUrl ?? "");
    if (!url) return { ok: false, message: "pollUrl not configured" };
    const start = Date.now();
    try {
      const headers: Record<string, string> = { Accept: "application/json" };
      if (ctx.credentials.bearerToken) {
        headers.Authorization = `Bearer ${ctx.credentials.bearerToken}`;
      } else if (ctx.credentials.apiKey) {
        headers["X-Api-Key"] = ctx.credentials.apiKey;
      }
      const res = await fetch(url, { method: "GET", headers, signal: AbortSignal.timeout(15_000) });
      return {
        ok: res.ok,
        message: res.ok ? `HTTP ${res.status}` : `HTTP ${res.status} ${res.statusText}`,
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
        latencyMs: Date.now() - start,
      };
    }
  },

  async poll(ctx, cursor): Promise<PollResult> {
    const url = new URL(String(ctx.config.pollUrl));
    if (cursor) url.searchParams.set("cursor", cursor);
    const pageSize = Number(ctx.config.pageSize ?? 100);
    url.searchParams.set("limit", String(pageSize));

    const headers: Record<string, string> = { Accept: "application/json" };
    if (ctx.credentials.bearerToken) {
      headers.Authorization = `Bearer ${ctx.credentials.bearerToken}`;
    } else if (ctx.credentials.apiKey) {
      headers["X-Api-Key"] = ctx.credentials.apiKey;
    }

    const res = await fetch(url.toString(), { method: "GET", headers, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`Poll failed: HTTP ${res.status}`);
    const body = (await res.json()) as Record<string, unknown>;
    const items = Array.isArray(body.events)
      ? body.events
      : Array.isArray(body.data)
        ? body.data
        : [];

    const events: PollResult["events"] = [];
    for (const item of items) {
      if (typeof item !== "object" || item === null) continue;
      const rec = item as Record<string, unknown>;
      const externalEventId = String(rec.externalEventId ?? rec.id ?? "");
      const externalEmployeeId = String(rec.externalEmployeeId ?? rec.employeeId ?? "");
      if (!externalEventId || !externalEmployeeId) continue;
      const typeRaw = String(rec.eventType ?? rec.type ?? "clock_in").toLowerCase();
      const eventTypeHint =
        typeRaw.includes("out") || typeRaw === "clock_out" ? "clock_out" : "clock_in";
      const occurredAt = new Date(String(rec.occurredAt ?? new Date().toISOString()));
      events.push({
        externalEventId,
        externalEmployeeId,
        eventTypeHint,
        occurredAt,
        payload: rec,
        externalDeviceId: rec.externalDeviceId ? String(rec.externalDeviceId) : undefined,
      });
    }

    const nextCursor = body.nextCursor != null ? String(body.nextCursor) : undefined;
    return {
      events,
      nextCursor,
      hasMore: Boolean(nextCursor && events.length > 0),
    };
  },

  async parseWebhook() {
    return { events: [] };
  },

  async resolveEmployee() {
    return null;
  },

  async resolveDevice() {
    return null;
  },
};
