/**
 * Bridge connector — routes vendor excel paths through existing P20-C import pipeline.
 * Poll mode returns empty; HR uses Import Center for bulk excel.
 */
import type { AttendanceConnector } from "../types";

export const excelImportBridgeConnector: AttendanceConnector = {
  connectorKey: "excel_import",
  capabilities: ["test_connection"],

  validateConfig() {},

  async testConnection() {
    return {
      ok: true,
      message: "Use HR → Workforce → Import Center for Excel uploads; this integration records the bridge only.",
    };
  },

  async poll() {
    return { events: [], hasMore: false };
  },

  async parseWebhook() {
    throw new Error("excel_import does not accept webhooks; use Import Center");
  },

  async resolveEmployee() {
    return null;
  },

  async resolveDevice() {
    return null;
  },
};
