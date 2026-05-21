// Mirrors the EventFieldDef / EventSchema types defined in the server registry.
// No codegen needed - the OpenAPI schema field is already typed as `object`.
// We cast and parse the JSONB at runtime on the frontend.

export type FieldType = "text" | "number" | "boolean" | "enum" | "user" | "department" | "date";

export type Operator =
  | "eq" | "neq"
  | "gt" | "gte" | "lt" | "lte"
  | "contains" | "starts_with"
  | "in" | "not_in";

export interface EnumValue {
  value: string;
  label: string;
  labelAr: string;
}

export interface EventFieldDef {
  name: string;
  label: string;
  labelAr: string;
  type: FieldType;
  operators: Operator[];
  enumValues?: EnumValue[];
  description?: string;
}

export interface EventSchema {
  fields: EventFieldDef[];
}

// ── Operator labels ───────────────────────────────────────────────────────────
export const OPERATOR_LABELS: Record<Operator, { label: string; labelAr: string }> = {
  eq:          { label: "equals",          labelAr: "يساوي" },
  neq:         { label: "not equals",      labelAr: "لا يساوي" },
  gt:          { label: "greater than",    labelAr: "أكبر من" },
  gte:         { label: "at least",        labelAr: "أكبر من أو يساوي" },
  lt:          { label: "less than",       labelAr: "أصغر من" },
  lte:         { label: "at most",         labelAr: "أصغر من أو يساوي" },
  contains:    { label: "contains",        labelAr: "يحتوي على" },
  starts_with: { label: "starts with",    labelAr: "يبدأ بـ" },
  in:          { label: "is one of",       labelAr: "ضمن القيم" },
  not_in:      { label: "is not one of",   labelAr: "خارج القيم" },
};

// ── Parse schema from JSONB ───────────────────────────────────────────────────
export function parseEventSchema(raw: unknown): EventSchema | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj["fields"])) return null;
  return raw as EventSchema;
}
