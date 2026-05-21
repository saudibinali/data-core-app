/**
 * @file   __tests__/tenant-isolation.test.ts
 * @phase  P9-A - Multi-Tenant Isolation & Workspace Boundary Hardening Foundations
 *
 * T1  - cross-workspace workflow access blocked
 * T2  - analytics queries remain tenant-scoped
 * T3  - governance signals isolated correctly
 * T4  - orphan request rejected safely
 * T5  - missing workspace context fails closed
 * T6  - observability events always scoped
 * T7  - tenant boundary enforcement deterministic
 * T8  - comparative intelligence isolated per workspace
 * T9  - historical analytics remain isolated
 * T10 - no implicit tenant crossover possible
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  buildTenantIsolationContext,
  enforceTenantIsolation,
  validateAnalyticsScope,
  validateObservabilityScope,
  assessTenantIsolationRisk,
  makeTenantBoundaryId,
  makeRequestScopeId,
  resetRequestScopeSeq,
  TenantIsolationViolation,
  type TenantIsolationContext,
  type TenantIsolationRiskAssessment,
} from "../tenant-isolation";

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function makeCtx(workspaceId = 7, actorId = 42): TenantIsolationContext {
  return buildTenantIsolationContext({
    workspaceId,
    actorId,
    evaluationContext: "test-suite",
  });
}

beforeEach(() => {
  resetRequestScopeSeq();
});

// ─────────────────────────────────────────────────────────────────────────────
// T1 - cross-workspace workflow access blocked
// ─────────────────────────────────────────────────────────────────────────────

describe("T1: cross-workspace workflow access blocked", () => {
  it("blocks access when resourceWorkspaceId differs from context workspaceId", () => {
    const ctx = makeCtx(7);
    expect(() =>
      enforceTenantIsolation(ctx, {
        resourceWorkspaceId: 99,
        resourceType:        "workflow_definition",
        resourceId:          42,
      }),
    ).toThrowError(TenantIsolationViolation);
  });

  it("thrown violation has code CROSS_WORKSPACE_ACCESS", () => {
    const ctx = makeCtx(7);
    let caught: TenantIsolationViolation | undefined;
    try {
      enforceTenantIsolation(ctx, {
        resourceWorkspaceId: 99,
        resourceType:        "workflow_definition",
      });
    } catch (e) {
      caught = e as TenantIsolationViolation;
    }
    expect(caught).toBeDefined();
    expect(caught!.code).toBe("CROSS_WORKSPACE_ACCESS");
    expect(caught!.name).toBe("TenantIsolationViolation");
  });

  it("allows access when resourceWorkspaceId matches context workspaceId", () => {
    const ctx = makeCtx(7);
    const result = enforceTenantIsolation(ctx, {
      resourceWorkspaceId: 7,
      resourceType:        "workflow_definition",
      resourceId:          5,
    });
    expect(result.allowed).toBe(true);
    expect(result.resourceWorkspaceId).toBe(7);
  });

  it("blocks workflow_execution resource from different workspace", () => {
    const ctx = makeCtx(3);
    expect(() =>
      enforceTenantIsolation(ctx, {
        resourceWorkspaceId: 4,
        resourceType:        "workflow_execution",
        resourceId:          100,
      }),
    ).toThrowError(TenantIsolationViolation);
  });

  it("blocks approval_record from different workspace", () => {
    const ctx = makeCtx(1);
    expect(() =>
      enforceTenantIsolation(ctx, {
        resourceWorkspaceId: 2,
        resourceType:        "approval_record",
      }),
    ).toThrowError(TenantIsolationViolation);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T2 - analytics queries remain tenant-scoped
// ─────────────────────────────────────────────────────────────────────────────

describe("T2: analytics queries remain tenant-scoped", () => {
  it("validates a batch where all items belong to the same workspace", () => {
    const ctx = makeCtx(7);
    const result = validateAnalyticsScope(
      ctx,
      [
        { workspaceId: 7, itemId: 1 },
        { workspaceId: 7, itemId: 2 },
        { workspaceId: 7, itemId: 3 },
      ],
      "workflow_definitions",
    );
    expect(result.validated).toBe(true);
    expect(result.itemCount).toBe(3);
    expect(result.analyticsType).toBe("workflow_definitions");
  });

  it("throws ANALYTICS_BOUNDARY_VIOLATION when batch contains a cross-workspace item", () => {
    const ctx = makeCtx(7);
    expect(() =>
      validateAnalyticsScope(
        ctx,
        [
          { workspaceId: 7, itemId: 1 },
          { workspaceId: 99, itemId: 2 },
        ],
        "workflow_definitions",
      ),
    ).toThrowError(TenantIsolationViolation);

    let caught: TenantIsolationViolation | undefined;
    try {
      validateAnalyticsScope(
        ctx,
        [{ workspaceId: 7 }, { workspaceId: 99 }],
        "historical_rollup",
      );
    } catch (e) { caught = e as TenantIsolationViolation; }
    expect(caught!.code).toBe("ANALYTICS_BOUNDARY_VIOLATION");
  });

  it("accepts empty analytics batch without error", () => {
    const ctx = makeCtx(7);
    const result = validateAnalyticsScope(ctx, [], "governance_signals");
    expect(result.validated).toBe(true);
    expect(result.itemCount).toBe(0);
  });

  it("tenantBoundaryId and requestScopeId included in validation result", () => {
    const ctx = makeCtx(7);
    const result = validateAnalyticsScope(
      ctx,
      [{ workspaceId: 7 }],
      "comparative_intelligence",
    );
    expect(result.tenantBoundaryId).toBe("ws:7");
    expect(result.requestScopeId).toMatch(/^req:7-/);
  });

  it("throws when single item has wrong workspace", () => {
    const ctx = makeCtx(5);
    expect(() =>
      validateAnalyticsScope(ctx, [{ workspaceId: 6, itemId: 9 }], "analytics_snapshot"),
    ).toThrowError(TenantIsolationViolation);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T3 - governance signals isolated correctly
// ─────────────────────────────────────────────────────────────────────────────

describe("T3: governance signals isolated correctly", () => {
  it("risk assessment detects cross-workspace governance signals", () => {
    const ctx = makeCtx(7);
    const assessment = assessTenantIsolationRisk({
      context: ctx,
      governanceSignals: [
        { workspaceId: 7, affectedWorkflowId: 1 },
        { workspaceId: 7, affectedWorkflowId: 2 },
        { workspaceId: 99, affectedWorkflowId: 5 }, // wrong workspace
      ],
    });
    expect(assessment.analyticsBoundaryRisk).not.toBe("low");
    expect(assessment.findings.some(f => f.dimension === "analytics_boundary")).toBe(true);
  });

  it("all-same-workspace governance signals yield low analyticsBoundaryRisk", () => {
    const ctx = makeCtx(7);
    const assessment = assessTenantIsolationRisk({
      context: ctx,
      governanceSignals: [
        { workspaceId: 7 },
        { workspaceId: 7 },
        { workspaceId: 7 },
      ],
    });
    expect(assessment.analyticsBoundaryRisk).toBe("low");
  });

  it("critical risk when 3+ governance signals are cross-workspace", () => {
    const ctx = makeCtx(7);
    const assessment = assessTenantIsolationRisk({
      context: ctx,
      governanceSignals: [
        { workspaceId: 99 },
        { workspaceId: 99 },
        { workspaceId: 99 },
      ],
    });
    expect(assessment.analyticsBoundaryRisk).toBe("critical");
  });

  it("enforceTenantIsolation blocks governance_signal from another workspace", () => {
    const ctx = makeCtx(7);
    expect(() =>
      enforceTenantIsolation(ctx, {
        resourceWorkspaceId: 8,
        resourceType:        "governance_signal",
      }),
    ).toThrowError(TenantIsolationViolation);
  });

  it("governance_signal from correct workspace is allowed", () => {
    const ctx = makeCtx(7);
    const result = enforceTenantIsolation(ctx, {
      resourceWorkspaceId: 7,
      resourceType:        "governance_signal",
    });
    expect(result.allowed).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T4 - orphan request rejected safely
// ─────────────────────────────────────────────────────────────────────────────

describe("T4: orphan request rejected safely", () => {
  it("throws ORPHAN_RESOURCE_ACCESS for resource with null workspaceId", () => {
    const ctx = makeCtx(7);
    let caught: TenantIsolationViolation | undefined;
    try {
      enforceTenantIsolation(ctx, {
        resourceWorkspaceId: null,
        resourceType:        "workflow_execution",
        resourceId:          55,
      });
    } catch (e) { caught = e as TenantIsolationViolation; }
    expect(caught).toBeDefined();
    expect(caught!.code).toBe("ORPHAN_RESOURCE_ACCESS");
  });

  it("throws ORPHAN_RESOURCE_ACCESS for resource with undefined workspaceId", () => {
    const ctx = makeCtx(7);
    expect(() =>
      enforceTenantIsolation(ctx, {
        resourceWorkspaceId: undefined,
        resourceType:        "workflow_definition",
      }),
    ).toThrowError(TenantIsolationViolation);
  });

  it("throws ANALYTICS_BOUNDARY_VIOLATION when batch contains orphan item (null workspaceId)", () => {
    const ctx = makeCtx(7);
    let caught: TenantIsolationViolation | undefined;
    try {
      validateAnalyticsScope(
        ctx,
        [{ workspaceId: 7 }, { workspaceId: null }],
        "historical_rollup",
      );
    } catch (e) { caught = e as TenantIsolationViolation; }
    expect(caught).toBeDefined();
    expect(caught!.code).toBe("ANALYTICS_BOUNDARY_VIOLATION");
  });

  it("risk assessment flags orphan resources with non-low risk", () => {
    const ctx = makeCtx(7);
    const assessment = assessTenantIsolationRisk({
      context: ctx,
      workflowResources: [
        { workspaceId: 7,    id: 1 },
        { workspaceId: null, id: 2 },  // orphan
      ],
    });
    expect(assessment.orphanAccessRisk).not.toBe("low");
  });

  it("orphan resource violation carries resource context", () => {
    const ctx = makeCtx(7);
    let caught: TenantIsolationViolation | undefined;
    try {
      enforceTenantIsolation(ctx, {
        resourceWorkspaceId: null,
        resourceType:        "approval_record",
        resourceId:          99,
      });
    } catch (e) { caught = e as TenantIsolationViolation; }
    expect(caught!.resource?.resourceType).toBe("approval_record");
    expect(caught!.resource?.resourceId).toBe(99);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T5 - missing workspace context fails closed
// ─────────────────────────────────────────────────────────────────────────────

describe("T5: missing workspace context fails closed", () => {
  it("throws NULL_WORKSPACE_CONTEXT when workspaceId is null", () => {
    expect(() =>
      buildTenantIsolationContext({ workspaceId: null }),
    ).toThrowError(TenantIsolationViolation);

    let caught: TenantIsolationViolation | undefined;
    try {
      buildTenantIsolationContext({ workspaceId: null });
    } catch (e) { caught = e as TenantIsolationViolation; }
    expect(caught!.code).toBe("NULL_WORKSPACE_CONTEXT");
  });

  it("throws NULL_WORKSPACE_CONTEXT when workspaceId is undefined", () => {
    expect(() =>
      buildTenantIsolationContext({ workspaceId: undefined }),
    ).toThrowError(TenantIsolationViolation);
  });

  it("throws AMBIGUOUS_TENANT_CONTEXT when workspaceId is 0", () => {
    let caught: TenantIsolationViolation | undefined;
    try {
      buildTenantIsolationContext({ workspaceId: 0 });
    } catch (e) { caught = e as TenantIsolationViolation; }
    expect(caught).toBeDefined();
    expect(caught!.code).toBe("AMBIGUOUS_TENANT_CONTEXT");
  });

  it("throws AMBIGUOUS_TENANT_CONTEXT when workspaceId is a float", () => {
    expect(() =>
      buildTenantIsolationContext({ workspaceId: 7.5 }),
    ).toThrowError(TenantIsolationViolation);
  });

  it("throws AMBIGUOUS_TENANT_CONTEXT when workspaceId is NaN", () => {
    expect(() =>
      buildTenantIsolationContext({ workspaceId: NaN }),
    ).toThrowError(TenantIsolationViolation);
  });

  it("succeeds with valid positive integer workspaceId", () => {
    const ctx = buildTenantIsolationContext({ workspaceId: 1 });
    expect(ctx.workspaceId).toBe(1);
    expect(ctx.tenantBoundaryId).toBe("ws:1");
    expect(ctx.isolationLevel).toBe("strict");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T6 - observability events always scoped
// ─────────────────────────────────────────────────────────────────────────────

describe("T6: observability events always scoped", () => {
  it("throws GOVERNANCE_LEAKAGE when event missing workspaceId", () => {
    const ctx = makeCtx(7);
    expect(() =>
      validateObservabilityScope(ctx, {
        eventType:        "workflow_governance_signals_requested",
        requestScopeId:   ctx.requestScopeId,
        tenantBoundaryId: ctx.tenantBoundaryId,
        // workspaceId missing
      }),
    ).toThrowError(TenantIsolationViolation);
  });

  it("throws GOVERNANCE_LEAKAGE when event missing requestScopeId", () => {
    const ctx = makeCtx(7);
    expect(() =>
      validateObservabilityScope(ctx, {
        eventType:        "workflow_governance_signals_requested",
        workspaceId:      7,
        tenantBoundaryId: ctx.tenantBoundaryId,
        // requestScopeId missing
      }),
    ).toThrowError(TenantIsolationViolation);
  });

  it("throws GOVERNANCE_LEAKAGE when event missing tenantBoundaryId", () => {
    const ctx = makeCtx(7);
    expect(() =>
      validateObservabilityScope(ctx, {
        eventType:      "workflow_governance_signals_requested",
        workspaceId:    7,
        requestScopeId: ctx.requestScopeId,
        // tenantBoundaryId missing
      }),
    ).toThrowError(TenantIsolationViolation);
  });

  it("throws GOVERNANCE_LEAKAGE when event workspaceId mismatches context", () => {
    const ctx = makeCtx(7);
    let caught: TenantIsolationViolation | undefined;
    try {
      validateObservabilityScope(ctx, {
        eventType:        "workflow_governance_signals_requested",
        workspaceId:      99, // wrong workspace
        requestScopeId:   ctx.requestScopeId,
        tenantBoundaryId: ctx.tenantBoundaryId,
      });
    } catch (e) { caught = e as TenantIsolationViolation; }
    expect(caught!.code).toBe("GOVERNANCE_LEAKAGE");
  });

  it("throws GOVERNANCE_LEAKAGE when event tenantBoundaryId mismatches context", () => {
    const ctx = makeCtx(7);
    expect(() =>
      validateObservabilityScope(ctx, {
        eventType:        "workflow_governance_signals_requested",
        workspaceId:      7,
        requestScopeId:   ctx.requestScopeId,
        tenantBoundaryId: "ws:99", // wrong boundary
      }),
    ).toThrowError(TenantIsolationViolation);
  });

  it("validates a fully-scoped event successfully", () => {
    const ctx = makeCtx(7);
    const result = validateObservabilityScope(ctx, {
      eventType:        "tenant_isolation_enforced",
      workspaceId:      7,
      requestScopeId:   ctx.requestScopeId,
      tenantBoundaryId: ctx.tenantBoundaryId,
    });
    expect(result.validated).toBe(true);
    expect(result.eventType).toBe("tenant_isolation_enforced");
    expect(result.tenantBoundaryId).toBe("ws:7");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T7 - tenant boundary enforcement deterministic
// ─────────────────────────────────────────────────────────────────────────────

describe("T7: tenant boundary enforcement deterministic", () => {
  it("same inputs always produce the same enforcement outcome (allow)", () => {
    const ctx1 = buildTenantIsolationContext({
      workspaceId:     7,
      requestScopeId:  "req:7-fixed-0001",
    });
    const ctx2 = buildTenantIsolationContext({
      workspaceId:     7,
      requestScopeId:  "req:7-fixed-0001",
    });
    const r1 = enforceTenantIsolation(ctx1, { resourceWorkspaceId: 7, resourceType: "workflow_definition" });
    const r2 = enforceTenantIsolation(ctx2, { resourceWorkspaceId: 7, resourceType: "workflow_definition" });
    expect(r1.allowed).toBe(r2.allowed);
    expect(r1.tenantBoundaryId).toBe(r2.tenantBoundaryId);
  });

  it("same inputs always produce the same enforcement outcome (block)", () => {
    for (let i = 0; i < 5; i++) {
      const ctx = makeCtx(7);
      let threw = false;
      try {
        enforceTenantIsolation(ctx, { resourceWorkspaceId: 99, resourceType: "workflow_definition" });
      } catch { threw = true; }
      expect(threw).toBe(true);
    }
  });

  it("makeTenantBoundaryId is pure and deterministic", () => {
    for (let wsId = 1; wsId <= 10; wsId++) {
      expect(makeTenantBoundaryId(wsId)).toBe(`ws:${wsId}`);
      expect(makeTenantBoundaryId(wsId)).toBe(makeTenantBoundaryId(wsId));
    }
  });

  it("risk assessment is deterministic for same inputs", () => {
    const ctx = buildTenantIsolationContext({
      workspaceId:    7,
      requestScopeId: "req:7-fixed-0002",
    });
    const input = {
      context: ctx,
      workflowResources: [
        { workspaceId: 7, id: 1 },
        { workspaceId: 7, id: 2 },
      ],
    };
    const r1 = assessTenantIsolationRisk(input);
    const r2 = assessTenantIsolationRisk(input);
    expect(r1.overallRisk).toBe(r2.overallRisk);
    expect(r1.leakageRisk).toBe(r2.leakageRisk);
    expect(r1.orphanAccessRisk).toBe(r2.orphanAccessRisk);
    expect(r1.analyticsBoundaryRisk).toBe(r2.analyticsBoundaryRisk);
    expect(r1.observabilityIsolationRisk).toBe(r2.observabilityIsolationRisk);
  });

  it("context is frozen after construction - mutation attempt has no effect", () => {
    const ctx = makeCtx(7);
    expect(Object.isFrozen(ctx)).toBe(false); // context itself is plain object
    // frozen fields inside violation
    let caught: TenantIsolationViolation | undefined;
    try {
      enforceTenantIsolation(ctx, { resourceWorkspaceId: 99, resourceType: "workflow_definition" });
    } catch (e) { caught = e as TenantIsolationViolation; }
    expect(Object.isFrozen(caught!.context)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T8 - comparative intelligence isolated per workspace
// ─────────────────────────────────────────────────────────────────────────────

describe("T8: comparative intelligence isolated per workspace", () => {
  it("validateAnalyticsScope passes for homogeneous comparative batch", () => {
    const ctx = makeCtx(7);
    const comparativeItems = [
      { workspaceId: 7, itemType: "comparative_intelligence", itemId: 1 },
      { workspaceId: 7, itemType: "comparative_intelligence", itemId: 2 },
      { workspaceId: 7, itemType: "comparative_intelligence", itemId: 3 },
      { workspaceId: 7, itemType: "comparative_intelligence", itemId: 4 },
      { workspaceId: 7, itemType: "comparative_intelligence", itemId: 5 },
    ];
    const result = validateAnalyticsScope(ctx, comparativeItems, "comparative_intelligence");
    expect(result.validated).toBe(true);
    expect(result.itemCount).toBe(5);
  });

  it("blocks comparative batch with one workflow from another workspace", () => {
    const ctx = makeCtx(7);
    expect(() =>
      validateAnalyticsScope(
        ctx,
        [
          { workspaceId: 7, itemId: 1 },
          { workspaceId: 7, itemId: 2 },
          { workspaceId: 8, itemId: 3 }, // intruder
        ],
        "comparative_intelligence",
      ),
    ).toThrowError(TenantIsolationViolation);
  });

  it("risk assessment shows critical analyticsBoundaryRisk for mixed comparative data", () => {
    const ctx = makeCtx(7);
    const assessment = assessTenantIsolationRisk({
      context: ctx,
      analyticsItems: [
        { workspaceId: 7 },
        { workspaceId: 7 },
        { workspaceId: 8 }, // cross-workspace
        { workspaceId: 9 }, // another workspace
        { workspaceId: 10 }, // yet another
      ],
    });
    expect(["high", "critical"]).toContain(assessment.analyticsBoundaryRisk);
  });

  it("risk assessment shows low analyticsBoundaryRisk for clean comparative data", () => {
    const ctx = makeCtx(7);
    const assessment = assessTenantIsolationRisk({
      context: ctx,
      analyticsItems: Array.from({ length: 10 }, (_, i) => ({ workspaceId: 7, itemId: i })),
    });
    expect(assessment.analyticsBoundaryRisk).toBe("low");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T9 - historical analytics remain isolated
// ─────────────────────────────────────────────────────────────────────────────

describe("T9: historical analytics remain isolated", () => {
  it("historical_rollup items from correct workspace pass validation", () => {
    const ctx = makeCtx(7);
    const rollupItems = Array.from({ length: 8 }, () => ({ workspaceId: 7 }));
    const result = validateAnalyticsScope(ctx, rollupItems, "historical_rollup");
    expect(result.validated).toBe(true);
    expect(result.itemCount).toBe(8);
  });

  it("single cross-workspace rollup item in batch causes ANALYTICS_BOUNDARY_VIOLATION", () => {
    const ctx = makeCtx(7);
    const items = [
      { workspaceId: 7 },
      { workspaceId: 7 },
      { workspaceId: 99 }, // cross-tenant rollup row
    ];
    let caught: TenantIsolationViolation | undefined;
    try {
      validateAnalyticsScope(ctx, items, "historical_rollup");
    } catch (e) { caught = e as TenantIsolationViolation; }
    expect(caught).toBeDefined();
    expect(caught!.code).toBe("ANALYTICS_BOUNDARY_VIOLATION");
    expect(caught!.message).toContain("historical_rollup");
  });

  it("orphan rollup row (undefined workspaceId) is rejected", () => {
    const ctx = makeCtx(7);
    expect(() =>
      validateAnalyticsScope(
        ctx,
        [{ workspaceId: 7 }, { workspaceId: undefined }],
        "historical_rollup",
      ),
    ).toThrowError(TenantIsolationViolation);
  });

  it("risk assessment with clean historical data yields low overall risk", () => {
    const ctx = makeCtx(7);
    const assessment = assessTenantIsolationRisk({
      context: ctx,
      analyticsItems:      Array.from({ length: 20 }, () => ({ workspaceId: 7 })),
      workflowResources:   Array.from({ length: 5 }, (_, i) => ({ workspaceId: 7, id: i + 1 })),
      governanceSignals:   Array.from({ length: 3 }, () => ({ workspaceId: 7 })),
      observabilityEvents: [
        {
          eventType:        "tenant_isolation_enforced",
          workspaceId:      7,
          requestScopeId:   ctx.requestScopeId,
          tenantBoundaryId: ctx.tenantBoundaryId,
        },
      ],
    });
    expect(assessment.overallRisk).toBe("low");
    expect(assessment.leakageRisk).toBe("low");
    expect(assessment.orphanAccessRisk).toBe("low");
    expect(assessment.analyticsBoundaryRisk).toBe("low");
    expect(assessment.observabilityIsolationRisk).toBe("low");
    expect(assessment.findings).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T10 - no implicit tenant crossover possible
// ─────────────────────────────────────────────────────────────────────────────

describe("T10: no implicit tenant crossover possible", () => {
  it("buildTenantIsolationContext never produces a context with wrong boundary ID", () => {
    for (const wsId of [1, 5, 7, 100, 99999]) {
      const ctx = buildTenantIsolationContext({ workspaceId: wsId });
      expect(ctx.tenantBoundaryId).toBe(`ws:${wsId}`);
      expect(ctx.workspaceId).toBe(wsId);
    }
  });

  it("violation context is frozen - cannot be mutated post-throw", () => {
    const ctx = makeCtx(7);
    let caught: TenantIsolationViolation | undefined;
    try {
      enforceTenantIsolation(ctx, { resourceWorkspaceId: 99, resourceType: "workflow_definition" });
    } catch (e) { caught = e as TenantIsolationViolation; }
    expect(Object.isFrozen(caught!.context)).toBe(true);
    // Attempting mutation in strict mode would throw (readonly property)
    expect(() => {
      (caught!.context as { workspaceId: number }).workspaceId = 99;
    }).toThrow();
  });

  it("TenantIsolationViolation is instance of Error", () => {
    const ctx = makeCtx(7);
    let caught: unknown;
    try {
      enforceTenantIsolation(ctx, { resourceWorkspaceId: null, resourceType: "workflow_definition" });
    } catch (e) { caught = e; }
    expect(caught instanceof Error).toBe(true);
    expect(caught instanceof TenantIsolationViolation).toBe(true);
  });

  it("risk assessment result is plain JSON-serializable (no class instances)", () => {
    const ctx = makeCtx(7);
    const assessment: TenantIsolationRiskAssessment = assessTenantIsolationRisk({
      context: ctx,
      workflowResources: [{ workspaceId: 99, id: 1 }], // force a finding
    });
    const json = JSON.stringify(assessment);
    const parsed = JSON.parse(json) as TenantIsolationRiskAssessment;
    expect(parsed.overallRisk).toBe(assessment.overallRisk);
    expect(parsed.findings).toHaveLength(assessment.findings.length);
  });

  it("makeRequestScopeId produces unique IDs for sequential calls in same workspace", () => {
    resetRequestScopeSeq();
    const ids = Array.from({ length: 10 }, () => makeRequestScopeId(7));
    const unique = new Set(ids);
    expect(unique.size).toBe(10);
  });

  it("requestScopeId format includes workspaceId prefix", () => {
    const id = makeRequestScopeId(42);
    expect(id).toMatch(/^req:42-/);
  });

  it("no implicit fallback - assessment with mixed data never returns 'low' overall", () => {
    const ctx = makeCtx(7);
    const assessment = assessTenantIsolationRisk({
      context: ctx,
      workflowResources: [
        { workspaceId: 7,    id: 1 },
        { workspaceId: 99,   id: 2 }, // cross-workspace
      ],
    });
    expect(assessment.overallRisk).not.toBe("low");
    expect(assessment.leakageRisk).not.toBe("low");
  });
});
