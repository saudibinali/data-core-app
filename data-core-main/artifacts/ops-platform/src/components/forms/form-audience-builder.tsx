import { useQuery } from "@tanstack/react-query";
import {
  useListDepartments, useListGroups,
  useListHrPositions, useListHrEmployees,
} from "@workspace/api-client-react";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Users, Building2, GitFork, Briefcase, UserCheck, UsersRound } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FormAudienceConfig, RolePreset } from "@/lib/form-smart-types";

interface Props {
  value: FormAudienceConfig;
  onChange: (v: FormAudienceConfig) => void;
  isAr: boolean;
  showInSelfService: boolean;
}

function ChipPicker({
  label, icon: Icon, items, selected, onToggle, isAr, labelKey = "name",
}: {
  label: string;
  icon: React.ElementType;
  items: { id: number; name?: string; nameAr?: string; fullName?: string }[];
  selected: number[];
  onToggle: (id: number) => void;
  isAr: boolean;
  labelKey?: string;
}) {
  if (!items.length) return null;
  return (
    <FieldGroup>
      <Label className="text-xs flex items-center gap-1.5 text-muted-foreground">
        <Icon className="w-3.5 h-3.5" />
        {label}
      </Label>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => {
          const raw = (item as unknown as Record<string, string>)[labelKey] ?? item.fullName ?? item.name ?? `#${item.id}`;
          const display = isAr && item.nameAr ? item.nameAr : raw;
          const active = selected.includes(item.id);
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onToggle(item.id)}
              className={cn(
                "px-2.5 py-1 rounded-full text-xs border transition-colors",
                active
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:border-primary/40",
              )}
            >
              {display}
            </button>
          );
        })}
      </div>
    </FieldGroup>
  );
}

function FieldGroup({ children }: { children: React.ReactNode }) {
  return <div className="space-y-2">{children}</div>;
}

export default function FormAudienceBuilder({ value, onChange, isAr, showInSelfService }: Props) {
  const { data: departments = [] } = useListDepartments({});
  const { data: groups = [] } = useListGroups({});
  const { data: positions = [] } = useListHrPositions({});
  const { data: employees = [] } = useListHrEmployees({});

  const { data: orgUnits = [] } = useQuery({
    queryKey: ["/hr/org-units"],
    queryFn: async () => {
      const r = await fetch("/api/hr/org-units", { credentials: "include" });
      if (!r.ok) return [];
      const d = await r.json();
      return Array.isArray(d) ? d : [];
    },
  });

  const mode = value.mode ?? (value.visibleTo === "all" ? "all" : "preset");
  const preset = value.visibleTo ?? "all";

  function setMode(m: FormAudienceConfig["mode"]) {
    if (m === "all") onChange({ mode: "all", visibleTo: "all" });
    else if (m === "preset") onChange({ mode: "preset", visibleTo: preset === "all" ? "member" : preset });
    else onChange({ ...value, mode: "targeted", visibleTo: preset });
  }

  function setPreset(p: RolePreset) {
    onChange({ ...value, mode: "preset", visibleTo: p });
  }

  function toggleKey(key: keyof FormAudienceConfig, id: number) {
    const arr = (value[key] as number[] | undefined) ?? [];
    const next = arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id];
    onChange({ ...value, mode: "targeted", [key]: next });
  }

  if (!showInSelfService) {
    return (
      <p className="text-xs text-muted-foreground rounded-lg border border-dashed p-3">
        {isAr
          ? "فعّل «الخدمات الذاتية» أعلاه لتحديد من يمكنه رؤية هذا النموذج وتقديمه."
          : "Enable Self-Service above to configure who can see and submit this form."}
      </p>
    );
  }

  const MODES: { id: NonNullable<FormAudienceConfig["mode"]>; labelEn: string; labelAr: string }[] = [
    { id: "all", labelEn: "All employees", labelAr: "جميع الموظفين" },
    { id: "preset", labelEn: "By role level", labelAr: "حسب مستوى الدور" },
    { id: "targeted", labelEn: "Specific groups", labelAr: "فئات محددة" },
  ];

  const hasTargets = Boolean(
    value.departmentIds?.length || value.orgUnitIds?.length || value.positionIds?.length
    || value.groupIds?.length || value.userIds?.length,
  );

  return (
    <FieldGroup>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setMode(m.id)}
            className={cn(
              "p-3 rounded-xl border-2 text-left transition-all text-sm",
              mode === m.id
                ? "border-primary bg-primary/5 text-primary"
                : "border-border hover:border-primary/30 text-muted-foreground",
            )}
          >
            <p className="font-medium">{isAr ? m.labelAr : m.labelEn}</p>
          </button>
        ))}
      </div>

      {mode === "preset" && (
        <div className="space-y-1.5">
          <Label>{isAr ? "مستوى الوصول" : "Access level"}</Label>
          <Select value={preset} onValueChange={(v) => setPreset(v as RolePreset)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="member">{isAr ? "الموظفون فقط" : "Employees only"}</SelectItem>
              <SelectItem value="manager_above">{isAr ? "المدراء فما فوق" : "Managers & above"}</SelectItem>
              <SelectItem value="admin_only">{isAr ? "المشرفون فقط" : "Admins only"}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {mode === "targeted" && (
        <div className="space-y-4 rounded-lg border p-4 bg-muted/20">
          <p className="text-xs text-muted-foreground">
            {isAr
              ? "اختر واحدة أو أكثر — يرى النموذج أي موظف ينتمي لأي من الفئات المحددة."
              : "Select one or more — any employee matching any selected category can access the form."}
          </p>

          <ChipPicker
            label={isAr ? "الأقسام" : "Departments"}
            icon={Building2}
            items={departments as { id: number; name?: string }[]}
            selected={value.departmentIds ?? []}
            onToggle={(id) => toggleKey("departmentIds", id)}
            isAr={isAr}
          />

          <ChipPicker
            label={isAr ? "الوحدات التنظيمية" : "Org units"}
            icon={GitFork}
            items={orgUnits as { id: number; name?: string; nameAr?: string }[]}
            selected={value.orgUnitIds ?? []}
            onToggle={(id) => toggleKey("orgUnitIds", id)}
            isAr={isAr}
          />

          <ChipPicker
            label={isAr ? "المناصب" : "Positions"}
            icon={Briefcase}
            items={positions as { id: number; name?: string; nameAr?: string }[]}
            selected={value.positionIds ?? []}
            onToggle={(id) => toggleKey("positionIds", id)}
            isAr={isAr}
          />

          <ChipPicker
            label={isAr ? "مجموعات المستخدمين" : "User groups"}
            icon={UsersRound}
            items={groups as { id: number; name?: string }[]}
            selected={value.groupIds ?? []}
            onToggle={(id) => toggleKey("groupIds", id)}
            isAr={isAr}
          />

          <ChipPicker
            label={isAr ? "موظفون محددون (بحساب دخول)" : "Specific employees (with login)"}
            icon={UserCheck}
            items={(employees as { id: number; fullName?: string; userId?: number | null }[])
              .filter((e) => e.userId)
              .map((e) => ({ id: e.userId!, fullName: e.fullName }))}
            selected={value.userIds ?? []}
            onToggle={(uid) => toggleKey("userIds", uid)}
            isAr={isAr}
            labelKey="fullName"
          />

          {hasTargets && (
            <Badge variant="secondary" className="text-xs gap-1">
              <Users className="w-3 h-3" />
              {isAr ? "استهداف مخصص" : "Custom targeting active"}
            </Badge>
          )}
        </div>
      )}
    </FieldGroup>
  );
}
