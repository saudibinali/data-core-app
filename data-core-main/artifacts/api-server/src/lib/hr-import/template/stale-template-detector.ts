/**
 * Phase 2 — Stale template detection foundation.
 */

import { HrImportTemplateRegistryV2 } from "./template-registry-v2";

export type StaleTemplateCheck = {
  stale: boolean;
  reason?: string;
  currentVersion?: string;
  providedVersion?: string;
};

export function detectStaleTemplate(
  templateKey: string,
  providedVersion?: string,
  generatedAt?: string,
): StaleTemplateCheck {
  const def = HrImportTemplateRegistryV2.get(templateKey);
  if (!def) {
    return { stale: true, reason: "UNKNOWN_TEMPLATE_KEY", providedVersion };
  }
  if (!providedVersion) {
    return { stale: true, reason: "MISSING_TEMPLATE_VERSION", currentVersion: def.version };
  }
  if (providedVersion !== def.version) {
    return {
      stale: true,
      reason: "VERSION_MISMATCH",
      currentVersion: def.version,
      providedVersion,
    };
  }
  if (HrImportTemplateRegistryV2.isStale(providedVersion, templateKey, generatedAt)) {
    return { stale: true, reason: "AGE_EXCEEDED", currentVersion: def.version, providedVersion };
  }
  return { stale: false, currentVersion: def.version, providedVersion };
}
