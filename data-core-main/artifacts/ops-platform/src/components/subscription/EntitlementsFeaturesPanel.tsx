/**
 * @phase P16-B - Entitlements & Features (model only, no enforcement)
 */

import { useMemo, useState } from "react";
import { Loader2, Lock, Package, ToggleLeft, ToggleRight } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useTenantEntitlements,
  useUpdateTenantEntitlements,
  type EntitlementCatalogModule,
  type WorkspaceEntitlementRecord,
} from "@/hooks/use-workspace-entitlements";
import { ENTITLEMENT_SOURCE_LABELS } from "@/lib/entitlement-model-config";

interface Props {
  tenantId: string;
  canRead: boolean;
  canUpdate: boolean;
}

function lookupEntitlement(
  entitlements: WorkspaceEntitlementRecord[],
  moduleKey: string,
  featureKey: string | null,
): WorkspaceEntitlementRecord | undefined {
  return entitlements.find(
    (e) =>
      e.moduleKey === moduleKey &&
      (featureKey ? e.featureKey === featureKey : !e.featureKey),
  );
}

function resolvedEnabled(
  entitlements: WorkspaceEntitlementRecord[],
  mod: EntitlementCatalogModule,
  featureKey: string | null,
): boolean {
  if (mod.isCore) return true;
  const featRow = featureKey ? lookupEntitlement(entitlements, mod.key, featureKey) : undefined;
  if (featRow) return featRow.isEnabled;
  const modRow = lookupEntitlement(entitlements, mod.key, null);
  if (modRow) return modRow.isEnabled;
  return false;
}

export function EntitlementsFeaturesPanel({ tenantId, canRead, canUpdate }: Props) {
  const { data, isLoading, error } = useTenantEntitlements(canRead ? tenantId : undefined);
  const bulkUpdate = useUpdateTenantEntitlements(tenantId);
  const [disableReason, setDisableReason] = useState("");
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const catalogModules = data?.catalog?.modules ?? [];
  const entitlements = data?.entitlements ?? [];

  const sortedModules = useMemo(
    () => [...catalogModules].sort((a, b) => a.order - b.order),
    [catalogModules],
  );

  if (!canRead) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="entitlements-access-denied">
        No permission to view workspace entitlements.
      </p>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="entitlements-loading">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading entitlements...
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-xs text-destructive" data-testid="entitlements-error">
        {error instanceof Error ? error.message : "Failed to load entitlements"}
      </p>
    );
  }

  async function toggleEntitlement(moduleKey: string, featureKey: string | null, next: boolean) {
    if (!canUpdate || moduleKey === "core") return;
    setFormError(null);
    setPendingKey(`${moduleKey}:${featureKey ?? ""}`);
    try {
      const payload = {
        moduleKey,
        featureKey,
        isEnabled: next,
        source: "manual" as const,
        reason: next ? undefined : disableReason || "Disabled via platform administration",
      };
      if (!next && (!payload.reason || payload.reason.length < 10)) {
        setFormError("Provide a disable reason (min 10 characters) in the field below.");
        return;
      }
      await bulkUpdate.mutateAsync([payload]);
      if (!next) setDisableReason("");
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setPendingKey(null);
    }
  }

  return (
    <div className="space-y-4" data-testid="entitlements-features-panel">
      <div className="flex items-start gap-2 p-3 rounded-md bg-muted/40 border border-border text-xs text-muted-foreground">
        <Package className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <span>
          Entitlements &amp; Features - module and feature access model linked to subscription.
          Indicators only; no login blocking, suspension, or payment flows in this phase.
        </span>
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-sm font-semibold">Entitlements &amp; Features</h3>
        {canUpdate && (
          <div className="flex items-center gap-2">
            <input
              className="text-xs border rounded px-2 py-1 w-48"
              placeholder="Reason when disabling..."
              value={disableReason}
              onChange={(e) => setDisableReason(e.target.value)}
              data-testid="entitlement-disable-reason"
            />
          </div>
        )}
      </div>

      {formError && (
        <p className="text-xs text-destructive" data-testid="entitlement-form-error">
          {formError}
        </p>
      )}

      <div className="space-y-3">
        {sortedModules.map((mod) => {
          const modEnabled = resolvedEnabled(entitlements, mod, null);
          const modRow = lookupEntitlement(entitlements, mod.key, null);
          const modLocked = mod.isCore;
          const modPending = pendingKey === `${mod.key}:`;

          return (
            <div
              key={mod.key}
              className="rounded-md border border-border bg-background/50 overflow-hidden"
              data-testid={`entitlement-module-${mod.key}`}
            >
              <div className="flex items-center justify-between gap-2 px-3 py-2 bg-muted/30 border-b border-border">
                <div className="min-w-0">
                  <p className="text-xs font-semibold flex items-center gap-1.5">
                    {mod.label}
                    {modLocked && (
                      <Lock className="w-3 h-3 text-muted-foreground" data-testid={`core-lock-${mod.key}`} />
                    )}
                  </p>
                  <p className="text-[10px] text-muted-foreground">{mod.description}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {modRow && (
                    <span className="text-[10px] text-muted-foreground">
                      {ENTITLEMENT_SOURCE_LABELS[modRow.source] ?? modRow.source}
                    </span>
                  )}
                  <span
                    className={cn(
                      "text-[10px] font-medium px-1.5 py-0.5 rounded",
                      modEnabled
                        ? "bg-emerald-500/15 text-emerald-700"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {modEnabled ? "Enabled" : "Disabled"}
                  </span>
                  {canUpdate && !modLocked && (
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground"
                      disabled={modPending || bulkUpdate.isPending}
                      data-testid={`entitlement-toggle-module-${mod.key}`}
                      onClick={() => void toggleEntitlement(mod.key, null, !modEnabled)}
                      aria-label={modEnabled ? "Disable module" : "Enable module"}
                    >
                      {modEnabled ? (
                        <ToggleRight className="w-5 h-5 text-emerald-600" />
                      ) : (
                        <ToggleLeft className="w-5 h-5" />
                      )}
                    </button>
                  )}
                </div>
              </div>

              {mod.features.length > 0 && (
                <ul className="divide-y divide-border/50">
                  {mod.features.map((feat) => {
                    const featEnabled = resolvedEnabled(entitlements, mod, feat.key);
                    const featRow = lookupEntitlement(entitlements, mod.key, feat.key);
                    const featPending = pendingKey === `${mod.key}:${feat.key}`;

                    return (
                      <li
                        key={feat.key}
                        className="flex items-center justify-between gap-2 px-3 py-2 text-xs"
                        data-testid={`entitlement-feature-${feat.key}`}
                      >
                        <div className="min-w-0">
                          <p className="font-medium">{feat.label}</p>
                          <p className="text-[10px] text-muted-foreground font-mono">{feat.key}</p>
                          {featRow?.reason && (
                            <p className="text-[10px] text-muted-foreground mt-0.5">
                              Reason: {featRow.reason}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {featRow && (
                            <span className="text-[10px] text-muted-foreground">
                              {ENTITLEMENT_SOURCE_LABELS[featRow.source] ?? featRow.source}
                            </span>
                          )}
                          <span
                            className={cn(
                              "text-[10px] px-1 py-0.5 rounded",
                              featEnabled ? "text-emerald-700" : "text-muted-foreground",
                            )}
                          >
                            {featEnabled ? "On" : "Off"}
                          </span>
                          {canUpdate && !modLocked && (
                            <button
                              type="button"
                              className="text-muted-foreground hover:text-foreground"
                              disabled={featPending || bulkUpdate.isPending}
                              data-testid={`entitlement-toggle-feature-${feat.key}`}
                              onClick={() => void toggleEntitlement(mod.key, feat.key, !featEnabled)}
                            >
                              {featEnabled ? (
                                <ToggleRight className="w-4 h-4 text-emerald-600" />
                              ) : (
                                <ToggleLeft className="w-4 h-4" />
                              )}
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}

              {modRow && (modRow.effectiveFrom || modRow.effectiveUntil || modRow.internalNotes) && (
                <div className="px-3 py-2 text-[10px] text-muted-foreground border-t border-border/50 space-y-0.5">
                  {modRow.effectiveFrom && <p>Effective from: {modRow.effectiveFrom}</p>}
                  {modRow.effectiveUntil && <p>Effective until: {modRow.effectiveUntil}</p>}
                  {modRow.internalNotes && <p>Notes: {modRow.internalNotes}</p>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
