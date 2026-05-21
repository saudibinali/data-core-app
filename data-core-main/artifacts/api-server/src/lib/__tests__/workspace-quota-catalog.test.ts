/**
 * @phase P16-C - Quota catalog
 */

import { describe, it, expect } from "vitest";
import {
  QUOTA_CATALOG,
  QUOTA_KEYS,
  isQuotaKey,
  buildQuotaCatalogPayload,
} from "../workspace-quota-catalog";

const REQUIRED_KEYS = [
  "users.max",
  "employees.max",
  "branches.max",
  "storage.gb",
  "documents.max",
  "workflows.max",
  "integrations.max",
  "api.requests.monthly",
  "ai.actions.monthly",
  "reports.max",
  "custom.roles.max",
];

describe("workspace-quota-catalog", () => {
  it("contains all required quota keys", () => {
    for (const key of REQUIRED_KEYS) {
      expect(QUOTA_KEYS).toContain(key);
      expect(isQuotaKey(key)).toBe(true);
    }
    expect(QUOTA_CATALOG.length).toBe(REQUIRED_KEYS.length);
  });

  it("each entry has catalog fields", () => {
    for (const q of QUOTA_CATALOG) {
      expect(q.label).toBeTruthy();
      expect(q.unit).toMatch(/^(count|gb|requests|actions)$/);
      expect(q.defaultLimit).toBeGreaterThanOrEqual(0);
      expect(q.warningThresholdPercent).toBeGreaterThanOrEqual(1);
      expect(q.warningThresholdPercent).toBeLessThanOrEqual(100);
      expect(typeof q.hardLimitSupported).toBe("boolean");
    }
  });

  it("buildQuotaCatalogPayload returns quotas array", () => {
    const payload = buildQuotaCatalogPayload();
    expect(payload.quotas.length).toBe(QUOTA_CATALOG.length);
    expect(payload.sources.length).toBeGreaterThan(0);
  });
});
