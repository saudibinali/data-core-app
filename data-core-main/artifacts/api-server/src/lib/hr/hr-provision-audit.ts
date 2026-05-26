/**
 * F4.3 — Provisioning audit trail + HTTP Idempotency-Key replay (workspace-scoped).
 */
import { createHash } from "crypto";
import { db, hrProvisionAuditLogTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

export type ProvisionOperation =
  | "employee_account"
  | "general_user"
  | "employee_offboard_deactivate";

export type ProvisionOutcome = "pending" | "success" | "failed" | "replay";

const IDEMPOTENCY_KEY_MAX = 128;

export function readIdempotencyKeyFromHeaders(
  headers: Record<string, string | string[] | undefined>,
): string | null {
  const raw = headers["idempotency-key"] ?? headers["Idempotency-Key"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > IDEMPOTENCY_KEY_MAX) return null;
  return trimmed;
}

export function storageIdempotencyKey(workspaceId: number, clientKey: string): string {
  const raw = `${workspaceId}:${clientKey}`;
  return createHash("sha256").update(raw).digest("hex").slice(0, 64);
}

export function buildRequestFingerprint(payload: Record<string, unknown>): string {
  const canonical = JSON.stringify(payload, Object.keys(payload).sort());
  return createHash("sha256").update(canonical).digest("hex").slice(0, 64);
}

export type ProvisionReplay<T> =
  | { kind: "none" }
  | { kind: "replay"; httpStatus: number; data: T | null; error?: string; field?: string }
  | { kind: "conflict"; error: string };

export async function resolveProvisionIdempotency<T>(input: {
  workspaceId: number;
  clientIdempotencyKey: string | null | undefined;
  requestFingerprint: string;
}): Promise<ProvisionReplay<T>> {
  if (!input.clientIdempotencyKey) return { kind: "none" };

  const idempotencyKey = storageIdempotencyKey(input.workspaceId, input.clientIdempotencyKey);
  const [row] = await db
    .select()
    .from(hrProvisionAuditLogTable)
    .where(and(
      eq(hrProvisionAuditLogTable.workspaceId, input.workspaceId),
      eq(hrProvisionAuditLogTable.idempotencyKey, idempotencyKey),
    ))
    .limit(1);

  if (!row) return { kind: "none" };

  if (row.requestFingerprint !== input.requestFingerprint) {
    return {
      kind: "conflict",
      error: "Idempotency-Key was already used with a different request payload",
    };
  }

  if (row.outcome === "pending") {
    return {
      kind: "replay",
      httpStatus: 409,
      data: null,
      error: "Provision with this Idempotency-Key is already in progress",
    };
  }

  if (row.outcome === "success" && row.responseSnapshot) {
    return {
      kind: "replay",
      httpStatus: row.httpStatus,
      data: row.responseSnapshot as T,
    };
  }

  return {
    kind: "replay",
    httpStatus: row.httpStatus,
    data: null,
    error: row.errorMessage ?? "Previous provision attempt failed",
  };
}

export async function claimProvisionIdempotency(input: {
  workspaceId: number;
  clientIdempotencyKey: string;
  operation: ProvisionOperation;
  requestFingerprint: string;
  actorUserId?: number | null;
  employeeId?: number | null;
}): Promise<"claimed" | ProvisionReplay<never>> {
  const idempotencyKey = storageIdempotencyKey(input.workspaceId, input.clientIdempotencyKey);
  try {
    await db.insert(hrProvisionAuditLogTable).values({
      workspaceId: input.workspaceId,
      idempotencyKey,
      operation: input.operation,
      employeeId: input.employeeId ?? null,
      actorUserId: input.actorUserId ?? null,
      outcome: "pending",
      httpStatus: 102,
      requestFingerprint: input.requestFingerprint,
      responseSnapshot: null,
    });
    return "claimed";
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code !== "23505") throw err;
  }

  return resolveProvisionIdempotency({
    workspaceId: input.workspaceId,
    clientIdempotencyKey: input.clientIdempotencyKey,
    requestFingerprint: input.requestFingerprint,
  });
}

export async function finalizeProvisionIdempotency(input: {
  workspaceId: number;
  clientIdempotencyKey: string;
  operation: ProvisionOperation;
  requestFingerprint: string;
  employeeId?: number | null;
  userId?: number | null;
  actorUserId?: number | null;
  outcome: "success" | "failed";
  httpStatus: number;
  errorMessage?: string | null;
  responseSnapshot?: unknown;
}): Promise<void> {
  const idempotencyKey = storageIdempotencyKey(input.workspaceId, input.clientIdempotencyKey);
  await db
    .update(hrProvisionAuditLogTable)
    .set({
      outcome: input.outcome,
      httpStatus: input.httpStatus,
      errorMessage: input.errorMessage ?? null,
      employeeId: input.employeeId ?? null,
      userId: input.userId ?? null,
      responseSnapshot: input.responseSnapshot ?? null,
    })
    .where(and(
      eq(hrProvisionAuditLogTable.workspaceId, input.workspaceId),
      eq(hrProvisionAuditLogTable.idempotencyKey, idempotencyKey),
      eq(hrProvisionAuditLogTable.requestFingerprint, input.requestFingerprint),
    ));
}

export async function recordProvisionAudit(input: {
  workspaceId: number;
  clientIdempotencyKey?: string | null;
  operation: ProvisionOperation;
  employeeId?: number | null;
  userId?: number | null;
  actorUserId?: number | null;
  outcome: Exclude<ProvisionOutcome, "pending" | "replay">;
  httpStatus: number;
  errorMessage?: string | null;
  requestFingerprint: string;
  responseSnapshot?: unknown;
}): Promise<void> {
  if (input.clientIdempotencyKey) return;

  await db.insert(hrProvisionAuditLogTable).values({
    workspaceId: input.workspaceId,
    idempotencyKey: null,
    operation: input.operation,
    employeeId: input.employeeId ?? null,
    userId: input.userId ?? null,
    actorUserId: input.actorUserId ?? null,
    outcome: input.outcome,
    httpStatus: input.httpStatus,
    errorMessage: input.errorMessage ?? null,
    requestFingerprint: input.requestFingerprint,
    responseSnapshot: input.responseSnapshot ?? null,
  });
}
