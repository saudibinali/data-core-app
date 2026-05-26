import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  employeesTable,
  hrOrgUnitsTable,
  hrJobGradesTable,
  hrJobTitlesTable,
  hrPositionsTable,
  hrWorkLocationsTable,
  hrMasterDataAliasesTable,
} from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { requireAuth, requireWorkspaceAdmin, type AuthRequest } from "../middlewares/requireAuth";
import { masterDataCatalogService } from "../lib/hr-import/catalog/master-data-catalog";

const router: IRouter = Router();

type MergeEntityType = "job_grade" | "job_title" | "org_unit" | "work_location" | "position";

function assertEntityType(v: unknown): MergeEntityType {
  const s = String(v ?? "").trim();
  if (s === "job_grade" || s === "job_title" || s === "org_unit" || s === "work_location" || s === "position") return s;
  throw new Error("Invalid entityType");
}

function toIntList(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0);
}

function uniqueInts(ids: number[]): number[] {
  return [...new Set(ids)];
}

async function getCanonicalCodeForEntity(input: {
  workspaceId: number;
  entityType: MergeEntityType;
  id: number;
}): Promise<string | null> {
  const ws = input.workspaceId;
  if (input.entityType === "job_grade") {
    const [row] = await db.select({ code: hrJobGradesTable.code }).from(hrJobGradesTable)
      .where(and(eq(hrJobGradesTable.workspaceId, ws), eq(hrJobGradesTable.id, input.id)));
    return row?.code ?? null;
  }
  if (input.entityType === "job_title") {
    const [row] = await db.select({ code: hrJobTitlesTable.code }).from(hrJobTitlesTable)
      .where(and(eq(hrJobTitlesTable.workspaceId, ws), eq(hrJobTitlesTable.id, input.id)));
    return row?.code ?? null;
  }
  if (input.entityType === "org_unit") {
    const [row] = await db.select({ code: hrOrgUnitsTable.code }).from(hrOrgUnitsTable)
      .where(and(eq(hrOrgUnitsTable.workspaceId, ws), eq(hrOrgUnitsTable.id, input.id)));
    return row?.code ?? null;
  }
  if (input.entityType === "work_location") {
    const [row] = await db.select({ code: hrWorkLocationsTable.code }).from(hrWorkLocationsTable)
      .where(and(eq(hrWorkLocationsTable.workspaceId, ws), eq(hrWorkLocationsTable.id, input.id)));
    return row?.code ?? null;
  }
  const [row] = await db.select({ code: hrPositionsTable.code }).from(hrPositionsTable)
    .where(and(eq(hrPositionsTable.workspaceId, ws), eq(hrPositionsTable.id, input.id)));
  return row?.code ?? null;
}

async function assertMergeEntitiesExist(input: {
  workspaceId: number;
  entityType: MergeEntityType;
  targetId: number;
  sourceIds: number[];
}): Promise<void> {
  const ws = input.workspaceId;
  const allIds = uniqueInts([input.targetId, ...input.sourceIds]);

  const pick = async (): Promise<number[]> => {
    if (input.entityType === "job_grade") {
      const rows = await db.select({ id: hrJobGradesTable.id }).from(hrJobGradesTable)
        .where(and(eq(hrJobGradesTable.workspaceId, ws), inArray(hrJobGradesTable.id, allIds)));
      return rows.map((r) => r.id);
    }
    if (input.entityType === "job_title") {
      const rows = await db.select({ id: hrJobTitlesTable.id }).from(hrJobTitlesTable)
        .where(and(eq(hrJobTitlesTable.workspaceId, ws), inArray(hrJobTitlesTable.id, allIds)));
      return rows.map((r) => r.id);
    }
    if (input.entityType === "org_unit") {
      const rows = await db.select({ id: hrOrgUnitsTable.id }).from(hrOrgUnitsTable)
        .where(and(eq(hrOrgUnitsTable.workspaceId, ws), inArray(hrOrgUnitsTable.id, allIds)));
      return rows.map((r) => r.id);
    }
    if (input.entityType === "work_location") {
      const rows = await db.select({ id: hrWorkLocationsTable.id }).from(hrWorkLocationsTable)
        .where(and(eq(hrWorkLocationsTable.workspaceId, ws), inArray(hrWorkLocationsTable.id, allIds)));
      return rows.map((r) => r.id);
    }
    const rows = await db.select({ id: hrPositionsTable.id }).from(hrPositionsTable)
      .where(and(eq(hrPositionsTable.workspaceId, ws), inArray(hrPositionsTable.id, allIds)));
    return rows.map((r) => r.id);
  };

  const found = new Set(await pick());
  if (!found.has(input.targetId)) throw new Error("targetId not found in workspace");
  for (const id of input.sourceIds) {
    if (!found.has(id)) throw new Error(`sourceId ${id} not found in workspace`);
  }
}

async function computeImpact(input: {
  workspaceId: number;
  entityType: MergeEntityType;
  sourceIds: number[];
}): Promise<Record<string, number>> {
  const ws = input.workspaceId;
  const ids = input.sourceIds;

  if (input.entityType === "job_grade") {
    const [emp, pos, titles] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(employeesTable)
        .where(and(eq(employeesTable.workspaceId, ws), inArray(employeesTable.jobGradeId, ids))),
      db.select({ count: sql<number>`count(*)::int` }).from(hrPositionsTable)
        .where(and(eq(hrPositionsTable.workspaceId, ws), inArray(hrPositionsTable.jobGradeId, ids))),
      db.select({ count: sql<number>`count(*)::int` }).from(hrJobTitlesTable)
        .where(and(eq(hrJobTitlesTable.workspaceId, ws), inArray(hrJobTitlesTable.gradeId, ids))),
    ]);
    return { employees: emp[0]?.count ?? 0, positions: pos[0]?.count ?? 0, jobTitles: titles[0]?.count ?? 0 };
  }

  if (input.entityType === "job_title") {
    const [emp, pos] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(employeesTable)
        .where(and(eq(employeesTable.workspaceId, ws), inArray(employeesTable.jobTitleId, ids))),
      db.select({ count: sql<number>`count(*)::int` }).from(hrPositionsTable)
        .where(and(eq(hrPositionsTable.workspaceId, ws), inArray(hrPositionsTable.jobTitleId, ids))),
    ]);
    return { employees: emp[0]?.count ?? 0, positions: pos[0]?.count ?? 0 };
  }

  if (input.entityType === "org_unit") {
    const [emp, pos, children] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(employeesTable)
        .where(and(eq(employeesTable.workspaceId, ws), inArray(employeesTable.orgUnitId, ids))),
      db.select({ count: sql<number>`count(*)::int` }).from(hrPositionsTable)
        .where(and(eq(hrPositionsTable.workspaceId, ws), inArray(hrPositionsTable.orgUnitId, ids))),
      db.select({ count: sql<number>`count(*)::int` }).from(hrOrgUnitsTable)
        .where(and(eq(hrOrgUnitsTable.workspaceId, ws), inArray(hrOrgUnitsTable.parentId, ids))),
    ]);
    return { employees: emp[0]?.count ?? 0, positions: pos[0]?.count ?? 0, childOrgUnits: children[0]?.count ?? 0 };
  }

  if (input.entityType === "work_location") {
    const [emp, pos] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(employeesTable)
        .where(and(eq(employeesTable.workspaceId, ws), inArray(employeesTable.workLocationId, ids))),
      db.select({ count: sql<number>`count(*)::int` }).from(hrPositionsTable)
        .where(and(eq(hrPositionsTable.workspaceId, ws), inArray(hrPositionsTable.workLocationId, ids))),
    ]);
    return { employees: emp[0]?.count ?? 0, positions: pos[0]?.count ?? 0 };
  }

  // position
  const [emp] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(employeesTable)
      .where(and(eq(employeesTable.workspaceId, ws), inArray(employeesTable.positionId, ids))),
  ]);
  return { employees: emp[0]?.count ?? 0 };
}

function mergedRetirementCode(sourceId: number): string {
  return `__merged_${sourceId}`;
}

async function applyMergeTx(input: {
  workspaceId: number;
  entityType: MergeEntityType;
  sourceIds: number[];
  targetId: number;
  userId?: number;
  createAliases: boolean;
}): Promise<{ moved: Record<string, number>; deactivated: number; aliasesCreated: number }> {
  const ws = input.workspaceId;
  const ids = input.sourceIds;
  const targetId = input.targetId;

  const moved: Record<string, number> = {};
  let aliasesCreated = 0;

  const aliasPairs: Array<{ aliasCode: string; canonicalCode: string }> = [];
  if (input.createAliases) {
    const targetCode = await getCanonicalCodeForEntity({ workspaceId: ws, entityType: input.entityType, id: targetId });
    if (targetCode) {
      for (const sourceId of ids) {
        const sourceCode = await getCanonicalCodeForEntity({ workspaceId: ws, entityType: input.entityType, id: sourceId });
        if (!sourceCode || sourceCode === targetCode) continue;
        aliasPairs.push({ aliasCode: sourceCode, canonicalCode: targetCode });
      }
    }
  }

  await db.transaction(async (tx) => {
    if (input.entityType === "job_grade") {
      const r1 = await tx.update(employeesTable).set({ jobGradeId: targetId })
        .where(and(eq(employeesTable.workspaceId, ws), inArray(employeesTable.jobGradeId, ids)));
      moved.employees = Number(r1.rowCount ?? 0);
      const r2 = await tx.update(hrPositionsTable).set({ jobGradeId: targetId })
        .where(and(eq(hrPositionsTable.workspaceId, ws), inArray(hrPositionsTable.jobGradeId, ids)));
      moved.positions = Number(r2.rowCount ?? 0);
      const r3 = await tx.update(hrJobTitlesTable).set({ gradeId: targetId })
        .where(and(eq(hrJobTitlesTable.workspaceId, ws), inArray(hrJobTitlesTable.gradeId, ids)));
      moved.jobTitles = Number(r3.rowCount ?? 0);
      for (const sourceId of ids) {
        await tx.update(hrJobGradesTable).set({ code: mergedRetirementCode(sourceId) })
          .where(and(eq(hrJobGradesTable.workspaceId, ws), eq(hrJobGradesTable.id, sourceId)));
      }
    } else if (input.entityType === "job_title") {
      const r1 = await tx.update(employeesTable).set({ jobTitleId: targetId })
        .where(and(eq(employeesTable.workspaceId, ws), inArray(employeesTable.jobTitleId, ids)));
      moved.employees = Number(r1.rowCount ?? 0);
      const r2 = await tx.update(hrPositionsTable).set({ jobTitleId: targetId })
        .where(and(eq(hrPositionsTable.workspaceId, ws), inArray(hrPositionsTable.jobTitleId, ids)));
      moved.positions = Number(r2.rowCount ?? 0);
      for (const sourceId of ids) {
        await tx.update(hrJobTitlesTable).set({ code: mergedRetirementCode(sourceId) })
          .where(and(eq(hrJobTitlesTable.workspaceId, ws), eq(hrJobTitlesTable.id, sourceId)));
      }
    } else if (input.entityType === "org_unit") {
      const r1 = await tx.update(employeesTable).set({ orgUnitId: targetId })
        .where(and(eq(employeesTable.workspaceId, ws), inArray(employeesTable.orgUnitId, ids)));
      moved.employees = Number(r1.rowCount ?? 0);
      const r2 = await tx.update(hrPositionsTable).set({ orgUnitId: targetId })
        .where(and(eq(hrPositionsTable.workspaceId, ws), inArray(hrPositionsTable.orgUnitId, ids)));
      moved.positions = Number(r2.rowCount ?? 0);
      const r3 = await tx.update(hrOrgUnitsTable).set({ parentId: targetId })
        .where(and(eq(hrOrgUnitsTable.workspaceId, ws), inArray(hrOrgUnitsTable.parentId, ids)));
      moved.childOrgUnits = Number(r3.rowCount ?? 0);
      for (const sourceId of ids) {
        await tx.update(hrOrgUnitsTable).set({
          isActive: false,
          code: mergedRetirementCode(sourceId),
        }).where(and(eq(hrOrgUnitsTable.workspaceId, ws), eq(hrOrgUnitsTable.id, sourceId)));
      }
    } else if (input.entityType === "work_location") {
      const r1 = await tx.update(employeesTable).set({ workLocationId: targetId })
        .where(and(eq(employeesTable.workspaceId, ws), inArray(employeesTable.workLocationId, ids)));
      moved.employees = Number(r1.rowCount ?? 0);
      const r2 = await tx.update(hrPositionsTable).set({ workLocationId: targetId })
        .where(and(eq(hrPositionsTable.workspaceId, ws), inArray(hrPositionsTable.workLocationId, ids)));
      moved.positions = Number(r2.rowCount ?? 0);
      for (const sourceId of ids) {
        await tx.update(hrWorkLocationsTable).set({
          isActive: false,
          code: mergedRetirementCode(sourceId),
        }).where(and(eq(hrWorkLocationsTable.workspaceId, ws), eq(hrWorkLocationsTable.id, sourceId)));
      }
    } else {
      const r1 = await tx.update(employeesTable).set({ positionId: targetId })
        .where(and(eq(employeesTable.workspaceId, ws), inArray(employeesTable.positionId, ids)));
      moved.employees = Number(r1.rowCount ?? 0);
      for (const sourceId of ids) {
        await tx.update(hrPositionsTable).set({
          status: "archived",
          isActive: false,
          code: mergedRetirementCode(sourceId),
        }).where(and(eq(hrPositionsTable.workspaceId, ws), eq(hrPositionsTable.id, sourceId)));
      }
    }

    if (aliasPairs.length) {
      for (const pair of aliasPairs) {
        await tx.insert(hrMasterDataAliasesTable).values({
          workspaceId: ws,
          entityType: input.entityType,
          aliasCode: pair.aliasCode,
          canonicalCode: pair.canonicalCode,
          createdByUserId: input.userId ?? null,
        }).onConflictDoNothing();
        aliasesCreated++;
      }
    }
  });

  masterDataCatalogService.invalidateCache(ws);

  return { moved, deactivated: ids.length, aliasesCreated };
}

function normKey(v: string | null | undefined): string {
  return String(v ?? "").trim().toLowerCase();
}

router.get("/hr/foundation/duplicates", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  const workspaceId = req.workspaceId;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

  const entityType = String(req.query.entityType ?? "job_grade");
  try {
    const et = assertEntityType(entityType);
    const groups: Array<{ key: string; ids: number[]; label: string }> = [];

    if (et === "job_grade") {
      const rows = await db.select({ id: hrJobGradesTable.id, code: hrJobGradesTable.code, name: hrJobGradesTable.name })
        .from(hrJobGradesTable).where(eq(hrJobGradesTable.workspaceId, workspaceId));
      const map = new Map<string, { ids: number[]; label: string }>();
      for (const r of rows) {
        const key = normKey(r.code) || `__name__:${normKey(r.name)}`;
        const g = map.get(key) ?? { ids: [], label: r.code || r.name || String(r.id) };
        g.ids.push(r.id);
        map.set(key, g);
      }
      for (const [key, g] of map) {
        if (g.ids.length > 1) groups.push({ key, ids: g.ids, label: g.label });
      }
    } else if (et === "job_title") {
      const rows = await db.select({ id: hrJobTitlesTable.id, code: hrJobTitlesTable.code, name: hrJobTitlesTable.name })
        .from(hrJobTitlesTable).where(eq(hrJobTitlesTable.workspaceId, workspaceId));
      const map = new Map<string, { ids: number[]; label: string }>();
      for (const r of rows) {
        const key = normKey(r.code) || `__name__:${normKey(r.name)}`;
        const g = map.get(key) ?? { ids: [], label: r.code || r.name || String(r.id) };
        g.ids.push(r.id);
        map.set(key, g);
      }
      for (const [key, g] of map) {
        if (g.ids.length > 1) groups.push({ key, ids: g.ids, label: g.label });
      }
    } else if (et === "org_unit") {
      const rows = await db.select({ id: hrOrgUnitsTable.id, code: hrOrgUnitsTable.code, name: hrOrgUnitsTable.name })
        .from(hrOrgUnitsTable).where(eq(hrOrgUnitsTable.workspaceId, workspaceId));
      const map = new Map<string, { ids: number[]; label: string }>();
      for (const r of rows) {
        const key = normKey(r.code) || `__name__:${normKey(r.name)}`;
        const g = map.get(key) ?? { ids: [], label: r.code || r.name || String(r.id) };
        g.ids.push(r.id);
        map.set(key, g);
      }
      for (const [key, g] of map) {
        if (g.ids.length > 1) groups.push({ key, ids: g.ids, label: g.label });
      }
    } else if (et === "work_location") {
      const rows = await db.select({ id: hrWorkLocationsTable.id, code: hrWorkLocationsTable.code, name: hrWorkLocationsTable.name })
        .from(hrWorkLocationsTable).where(eq(hrWorkLocationsTable.workspaceId, workspaceId));
      const map = new Map<string, { ids: number[]; label: string }>();
      for (const r of rows) {
        const key = normKey(r.code) || `__name__:${normKey(r.name)}`;
        const g = map.get(key) ?? { ids: [], label: r.code || r.name || String(r.id) };
        g.ids.push(r.id);
        map.set(key, g);
      }
      for (const [key, g] of map) {
        if (g.ids.length > 1) groups.push({ key, ids: g.ids, label: g.label });
      }
    } else if (et === "position") {
      const rows = await db.select({ id: hrPositionsTable.id, code: hrPositionsTable.code, title: hrPositionsTable.title })
        .from(hrPositionsTable).where(eq(hrPositionsTable.workspaceId, workspaceId));
      const map = new Map<string, { ids: number[]; label: string }>();
      for (const r of rows) {
        const key = normKey(r.code) || `__title__:${normKey(r.title)}`;
        const g = map.get(key) ?? { ids: [], label: r.code || r.title || String(r.id) };
        g.ids.push(r.id);
        map.set(key, g);
      }
      for (const [key, g] of map) {
        if (g.ids.length > 1) groups.push({ key, ids: g.ids, label: g.label });
      }
    }

    res.json({ entityType: et, groups });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Invalid request" });
  }
});

router.post("/hr/foundation/merge", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  const workspaceId = req.workspaceId;
  if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

  try {
    const entityType = assertEntityType(req.body?.entityType);
    const targetId = Number(req.body?.targetId);
    const sourceIdsRaw = toIntList(req.body?.sourceIds);
    const sourceIds = uniqueInts(sourceIdsRaw).filter((id) => id !== targetId);
    const dryRun = req.body?.dryRun !== false;
    const createAliases = req.body?.createAliases !== false;

    if (!Number.isInteger(targetId) || targetId <= 0) { res.status(400).json({ error: "targetId required" }); return; }
    if (!sourceIds.length) { res.status(400).json({ error: "sourceIds required" }); return; }

    await assertMergeEntitiesExist({ workspaceId, entityType, targetId, sourceIds });

    const impact = await computeImpact({ workspaceId, entityType, sourceIds });

    if (dryRun) {
      res.json({ ok: true, dryRun: true, entityType, targetId, sourceIds, impact });
      return;
    }

    const result = await applyMergeTx({
      workspaceId,
      entityType,
      sourceIds,
      targetId,
      userId: req.userId,
      createAliases,
    });

    res.json({ ok: true, dryRun: false, entityType, targetId, sourceIds, ...result, impact });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Invalid request" });
  }
});

export default router;

