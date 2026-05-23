/** Canonical org unit types supported by hr_org_units. */
export const HR_ORG_UNIT_TYPES = [
  "company",
  "branch",
  "division",
  "department",
  "team",
  "unit",
] as const;

export type HrOrgUnitType = (typeof HR_ORG_UNIT_TYPES)[number];

export type WorkforceCanonicalMode = "legacy" | "shadow" | "active";
export type WorkforceSyncDirection = "none" | "employee_to_user" | "bidirectional";
export type OrgRuntimeMode = "legacy" | "shadow" | "active";

export type OrgUnitNode = {
  id: number;
  workspaceId: number;
  type: string;
  name: string;
  nameAr: string | null;
  code: string | null;
  parentId: number | null;
  managerEmployeeId?: number | null;
  color: string;
  displayOrder: number;
  isActive: boolean;
  children?: OrgUnitNode[];
};

export type ReportingChainEntry = {
  employeeId: number;
  fullName: string;
  userId: number | null;
  depth: number;
};

export type ReportingNodeSource =
  | "self"
  | "direct"
  | "position"
  | "org_head"
  | "parent_org_head"
  | "executive";

export type ReportingNode = {
  employeeId: number;
  fullName: string;
  userId: number | null;
  orgUnitId: number | null;
  positionId: number | null;
  depth: number;
  source: ReportingNodeSource;
};

export type ManagerResolution = {
  approverUserId: number;
  approverRole: "manager" | "admin" | "fallback";
  source:
    | "direct_manager"
    | "legacy_line_manager"
    | "org_unit_head"
    | "parent_org_head"
    | "executive_hr_director"
    | "admin_fallback";
};

export type WorkforceSchemaUnavailable = {
  error: "WORKFORCE_SCHEMA_UNAVAILABLE";
  message: string;
  migrationHint: string;
};
