/**
 * HCM Integrated Platform — canonical module keys and ERP exclusion list.
 * Single source for seeds, governance, and smoke tests.
 */

/** Core HCM modules (Wave 1 nucleus). */
export const HCM_CORE_MODULE_KEYS = [
  "hr",
  "payroll",
  "attendance",
  "self-service",
  "report-center",
] as const;

/** HCM-adjacent platform modules required for integrated delivery. */
export const HCM_PROCESS_MODULE_KEYS = ["workflows", "approvals"] as const;

export const HCM_MODULE_KEYS = [...HCM_CORE_MODULE_KEYS, ...HCM_PROCESS_MODULE_KEYS] as const;

/** Removed ERP modules — must not reappear in seed or routes. */
export const ERP_MODULE_KEYS_REMOVED = [
  "finance",
  "procurement",
  "inventory",
  "billing",
] as const;

export type HcmModuleKey = (typeof HCM_MODULE_KEYS)[number];
