/**
 * Direct API bridge — generic REST push compatible with generic_webhook payload shape.
 */
import { genericWebhookConnector } from "./generic-webhook";
import { genericRestPollConnector } from "./generic-rest-poll";
import type { AttendanceConnector } from "../types";

export const directApiBridgeConnector: AttendanceConnector = {
  connectorKey: "direct_api",
  capabilities: ["webhook", "poll", "employee_resolve", "device_resolve", "test_connection"],

  validateConfig(config) {
    if (config.baseUrl && typeof config.baseUrl !== "string") {
      throw new Error("config.baseUrl must be a string");
    }
  },

  async testConnection(ctx) {
    const base = ctx.config.baseUrl ? String(ctx.config.baseUrl) : null;
    if (!base) {
      return { ok: true, message: "Direct API bridge configured; use webhook URL or REST poll." };
    }
    try {
      const res = await fetch(base, { method: "HEAD", signal: AbortSignal.timeout(10_000) });
      return { ok: res.ok || res.status < 500, message: `HEAD ${base} → ${res.status}` };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  },

  async poll(ctx, cursor) {
    const pollUrl = ctx.config.pollUrl ? String(ctx.config.pollUrl) : null;
    if (!pollUrl) return { events: [], hasMore: false };
    return genericRestPollConnector.poll(
      { ...ctx, config: { ...ctx.config, pollUrl } },
      cursor,
    );
  },

  parseWebhook: genericWebhookConnector.parseWebhook.bind(genericWebhookConnector),

  async resolveEmployee() {
    return null;
  },

  async resolveDevice() {
    return null;
  },
};
