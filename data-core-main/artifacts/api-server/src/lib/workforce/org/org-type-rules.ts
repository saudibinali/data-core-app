import { HR_ORG_UNIT_TYPES } from "../types";

/** Normalize legacy/alias types to canonical values. */
export function normalizeOrgUnitType(type: string): string {
  const t = type.trim().toLowerCase();
  if (t === "unit") return "department";
  return t;
}

export function isValidOrgUnitType(type: string): boolean {
  return (HR_ORG_UNIT_TYPES as readonly string[]).includes(normalizeOrgUnitType(type));
}

/** Allowed parent types for a child org unit type (null parent = root). */
const PARENT_RULES: Record<string, string[] | null> = {
  company: null, // root only
  branch: ["company", "division"],
  division: ["company", "branch"],
  department: ["company", "branch", "division"],
  team: ["department", "division"],
  unit: ["company", "branch", "division"],
};

export function validateOrgParentType(
  childType: string,
  parentType: string | null,
): { ok: true } | { ok: false; error: string } {
  const child = normalizeOrgUnitType(childType);
  if (!isValidOrgUnitType(child)) {
    return { ok: false, error: `Invalid org unit type: ${childType}` };
  }

  const allowed = PARENT_RULES[child];
  if (allowed === null) {
    if (parentType != null) {
      return { ok: false, error: `${child} must be a root org unit (no parent)` };
    }
    return { ok: true };
  }

  if (parentType == null) {
    return { ok: false, error: `${child} requires a parent org unit` };
  }

  const parent = normalizeOrgUnitType(parentType);
  if (!allowed.includes(parent)) {
    return {
      ok: false,
      error: `${child} cannot be placed under parent type "${parent}". Allowed: ${allowed.join(", ")}`,
    };
  }
  return { ok: true };
}
