/**
 * Phase 5 — Auto-create policy engine.
 */

import type { MasterDataCatalogSnapshot } from "../catalog/master-data-catalog";
import {
  AUTO_CREATE_BLOCKED,
  AUTO_CREATE_ELIGIBLE,
  type EntityPolicy,
  loadWorkspacePolicies,
  resolvePolicyForPilot,
} from "../policy/policy-registry-service";
import { isPilotWorkspaceEnabled } from "../pilot/pilot-workspace-service";
import {
  detectCatalogDuplicate,
  detectCrossFileDuplicates,
  buildDuplicateKey,
} from "./duplicate-prevention";
import { generateCanonicalCode, collectTakenCodes } from "./canonical-code-generator";
import type { ImportRuntimeSettings } from "../runtime-settings";
import { isMasterDataRuntimeAdvanced, isPilotActiveMode } from "../runtime-settings";

export type AutoCreateProposal = {
  rowNumber: number;
  entityType: string;
  proposedName: string;
  proposedNameAr?: string;
  proposedCode: string;
  duplicateKey: string;
  action: "create" | "queue_approval" | "reject" | "skip";
  reason?: string;
  existingId?: number;
  policy: EntityPolicy;
};

export type AutoCreatePreviewResult = {
  proposals: AutoCreateProposal[];
  rejected: number;
  queued: number;
  creatable: number;
  duplicateHits: number;
  pilotRequired: boolean;
  runtimeEnabled: boolean;
};

export class AutoCreatePolicyEngine {
  async evaluatePreview(input: {
    workspaceId: number;
    settings: ImportRuntimeSettings;
    catalog: MasterDataCatalogSnapshot;
    rows: Array<{
      rowNumber: number;
      entityType: string;
      name: string;
      nameAr?: string;
      code?: string;
    }>;
  }): Promise<AutoCreatePreviewResult> {
    const pilotEnabled = await isPilotWorkspaceEnabled(input.workspaceId);
    const runtimeEnabled = isMasterDataRuntimeAdvanced(input.settings)
      || (isPilotActiveMode(input.settings) && pilotEnabled);

    if (!runtimeEnabled) {
      return {
        proposals: [],
        rejected: input.rows.length,
        queued: 0,
        creatable: 0,
        duplicateHits: 0,
        pilotRequired: isPilotActiveMode(input.settings) && !pilotEnabled,
        runtimeEnabled: false,
      };
    }

    const policies = await loadWorkspacePolicies(input.workspaceId);
    const policyByType = new Map(policies.map((p) => [p.entityType, p]));

    const crossFile = detectCrossFileDuplicates(
      input.rows.map((r) => ({
        rowNumber: r.rowNumber,
        entityType: r.entityType,
        code: r.code ?? "",
        name: r.name,
      })),
    );
    const crossFileRows = new Set(crossFile.flatMap((c) => c.rowNumbers));

    const proposals: AutoCreateProposal[] = [];
    let rejected = 0;
    let queued = 0;
    let creatable = 0;
    let duplicateHits = 0;

    for (const row of input.rows) {
      if (AUTO_CREATE_BLOCKED.includes(row.entityType as never)) {
        proposals.push({
          rowNumber: row.rowNumber,
          entityType: row.entityType,
          proposedName: row.name,
          proposedNameAr: row.nameAr,
          proposedCode: row.code ?? "",
          duplicateKey: buildDuplicateKey(row.entityType, row.code ?? "", row.name),
          action: "reject",
          reason: "ENTITY_TYPE_AUTO_CREATE_BLOCKED",
          policy: policyByType.get(row.entityType) ?? {
            entityType: row.entityType,
            autoCreatePolicy: "off",
            autoCreateMode: "disabled",
            approvalRequired: true,
            canonicalStrategy: "slug_from_name",
            duplicateStrategy: "reject",
            reconciliationMode: "report_only",
            isRuntimeSensitive: true,
            autoCreateAllowed: false,
          },
        });
        rejected++;
        continue;
      }

      if (!AUTO_CREATE_ELIGIBLE.includes(row.entityType as never)) {
        rejected++;
        continue;
      }

      const rawPolicy = policyByType.get(row.entityType);
      const policy = resolvePolicyForPilot(
        rawPolicy ?? {
          entityType: row.entityType,
          autoCreatePolicy: "off",
          autoCreateMode: "disabled",
          approvalRequired: true,
          canonicalStrategy: "slug_from_name",
          duplicateStrategy: "reject",
          reconciliationMode: "report_only",
          isRuntimeSensitive: false,
          autoCreateAllowed: false,
        },
        pilotEnabled,
      );

      if (!policy.autoCreateAllowed || policy.autoCreateMode === "disabled") {
        proposals.push({
          rowNumber: row.rowNumber,
          entityType: row.entityType,
          proposedName: row.name,
          proposedCode: row.code ?? "",
          duplicateKey: buildDuplicateKey(row.entityType, row.code ?? "", row.name),
          action: "reject",
          reason: "AUTO_CREATE_DISABLED",
          policy,
        });
        rejected++;
        continue;
      }

      const dup = detectCatalogDuplicate(
        input.catalog,
        row.entityType as never,
        row.code ?? "",
        row.name,
      );

      if (dup.duplicate) {
        duplicateHits++;
        if (policy.duplicateStrategy === "skip") {
          proposals.push({
            rowNumber: row.rowNumber,
            entityType: row.entityType,
            proposedName: row.name,
            proposedCode: row.code ?? "",
            duplicateKey: buildDuplicateKey(row.entityType, row.code ?? "", row.name),
            action: "skip",
            reason: "DUPLICATE_EXISTS",
            existingId: dup.existingId,
            policy,
          });
          continue;
        }
        proposals.push({
          rowNumber: row.rowNumber,
          entityType: row.entityType,
          proposedName: row.name,
          proposedCode: row.code ?? "",
          duplicateKey: buildDuplicateKey(row.entityType, row.code ?? "", row.name),
          action: "reject",
          reason: "DUPLICATE_REJECTED",
          existingId: dup.existingId,
          policy,
        });
        rejected++;
        continue;
      }

      if (crossFileRows.has(row.rowNumber)) {
        duplicateHits++;
        proposals.push({
          rowNumber: row.rowNumber,
          entityType: row.entityType,
          proposedName: row.name,
          proposedCode: row.code ?? "",
          duplicateKey: buildDuplicateKey(row.entityType, row.code ?? "", row.name),
          action: "reject",
          reason: "CROSS_FILE_DUPLICATE",
          policy,
        });
        rejected++;
        continue;
      }

      const taken = collectTakenCodes(input.catalog.entities[row.entityType as keyof typeof input.catalog.entities]);
      const proposedCode = generateCanonicalCode({
        name: row.name,
        explicitCode: row.code,
        policy,
        takenCodes: taken,
      });

      const action = policy.approvalRequired ? "queue_approval" : "create";
      if (action === "queue_approval") queued++;
      else creatable++;

      proposals.push({
        rowNumber: row.rowNumber,
        entityType: row.entityType,
        proposedName: row.name,
        proposedNameAr: row.nameAr,
        proposedCode,
        duplicateKey: buildDuplicateKey(row.entityType, proposedCode, row.name),
        action,
        policy,
      });
    }

    return {
      proposals,
      rejected,
      queued,
      creatable,
      duplicateHits,
      pilotRequired: false,
      runtimeEnabled: true,
    };
  }
}

export const autoCreatePolicyEngine = new AutoCreatePolicyEngine();
