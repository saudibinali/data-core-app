import type { OrgUnitNode } from "./types";

export type FlatOrgUnit = {
  id: number;
  workspaceId: number;
  type: string;
  name: string;
  nameAr?: string | null;
  code?: string | null;
  parentId: number | null;
  color?: string;
  displayOrder?: number;
  isActive?: boolean;
};

export function buildOrgTree(units: FlatOrgUnit[]): OrgUnitNode[] {
  const byId = new Map<number, OrgUnitNode>();
  for (const u of units) {
    byId.set(u.id, {
      id: u.id,
      workspaceId: u.workspaceId,
      type: u.type,
      name: u.name,
      nameAr: u.nameAr ?? null,
      code: u.code ?? null,
      parentId: u.parentId,
      color: u.color ?? "#6366f1",
      displayOrder: u.displayOrder ?? 0,
      isActive: u.isActive ?? true,
      children: [],
    });
  }

  const roots: OrgUnitNode[] = [];
  for (const node of byId.values()) {
    if (node.parentId != null && byId.has(node.parentId)) {
      byId.get(node.parentId)!.children!.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortNodes = (nodes: OrgUnitNode[]) => {
    nodes.sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name));
    for (const n of nodes) {
      if (n.children?.length) sortNodes(n.children);
    }
  };
  sortNodes(roots);
  return roots;
}

export function getOrgAncestors(orgUnitId: number, units: FlatOrgUnit[]): FlatOrgUnit[] {
  const byId = new Map(units.map((u) => [u.id, u]));
  const chain: FlatOrgUnit[] = [];
  let current = byId.get(orgUnitId);
  const seen = new Set<number>();

  while (current) {
    if (seen.has(current.id)) break;
    seen.add(current.id);
    chain.unshift(current);
    if (current.parentId == null) break;
    current = byId.get(current.parentId);
  }
  return chain;
}

export function getOrgDescendantIds(orgUnitId: number, units: FlatOrgUnit[]): number[] {
  const childrenByParent = new Map<number | null, number[]>();
  for (const u of units) {
    const list = childrenByParent.get(u.parentId) ?? [];
    list.push(u.id);
    childrenByParent.set(u.parentId, list);
  }

  const result: number[] = [];
  const queue = [...(childrenByParent.get(orgUnitId) ?? [])];
  const seen = new Set<number>([orgUnitId]);

  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
    queue.push(...(childrenByParent.get(id) ?? []));
  }
  return result;
}

/** Returns true when assigning newParentId to orgUnitId would create a cycle. */
export function wouldCreateOrgCycle(
  orgUnitId: number,
  newParentId: number | null,
  units: FlatOrgUnit[],
): boolean {
  if (newParentId == null) return false;
  if (newParentId === orgUnitId) return true;

  const descendants = new Set(getOrgDescendantIds(orgUnitId, units));
  return descendants.has(newParentId);
}
