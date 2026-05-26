/**
 * H5/H6 — Employee import staging + foundation readiness routes.
 */

import { Router } from "express";
import { requireAuth, requirePermission, type AuthRequest } from "../middlewares/requireAuth";
import {
  evaluateFoundationReadiness,
  getEmployeeImportGovernanceSettings,
} from "../lib/hr-foundation/employee-import-governance";
import {
  bulkPromoteStaging,
  getStagingRow,
  listStagingRows,
  patchStagingRow,
  promoteStagingRow,
  countPendingStaging,
} from "../lib/hr-foundation/employee-import-staging-service";
import { db, hrWorkspaceSettingsTable, hrMasterDataAliasesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { parseListPagination } from "../lib/list-pagination";

const router: Router = Router();

router.get("/hr/foundation/readiness", requireAuth, requirePermission("hr.view"), async (req: AuthRequest, res): Promise<void> => {
  const workspaceId = req.workspaceId;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

  const [readiness, governance, pendingStaging] = await Promise.all([
    evaluateFoundationReadiness(workspaceId),
    getEmployeeImportGovernanceSettings(workspaceId),
    countPendingStaging(workspaceId),
  ]);

  res.json({
    readiness,
    governance,
    pendingStaging,
    employeeImportAllowed: readiness.ready || !governance.readinessGateEnabled,
  });
});

router.get("/hr/employees/import-staging", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  const workspaceId = req.workspaceId;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

  const { limit, offset } = parseListPagination(req.query);
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const batchId = typeof req.query.batchId === "string" ? req.query.batchId : undefined;

  const result = await listStagingRows({ workspaceId, status, batchId, limit, offset });
  res.setHeader("X-Total-Count", String(result.total));
  res.json({ rows: result.rows, total: result.total, limit, offset });
});

router.get("/hr/employees/import-staging/:id", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  const workspaceId = req.workspaceId;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

  const id = parseInt(String(req.params.id), 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const row = await getStagingRow(workspaceId, id);
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

router.patch("/hr/employees/import-staging/:id", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  const workspaceId = req.workspaceId;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

  const id = parseInt(String(req.params.id), 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const normalizedRow = req.body?.normalizedRow as Record<string, unknown> | undefined;
  const updated = await patchStagingRow({
    workspaceId,
    id,
    normalizedRow,
    userId: req.userId,
  });

  if (!updated) { res.status(404).json({ error: "Not found or already promoted" }); return; }
  res.json(updated);
});

router.post("/hr/employees/import-staging/:id/promote", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  const workspaceId = req.workspaceId;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

  const id = parseInt(String(req.params.id), 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [settings] = await db
    .select({ numberingMode: hrWorkspaceSettingsTable.numberingMode })
    .from(hrWorkspaceSettingsTable)
    .where(eq(hrWorkspaceSettingsTable.workspaceId, workspaceId));

  const result = await promoteStagingRow({
    workspaceId,
    id,
    userId: req.userId,
    numberingMode: settings?.numberingMode ?? "auto",
  });

  if (!result.ok) {
    res.status(400).json({ error: result.error ?? "Promote failed" });
    return;
  }
  res.json({ ok: true, employeeId: result.employeeId });
});

router.post("/hr/employees/import-staging/bulk-promote", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  const workspaceId = req.workspaceId;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((v: unknown) => Number(v)).filter((n: number) => Number.isFinite(n)) : [];
  if (!ids.length) { res.status(400).json({ error: "ids required" }); return; }

  const [settings] = await db
    .select({ numberingMode: hrWorkspaceSettingsTable.numberingMode })
    .from(hrWorkspaceSettingsTable)
    .where(eq(hrWorkspaceSettingsTable.workspaceId, workspaceId));

  const result = await bulkPromoteStaging({
    workspaceId,
    ids,
    userId: req.userId,
    numberingMode: settings?.numberingMode ?? "auto",
  });

  res.json(result);
});

router.post("/hr/employees/import-staging/aliases", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  const workspaceId = req.workspaceId;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

  const entityType = String(req.body?.entityType ?? "").trim();
  const aliasCode = String(req.body?.aliasCode ?? "").trim();
  const canonicalCode = String(req.body?.canonicalCode ?? "").trim();

  if (!entityType || !aliasCode || !canonicalCode) {
    res.status(400).json({ error: "entityType, aliasCode, canonicalCode required" });
    return;
  }

  await db.insert(hrMasterDataAliasesTable).values({
    workspaceId,
    entityType,
    aliasCode,
    canonicalCode,
    createdByUserId: req.userId ?? null,
  }).onConflictDoUpdate({
    target: [hrMasterDataAliasesTable.workspaceId, hrMasterDataAliasesTable.entityType, hrMasterDataAliasesTable.aliasCode],
    set: { canonicalCode },
  });

  res.json({ ok: true });
});

export default router;
