import { describe, expect, it } from "vitest";
import {
  buildOrgTree,
  getOrgAncestors,
  getOrgDescendantIds,
  wouldCreateOrgCycle,
} from "../org-traversal";

const units = [
  { id: 1, workspaceId: 1, type: "company", name: "Acme", parentId: null },
  { id: 2, workspaceId: 1, type: "branch", name: "Riyadh", parentId: 1 },
  { id: 3, workspaceId: 1, type: "department", name: "IT", parentId: 2 },
  { id: 4, workspaceId: 1, type: "team", name: "Platform", parentId: 3 },
];

describe("org-traversal", () => {
  it("builds nested tree with sorted children", () => {
    const tree = buildOrgTree(units);
    expect(tree).toHaveLength(1);
    expect(tree[0]!.id).toBe(1);
    expect(tree[0]!.children![0]!.id).toBe(2);
    expect(tree[0]!.children![0]!.children![0]!.id).toBe(3);
  });

  it("returns ancestor chain root-to-leaf", () => {
    const chain = getOrgAncestors(4, units);
    expect(chain.map((u) => u.id)).toEqual([1, 2, 3, 4]);
  });

  it("returns descendant ids", () => {
    expect(getOrgDescendantIds(2, units).sort()).toEqual([3, 4]);
  });

  it("detects hierarchy cycles", () => {
    expect(wouldCreateOrgCycle(3, 4, units)).toBe(true);
    expect(wouldCreateOrgCycle(3, 1, units)).toBe(false);
    expect(wouldCreateOrgCycle(3, 3, units)).toBe(true);
  });
});
