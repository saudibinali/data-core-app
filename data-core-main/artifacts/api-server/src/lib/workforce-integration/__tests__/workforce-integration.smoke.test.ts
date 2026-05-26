/**
 * P20-E — Integration hub smoke tests
 */
import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import { connectorRegistry } from "../connector-registry";
import { registerWorkforceConnectors } from "../register-connectors";
import {
  checkReplayToken,
  hashWebhookSecret,
  signWebhookPayload,
  verifyWebhookSignature,
} from "../integration-security";
import { genericWebhookConnector } from "../connectors/generic-webhook";
import { AttendanceIngestionService } from "../../workforce-attendance/ingestion-service";

describe("P20-E connector registry (unit)", () => {
  it("registers and resolves all minimal connectors", () => {
    registerWorkforceConnectors();
    const keys = connectorRegistry.list().map((c) => c.connectorKey).sort();
    expect(keys).toEqual(
      ["direct_api", "excel_import", "generic_rest_poll", "generic_webhook"].sort(),
    );
    expect(connectorRegistry.resolve("generic_webhook").connectorKey).toBe("generic_webhook");
  });

  it("validates unknown connector keys", () => {
    expect(() => connectorRegistry.validateConnectorKey("acme_sdk")).toThrow(/Unsupported/);
  });
});

describe("P20-E webhook security (unit)", () => {
  it("verifies HMAC signature and replay protection", () => {
    const secret = "test-secret-key";
    const body = JSON.stringify({ events: [{ externalEventId: "e1", externalEmployeeId: "x1" }] });
    const sig = signWebhookPayload(secret, body);
    expect(verifyWebhookSignature(secret, body, sig)).toBe(true);
    expect(verifyWebhookSignature(secret, body, "bad")).toBe(false);

    const hash = hashWebhookSecret(secret);
    expect(hash).not.toBe(secret);

    expect(checkReplayToken(1, "token-a")).toBe(true);
    expect(checkReplayToken(1, "token-a")).toBe(false);
    expect(checkReplayToken(2, "token-a")).toBe(true);
  });

  it("parses generic webhook payloads", async () => {
    const parsed = await genericWebhookConnector.parseWebhook(
      {
        workspaceId: 1,
        integrationId: 1,
        connectorKey: "generic_webhook",
        config: {},
        credentials: {},
      },
      {},
      {
        events: [
          {
            externalEventId: "evt-1",
            externalEmployeeId: "emp-ext-1",
            eventType: "clock_in",
            occurredAt: "2026-05-19T08:00:00Z",
          },
        ],
        replayToken: "r1",
      },
    );
    expect(parsed.events).toHaveLength(1);
    expect(parsed.events[0]!.externalEventId).toBe("evt-1");
  });
});

describe("P20-E idempotency key (unit)", () => {
  it("uses integration-scoped external id", () => {
    const svc = new AttendanceIngestionService();
    const key = svc.generateIdempotencyKey({
      workspaceId: 1,
      sourceCode: "vendor",
      employeeId: 10,
      eventTypeHint: "clock_in",
      occurredAt: new Date("2026-05-19T08:00:00Z"),
      payload: {},
      externalId: "int:5:evt-99",
    });
    expect(key).toBe("ext:vendor:int:5:evt-99");
  });
});

import { isSmokeDatabaseAvailable } from "../../../test-utils/smoke-db";

const RUN = isSmokeDatabaseAvailable() && process.env.RUN_WORKFORCE_INTEGRATION_SMOKE !== "0";

describe.skipIf(!RUN)("P20-E integration smoke (DB)", () => {
  beforeAll(async () => {
    const { pool, initializeDatabase } = await import("@workspace/db");
    if (!process.env.DATABASE_URL) return;
    initializeDatabase(process.env.DATABASE_URL);
    const r = await pool.query(
      `SELECT COUNT(*)::int AS c FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'attendance_integrations'`,
    );
    if (Number(r.rows[0]?.c) < 1) {
      throw new Error("Migration 0009 not applied — attendance_integrations missing");
    }
  });

  it("workspace isolation on integration lookup", async () => {
    const { db, workspacesTable, attendanceIntegrationsTable } = await import("@workspace/db");
    const { integrationService } = await import("../integration-service");
    const slug = `int-ws-${Date.now()}`;
    const [ws1] = await db.insert(workspacesTable).values({ name: "I1", slug }).returning();
    const [ws2] = await db
      .insert(workspacesTable)
      .values({ name: "I2", slug: `${slug}-b` })
      .returning();

    const created = await integrationService.create({
      workspaceId: ws1!.id,
      name: "Test WH",
      connectorKey: "generic_webhook",
    });

    await expect(integrationService.get(ws2!.id, created.id as number)).rejects.toThrow(
      /not found/i,
    );

    await db
      .delete(attendanceIntegrationsTable)
      .where(eq(attendanceIntegrationsTable.id, created.id as number));
  });
});
