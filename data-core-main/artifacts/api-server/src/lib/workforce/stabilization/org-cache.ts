import type { FlatOrgUnit } from "../org-traversal";
import { incrementRuntimeMetric } from "./observability-metrics";

const TTL_MS = 60_000;
const MAX_ENTRIES = 200;

type CacheEntry = { units: FlatOrgUnit[]; expiresAt: number };

const orgUnitCache = new Map<number, CacheEntry>();

export function getCachedOrgUnits(workspaceId: number): FlatOrgUnit[] | null {
  const entry = orgUnitCache.get(workspaceId);
  if (!entry) {
    incrementRuntimeMetric("org.traversal_cache_miss");
    return null;
  }
  if (Date.now() > entry.expiresAt) {
    orgUnitCache.delete(workspaceId);
    incrementRuntimeMetric("org.traversal_cache_miss");
    return null;
  }
  incrementRuntimeMetric("org.traversal_cache_hit");
  return entry.units;
}

export function setCachedOrgUnits(workspaceId: number, units: FlatOrgUnit[]): void {
  if (orgUnitCache.size >= MAX_ENTRIES) {
    const firstKey = orgUnitCache.keys().next().value;
    if (firstKey != null) orgUnitCache.delete(firstKey);
  }
  orgUnitCache.set(workspaceId, { units, expiresAt: Date.now() + TTL_MS });
}

export function invalidateOrgUnitCache(workspaceId?: number): void {
  if (workspaceId != null) orgUnitCache.delete(workspaceId);
  else orgUnitCache.clear();
}
