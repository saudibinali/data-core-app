/**
 * F7.2 — Transactional event outbox (enqueue + publish helpers).
 *
 * Modes (EVENT_OUTBOX_PUBLISH_MODE):
 *   direct  — appEventBus.emit only (default)
 *   shadow  — enqueue + direct emit (pilot: verify outbox rows without changing delivery)
 *   outbox  — enqueue only; worker drains → appEventBus (requires EVENT_OUTBOX_DRAIN)
 */
import { db, eventOutboxTable, type EventOutboxRow } from "@workspace/db";
import type { EventInput, EmitResult, EventTypeMap } from "@workspace/core-events";
import { and, eq, inArray, lte, or, isNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@workspace/db";
import { appEventBus } from "./app-bus";
import { logger } from "../logger";

type DbOrTx = typeof db | NodePgDatabase<typeof schema>;
type TxClient = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type EventPublishMode = "direct" | "shadow" | "outbox";

function envBool(v: string | undefined): boolean {
  return v === "1" || v === "true" || v === "yes";
}

export function eventPublishMode(): EventPublishMode {
  const raw = (process.env.EVENT_OUTBOX_PUBLISH_MODE ?? "direct").toLowerCase();
  if (raw === "shadow" || raw === "outbox") return raw;
  return "direct";
}

export function shouldDrainEventOutbox(): boolean {
  if (eventPublishMode() === "outbox") return true;
  return envBool(process.env.EVENT_OUTBOX_DRAIN);
}

/** Enqueue a domain event for later publish (same shape as appEventBus.emit input). */
export async function enqueueEventOutbox<K extends keyof EventTypeMap>(
  input: EventInput<K>,
  client: DbOrTx = db,
): Promise<number | null> {
  const workspaceId = input.workspace.workspaceId;
  const idempotencyKey = input.metadata?.idempotencyKey ?? null;
  const payload = {
    type: input.type,
    module: input.module,
    workspace: input.workspace,
    actor: input.actor,
    metadata: input.metadata ?? {},
    data: input.data,
  };

  try {
    const [row] = await client
      .insert(eventOutboxTable)
      .values({
        workspaceId,
        eventType: String(input.type),
        module: input.module,
        payload,
        idempotencyKey,
        status: "pending",
      })
      .returning({ id: eventOutboxTable.id });
    return row?.id ?? null;
  } catch (err: unknown) {
    const code = err && typeof err === "object" && "code" in err ? String((err as { code: string }).code) : "";
    if (code === "23505" && idempotencyKey) {
      logger.debug({ workspaceId, idempotencyKey }, "event outbox duplicate skipped");
      return null;
    }
    throw err;
  }
}

/**
 * Canonical publish entry for new code during F7 migration.
 * Prefer this over raw appEventBus.emit when the route already uses a transaction.
 */
export async function publishDomainEvent<K extends keyof EventTypeMap>(
  input: EventInput<K>,
  opts?: { tx?: TxClient },
): Promise<EmitResult | null> {
  const mode = eventPublishMode();
  const client = opts?.tx ?? db;

  if (mode === "shadow" || mode === "outbox") {
    await enqueueEventOutbox(input, client);
  }
  if (mode === "outbox") {
    return null;
  }
  return appEventBus.emit(input);
}

export async function drainOneOutboxRow(row: EventOutboxRow): Promise<void> {
  const payload = row.payload as EventInput<keyof EventTypeMap>;
  await appEventBus.emit(payload);
}

export async function processEventOutboxBatch(limit = 25): Promise<number> {
  if (!shouldDrainEventOutbox()) return 0;

  const now = new Date();
  const rows = await db
    .select()
    .from(eventOutboxTable)
    .where(
      and(
        inArray(eventOutboxTable.status, ["pending", "retry"]),
        or(isNull(eventOutboxTable.nextRetryAt), lte(eventOutboxTable.nextRetryAt, now)),
      ),
    )
    .orderBy(eventOutboxTable.createdAt)
    .limit(limit);

  for (const row of rows) {
    await db
      .update(eventOutboxTable)
      .set({ status: "processing", attempts: sql`${eventOutboxTable.attempts} + 1` })
      .where(eq(eventOutboxTable.id, row.id));

    try {
      await drainOneOutboxRow(row);
      await db
        .update(eventOutboxTable)
        .set({ status: "published", publishedAt: new Date(), lastError: null })
        .where(eq(eventOutboxTable.id, row.id));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const attempts = row.attempts + 1;
      const backoffMs = Math.min(60_000 * 2 ** attempts, 30 * 60_000);
      await db
        .update(eventOutboxTable)
        .set({
          status: attempts >= 8 ? "failed" : "retry",
          lastError: message.slice(0, 2000),
          nextRetryAt: new Date(Date.now() + backoffMs),
        })
        .where(eq(eventOutboxTable.id, row.id));
      logger.warn({ outboxId: row.id, err: message }, "event outbox drain failed");
    }
  }

  return rows.length;
}
