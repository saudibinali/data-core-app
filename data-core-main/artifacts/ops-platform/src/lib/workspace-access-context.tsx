/**
 * @phase P16-E - Workspace access context for tenant UI
 */

import React, { createContext, useContext, useEffect } from "react";
import { useAppAuth } from "@/lib/auth";
import {
  useTenantMemberWorkspaceAccess,
  useWorkspaceOperationalWrite,
  type TenantWorkspaceAccessSnapshot,
} from "@/hooks/use-tenant-workspace-access";

interface WorkspaceAccessContextValue {
  access: TenantWorkspaceAccessSnapshot | undefined;
  isLoading: boolean;
  isReadOnly: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canExport: boolean;
}

const WorkspaceAccessContext = createContext<WorkspaceAccessContextValue>({
  access: undefined,
  isLoading: false,
  isReadOnly: false,
  canCreate: true,
  canUpdate: true,
  canDelete: true,
  canExport: true,
});

export function WorkspaceAccessProvider({ children }: { children: React.ReactNode }) {
  const { user, isSignedIn } = useAppAuth();
  const isTenantUser = isSignedIn && user?.role !== "super_admin";
  const { data: access, isLoading } = useTenantMemberWorkspaceAccess(!!isTenantUser);
  const write = useWorkspaceOperationalWrite(access);

  useEffect(() => {
    if (!isTenantUser) {
      document.body.removeAttribute("data-workspace-read-only");
      return;
    }
    if (write.isReadOnly) {
      document.body.setAttribute("data-workspace-read-only", "true");
    } else {
      document.body.removeAttribute("data-workspace-read-only");
    }
    return () => document.body.removeAttribute("data-workspace-read-only");
  }, [isTenantUser, write.isReadOnly]);

  return (
    <WorkspaceAccessContext.Provider
      value={{
        access,
        isLoading,
        isReadOnly: write.isReadOnly,
        canCreate: write.canCreate,
        canUpdate: write.canUpdate,
        canDelete: write.canDelete,
        canExport: write.canExport,
      }}
    >
      {children}
    </WorkspaceAccessContext.Provider>
  );
}

export function useWorkspaceAccess() {
  return useContext(WorkspaceAccessContext);
}
