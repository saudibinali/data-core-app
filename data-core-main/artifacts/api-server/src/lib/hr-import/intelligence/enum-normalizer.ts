/**
 * Enterprise HR import — human-friendly enum normalization (not strict machine codes).
 */

import { normalizeName, normalizeRuntimeKey } from "../normalization";
import type { DynamicEnumLoadResult } from "../catalog/dynamic-enum-loader";

export type EnumField = "employment_type" | "employee_status" | "gender" | "marital_status";

export type EnumResolveResult = {
  field: EnumField;
  original: string;
  canonical: string | null;
  autoFixed: boolean;
  matchType: "exact_code" | "normalized_code" | "display_name" | "alias" | "arabic" | "none";
};

const STATIC_ALIASES: Record<EnumField, Record<string, string>> = {
  employment_type: {
    "full time": "full_time",
    "fulltime": "full_time",
    "full-time": "full_time",
    "part time": "part_time",
    "parttime": "part_time",
    "part-time": "part_time",
    contractor: "contractor",
    intern: "intern",
    internship: "intern",
    temporary: "temporary",
    temp: "temporary",
    "دوام كامل": "full_time",
    "دوام جزئي": "part_time",
    جزئي: "part_time",
    كامل: "full_time",
    متعاقد: "contractor",
    متدرب: "intern",
    مؤقت: "temporary",
  },
  employee_status: {
    active: "active",
    inactive: "terminated",
    "on leave": "on_leave",
    onleave: "on_leave",
    "on-leave": "on_leave",
    suspended: "suspended",
    terminated: "terminated",
    resigned: "resigned",
    نشط: "active",
    "في إجازة": "on_leave",
    "في اجازة": "on_leave",
    موقوف: "suspended",
    "منتهي الخدمة": "terminated",
    مستقيل: "resigned",
  },
  gender: {
    male: "male",
    m: "male",
    man: "male",
    female: "female",
    f: "female",
    woman: "female",
    ذكر: "male",
    أنثى: "female",
    انثى: "female",
    انثي: "female",
  },
  marital_status: {
    single: "single",
    married: "married",
    divorced: "divorced",
    widowed: "widowed",
    أعزب: "single",
    عزباء: "single",
    متزوج: "married",
    متزوجة: "married",
    مطلق: "divorced",
    مطلقة: "divorced",
    أرمل: "widowed",
    أرملة: "widowed",
  },
};

function aliasKeys(value: string): string[] {
  const raw = value.trim();
  const keys = new Set<string>();
  if (raw) keys.add(normalizeName(raw));
  keys.add(normalizeRuntimeKey(raw).replace(/_/g, " "));
  keys.add(normalizeRuntimeKey(raw));
  keys.add(raw.toLowerCase().replace(/[\s_-]+/g, " ").trim());
  return [...keys].filter(Boolean);
}

function indexDynamicEnum(catalog: DynamicEnumLoadResult): Map<string, string> {
  const map = new Map<string, string>();
  for (const code of catalog.codes) {
    map.set(normalizeRuntimeKey(code), code);
    map.set(code.toLowerCase(), code);
  }
  for (const item of catalog.items) {
    if (item.code) {
      map.set(normalizeRuntimeKey(item.code), item.code);
      map.set(item.code.toLowerCase(), item.code);
    }
    map.set(normalizeName(item.name), item.code);
    if (item.nameAr) map.set(normalizeName(item.nameAr), item.code);
    map.set(normalizeRuntimeKey(item.name), item.code);
  }
  return map;
}

export function resolveImportEnum(
  field: EnumField,
  rawValue: string,
  catalog?: DynamicEnumLoadResult,
): EnumResolveResult {
  const original = rawValue?.trim() ?? "";
  if (!original) {
    return { field, original, canonical: null, autoFixed: false, matchType: "none" };
  }

  const dynamicIndex = catalog ? indexDynamicEnum(catalog) : new Map<string, string>();
  const staticAliases = STATIC_ALIASES[field];

  for (const key of aliasKeys(original)) {
    if (dynamicIndex.has(key)) {
      const canonical = dynamicIndex.get(key)!;
      return {
        field,
        original,
        canonical,
        autoFixed: canonical !== original,
        matchType: key === normalizeRuntimeKey(original) ? "normalized_code" : "display_name",
      };
    }
    if (staticAliases[key]) {
      const canonical = staticAliases[key];
      return {
        field,
        original,
        canonical,
        autoFixed: canonical !== original,
        matchType: /[\u0600-\u06FF]/.test(original) ? "arabic" : "alias",
      };
    }
  }

  if (catalog?.codes.has(original)) {
    return { field, original, canonical: original, autoFixed: false, matchType: "exact_code" };
  }

  const normalized = normalizeRuntimeKey(original);
  if (catalog?.codes.has(normalized)) {
    return { field, original, canonical: normalized, autoFixed: true, matchType: "normalized_code" };
  }

  return { field, original, canonical: null, autoFixed: false, matchType: "none" };
}

export function defaultEnumValue(field: EnumField): string {
  switch (field) {
    case "employment_type":
      return "full_time";
    case "employee_status":
      return "active";
    case "gender":
      return "";
    case "marital_status":
      return "";
    default:
      return "";
  }
}
