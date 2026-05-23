/**
 * Phase 3 — Topological dependency ordering (dry-run, no writes).
 */

export type DependencyOrderResult = {
  ordered: string[];
  unresolved: Array<{ id: string; reason: string }>;
  cycles: string[][];
};

export function topologicalSortOrgUnits(
  rows: Array<{ code: string; parentCode?: string | null }>,
): DependencyOrderResult {
  const byCode = new Map(rows.map((r) => [r.code.toLowerCase(), r]));
  const graph = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const row of rows) {
    const code = row.code.toLowerCase();
    graph.set(code, []);
    inDegree.set(code, 0);
  }

  const unresolved: DependencyOrderResult["unresolved"] = [];

  for (const row of rows) {
    const code = row.code.toLowerCase();
    const parent = row.parentCode?.trim().toLowerCase();
    if (parent && parent !== code) {
      if (!byCode.has(parent)) {
        unresolved.push({ id: row.code, reason: `parent_code "${row.parentCode}" not in import batch` });
        continue;
      }
      graph.get(parent)!.push(code);
      inDegree.set(code, (inDegree.get(code) ?? 0) + 1);
    }
  }

  const queue = [...inDegree.entries()].filter(([, d]) => d === 0).map(([k]) => k);
  const ordered: string[] = [];

  while (queue.length) {
    const n = queue.shift()!;
    ordered.push(n);
    for (const child of graph.get(n) ?? []) {
      const d = (inDegree.get(child) ?? 1) - 1;
      inDegree.set(child, d);
      if (d === 0) queue.push(child);
    }
  }

  const cycles: string[][] = [];
  if (ordered.length < rows.length) {
    const remaining = rows.map((r) => r.code.toLowerCase()).filter((c) => !ordered.includes(c));
    if (remaining.length) cycles.push(remaining);
  }

  return { ordered: ordered.map((c) => byCode.get(c)!.code), unresolved, cycles };
}

export function topologicalSortManagers(
  rows: Array<{ employeeNumber: string; managerEmployeeNumber?: string | null }>,
): DependencyOrderResult {
  const byNum = new Map(rows.map((r) => [r.employeeNumber.toLowerCase(), r]));
  const graph = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const row of rows) {
    const num = row.employeeNumber.toLowerCase();
    graph.set(num, []);
    inDegree.set(num, 0);
  }

  const unresolved: DependencyOrderResult["unresolved"] = [];

  for (const row of rows) {
    const num = row.employeeNumber.toLowerCase();
    const mgr = row.managerEmployeeNumber?.trim().toLowerCase();
    if (!mgr || mgr === num) continue;
    if (!byNum.has(mgr)) {
      unresolved.push({ id: row.employeeNumber, reason: `manager "${row.managerEmployeeNumber}" not in batch` });
      continue;
    }
    graph.get(mgr)!.push(num);
    inDegree.set(num, (inDegree.get(num) ?? 0) + 1);
  }

  const queue = [...inDegree.entries()].filter(([, d]) => d === 0).map(([k]) => k);
  const ordered: string[] = [];

  while (queue.length) {
    const n = queue.shift()!;
    ordered.push(n);
    for (const child of graph.get(n) ?? []) {
      const d = (inDegree.get(child) ?? 1) - 1;
      inDegree.set(child, d);
      if (d === 0) queue.push(child);
    }
  }

  const cycles: string[][] = [];
  if (ordered.length < rows.length) {
    const remaining = rows.map((r) => r.employeeNumber.toLowerCase()).filter((c) => !ordered.includes(c));
    if (remaining.length) cycles.push(remaining);
  }

  return {
    ordered: ordered.map((n) => byNum.get(n)!.employeeNumber),
    unresolved,
    cycles,
  };
}

export const MASTER_DATA_IMPORT_ORDER = [
  "job_grade",
  "employment_type",
  "employee_status",
  "contract_type",
  "document_type",
  "work_location",
  "job_title",
  "org_unit",
  "position",
] as const;
