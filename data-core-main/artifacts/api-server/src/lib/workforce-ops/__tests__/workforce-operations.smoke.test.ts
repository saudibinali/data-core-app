/**
 * P20-F — Workforce operations smoke tests
 */
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { maskPayloadForDisplay } from "../payload-masking";
import { operationsService } from "../operations-service";

describe("P20-F payload masking (unit)", () => {
  it("masks sensitive keys in payloads", () => {
    const masked = maskPayloadForDisplay({
      employeeId: 1,
      apiKey: "secret-key",
      nested: { webhookSecret: "x" },
    }) as Record<string, unknown>;
    expect(masked.apiKey).toBe("***");
    expect((masked.nested as Record<string, unknown>).webhookSecret).toBe("***");
    expect(masked.employeeId).toBe(1);
  });
});

const HAS_DB = Boolean(process.env.DATABASE_URL);
const RUN = HAS_DB && process.env.RUN_WORKFORCE_OPS_SMOKE !== "0";

describe.skipIf(!RUN)("P20-F operations (DB)", () => {
  it("metrics aggregation returns shape", async () => {
    const { pool, initializeDatabase, workspacesTable, db } = await import("@workspace/db");
    initializeDatabase(process.env.DATABASE_URL!);
    const r = await pool.query(
      `SELECT COUNT(*)::int AS c FROM information_schema.tables WHERE table_name = 'attendance_raw_events'`,
    );
    if (Number(r.rows[0]?.c) < 1) return;

    const slug = `ops-${Date.now()}`;
    const [ws] = await db.insert(workspacesTable).values({ name: "Ops WS", slug }).returning();
    const health = await operationsService.getRawEventHealth(ws!.id);
    expect(health).toHaveProperty("total");
    expect(health).toHaveProperty("failed");

    await db.delete(workspacesTable).where(eq(workspacesTable.id, ws!.id));
  });
});
