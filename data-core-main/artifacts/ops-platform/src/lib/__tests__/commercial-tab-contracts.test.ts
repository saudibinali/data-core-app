/**
 * commercial-tab-contracts.test.ts
 *
 * @phase P15-B / Commercial simplification - operational contracts UI
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  canPerformPlatformAction,
  hasPlatformPermissionClient,
  type MinimalPlatformUser,
} from "../platform-access";

const ROOT = resolve(import.meta.dirname, "../..");

function readSrc(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

describe("P15-B - contract permission gating (client)", () => {
  const sales: MinimalPlatformUser = {
    role: "super_admin",
    platformRoleCode: "sales_admin",
    isRootOwner: false,
  };
  const auditor: MinimalPlatformUser = {
    role: "super_admin",
    platformRoleCode: "auditor",
    isRootOwner: false,
  };
  const support: MinimalPlatformUser = {
    role: "super_admin",
    platformRoleCode: "support_admin",
    isRootOwner: false,
  };
  const workspaceSupport: MinimalPlatformUser = {
    role: "super_admin",
    platformRoleCode: "workspace_support",
    isRootOwner: false,
  };

  it("sales_admin can read and update contracts", () => {
    expect(hasPlatformPermissionClient(sales, "commercial.contracts.read")).toBe(true);
    expect(canPerformPlatformAction(sales, "commercial.contracts.update")).toBe(true);
  });

  it("auditor can read but not update contracts", () => {
    expect(hasPlatformPermissionClient(auditor, "commercial.contracts.read")).toBe(true);
    expect(canPerformPlatformAction(auditor, "commercial.contracts.update")).toBe(false);
  });

  it("support_admin can read but not update contracts", () => {
    expect(hasPlatformPermissionClient(support, "commercial.contracts.read")).toBe(true);
    expect(canPerformPlatformAction(support, "commercial.contracts.update")).toBe(false);
  });

  it("workspace_support cannot read or update contracts", () => {
    expect(hasPlatformPermissionClient(workspaceSupport, "commercial.contracts.read")).toBe(false);
    expect(canPerformPlatformAction(workspaceSupport, "commercial.contracts.update")).toBe(false);
  });
});

describe("operational contracts panel (static)", () => {
  const consolePage = readSrc("components/commercial/CommercialConsole.tsx");
  const panel = readSrc("components/commercial/OperationalContractsPanel.tsx");

  it("renders OperationalContractsPanel only when canReadContracts is true", () => {
    expect(consolePage).toContain("canReadContracts &&");
    expect(consolePage).toContain("<OperationalContractsPanel");
  });

  it("passes canWrite to OperationalContractsPanel for action buttons", () => {
    expect(consolePage).toContain("canWrite={canWriteContracts}");
  });

  it("OperationalContractsPanel exposes expected test ids", () => {
    expect(panel).toContain('data-testid="operational-contracts-panel"');
    expect(panel).toContain("Upload new contract");
    expect(panel).toContain("Download PDF");
  });

  it("does not add forbidden billing/payment/invoice UI in contract panel", () => {
    const forbidden = [
      "stripe",
      "checkout",
      "generate invoice",
      "upload invoice",
      "ZATCA",
      "send email",
      "delete contract",
      "payment gateway",
      "change status",
      "billing cycle",
      "currency",
    ];
    const lower = panel.toLowerCase();
    for (const term of forbidden) {
      expect(lower.includes(term), `forbidden term: ${term}`).toBe(false);
    }
  });
});
