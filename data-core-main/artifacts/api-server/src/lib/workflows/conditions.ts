import type { ConditionGroup, WorkflowCondition } from "./types";

function getFieldValue(data: Record<string, unknown>, field: string): unknown {
  const parts = field.split(".");
  let current: unknown = data;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function evaluateSingle(condition: WorkflowCondition, data: Record<string, unknown>): boolean {
  const actual = getFieldValue(data, condition.field);
  const expected = condition.value;

  switch (condition.operator) {
    case "eq":          return actual === expected;
    case "neq":         return actual !== expected;
    case "gt":          return typeof actual === "number" && typeof expected === "number" && actual > expected;
    case "lt":          return typeof actual === "number" && typeof expected === "number" && actual < expected;
    case "gte":         return typeof actual === "number" && typeof expected === "number" && actual >= expected;
    case "lte":         return typeof actual === "number" && typeof expected === "number" && actual <= expected;
    case "contains":    return typeof actual === "string" && typeof expected === "string" && actual.includes(expected);
    case "not_contains":return typeof actual === "string" && typeof expected === "string" && !actual.includes(expected);
    case "in":          return Array.isArray(expected) && expected.includes(actual);
    case "not_in":      return Array.isArray(expected) && !expected.includes(actual);
    case "exists":      return actual !== undefined && actual !== null;
    default:            return false;
  }
}

export function evaluateConditions(
  group: ConditionGroup | null | undefined,
  data: Record<string, unknown>,
): boolean {
  if (!group || group.conditions.length === 0) return true;

  if (group.logic === "and") {
    return group.conditions.every((c) => evaluateSingle(c, data));
  }
  return group.conditions.some((c) => evaluateSingle(c, data));
}
