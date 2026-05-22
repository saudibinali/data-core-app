/**
 * Canonical product access — workspace_module_settings.
 */

import { useState } from "react";
import { Loader2, Package, ToggleLeft, ToggleRight } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useTenantProductModules,
  useUpdateTenantProductModule,
} from "@/hooks/use-tenant-product-modules";

interface Props {
  tenantId: string;
  canRead: boolean;
  canUpdate: boolean;
}

export function ProductModulesPanel({ tenantId, canRead, canUpdate }: Props) {
  const { data: modules = [], isLoading, error } = useTenantProductModules(canRead ? tenantId : undefined);
  const updateModule = useUpdateTenantProductModule(tenantId);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  if (!canRead) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="product-modules-access-denied">
        You do not have permission to view product modules.
      </p>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="product-modules-loading">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading modules...
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-xs text-destructive" data-testid="product-modules-error">
        Could not load product modules.
      </p>
    );
  }

  const sorted = [...modules].sort((a, b) => a.displayOrder - b.displayOrder);

  return (
    <div className="space-y-3" data-testid="product-modules-panel">
      <p className="text-xs text-muted-foreground">
        Modules enabled for this customer. Core modules cannot be turned off.
      </p>
      {formError ? (
        <p className="text-xs text-destructive" data-testid="product-modules-form-error">
          {formError}
        </p>
      ) : null}
      <ul className="divide-y divide-border rounded-md border border-border">
        {sorted.map((mod) => {
          const locked = mod.core || !canUpdate;
          const isPending = pendingKey === mod.key;
          return (
            <li
              key={mod.key}
              className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm"
              data-testid={`product-module-row-${mod.key}`}
            >
              <div className="min-w-0 flex items-start gap-2">
                <Package className="w-4 h-4 shrink-0 mt-0.5 text-muted-foreground" aria-hidden />
                <div>
                  <p className="font-medium truncate">{mod.name}</p>
                  {mod.description ? (
                    <p className="text-xs text-muted-foreground line-clamp-2">{mod.description}</p>
                  ) : null}
                </div>
              </div>
              <button
                type="button"
                disabled={locked || isPending || updateModule.isPending}
                className={cn(
                  "shrink-0 inline-flex items-center gap-1 text-xs font-medium",
                  locked ? "opacity-50 cursor-not-allowed" : "hover:opacity-80",
                )}
                data-testid={`product-module-toggle-${mod.key}`}
                onClick={async () => {
                  if (locked) return;
                  setFormError(null);
                  setPendingKey(mod.key);
                  try {
                    await updateModule.mutateAsync({
                      moduleKey: mod.key,
                      enabled: !mod.enabled,
                    });
                  } catch (e) {
                    setFormError(e instanceof Error ? e.message : "Update failed");
                  } finally {
                    setPendingKey(null);
                  }
                }}
              >
                {isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : mod.enabled ? (
                  <>
                    <ToggleRight className="w-5 h-5 text-emerald-600" />
                    <span>On</span>
                  </>
                ) : (
                  <>
                    <ToggleLeft className="w-5 h-5 text-muted-foreground" />
                    <span>Off</span>
                  </>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
