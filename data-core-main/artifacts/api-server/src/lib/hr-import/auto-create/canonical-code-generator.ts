/**
 * Phase 5 — Canonical code generation for auto-create.
 */

import { canonicalSlug, uniquifyRuntimeCode } from "../normalization";
import type { EntityPolicy } from "../policy/policy-registry-service";

export function generateCanonicalCode(input: {
  name: string;
  explicitCode?: string;
  policy: EntityPolicy;
  takenCodes: Set<string>;
}): string {
  if (input.policy.canonicalStrategy === "explicit_code" && input.explicitCode?.trim()) {
    const code = canonicalSlug(input.explicitCode);
    return uniquifyRuntimeCode(code, input.takenCodes);
  }

  const base = canonicalSlug(input.name);
  return uniquifyRuntimeCode(base, input.takenCodes);
}

export function collectTakenCodes(
  catalogEntries: Array<{ code?: string | null }> | undefined,
): Set<string> {
  const taken = new Set<string>();
  for (const e of catalogEntries ?? []) {
    if (e.code) taken.add(String(e.code).toLowerCase());
  }
  return taken;
}
