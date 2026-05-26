import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { GitMerge, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";

type MergeEntityType = "job_grade" | "job_title" | "org_unit" | "work_location" | "position";

type EntityRow = { id: number; code?: string | null; name?: string; title?: string; isActive?: boolean };

type DuplicateGroup = { key: string; ids: number[]; label: string };

type MergeDryRunResult = {
  ok: boolean;
  dryRun: boolean;
  entityType: MergeEntityType;
  targetId: number;
  sourceIds: number[];
  impact: Record<string, number>;
  moved?: Record<string, number>;
  deactivated?: number;
  aliasesCreated?: number;
};

const ENTITY_OPTIONS: { value: MergeEntityType; labelEn: string; labelAr: string }[] = [
  { value: "job_grade", labelEn: "Job grades", labelAr: "الدرجات الوظيفية" },
  { value: "job_title", labelEn: "Job titles", labelAr: "المسميات الوظيفية" },
  { value: "org_unit", labelEn: "Org units", labelAr: "الوحدات التنظيمية" },
  { value: "work_location", labelEn: "Work locations", labelAr: "مواقع العمل" },
  { value: "position", labelEn: "Positions", labelAr: "المناصب" },
];

function entityLabel(row: EntityRow, entityType: MergeEntityType): string {
  const code = row.code?.trim();
  const name = (entityType === "position" ? row.title : row.name)?.trim();
  const parts = [code, name].filter(Boolean);
  return parts.length ? `${parts.join(" — ")} (#${row.id})` : `#${row.id}`;
}

function impactLabels(isAr: boolean): Record<string, { en: string; ar: string }> {
  return {
    employees: { en: "Employees reassigned", ar: "موظفون يُعاد ربطهم" },
    positions: { en: "Positions reassigned", ar: "مناصب تُعاد ربطها" },
    jobTitles: { en: "Job titles (grade link)", ar: "مسميات (ربط الدرجة)" },
    childOrgUnits: { en: "Child org units", ar: "وحدات فرعية" },
  };
}

export function FoundationMergePanel(props: {
  isAr: boolean;
  isAdmin: boolean;
  apiFetch: (url: string, init?: RequestInit) => Promise<Response>;
  onMerged: () => void;
  lists: {
    jobGrades: EntityRow[];
    jobTitles: EntityRow[];
    orgUnits: EntityRow[];
    workLocations: EntityRow[];
    positions: EntityRow[];
  };
}) {
  const { isAr, isAdmin, apiFetch, onMerged, lists } = props;

  const [entityType, setEntityType] = useState<MergeEntityType>("job_grade");
  const [targetId, setTargetId] = useState<number | null>(null);
  const [sourceIds, setSourceIds] = useState<number[]>([]);
  const [createAliases, setCreateAliases] = useState(true);
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroup[]>([]);
  const [dupLoading, setDupLoading] = useState(false);
  const [selectedGroupKey, setSelectedGroupKey] = useState<string | "manual">("manual");
  const [dryRunOpen, setDryRunOpen] = useState(false);
  const [dryRunResult, setDryRunResult] = useState<MergeDryRunResult | null>(null);
  const [dryRunBusy, setDryRunBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [commitBusy, setCommitBusy] = useState(false);

  const entities = useMemo(() => {
    switch (entityType) {
      case "job_grade": return lists.jobGrades;
      case "job_title": return lists.jobTitles;
      case "org_unit": return lists.orgUnits;
      case "work_location": return lists.workLocations;
      case "position": return lists.positions;
      default: return [];
    }
  }, [entityType, lists]);

  const entityById = useMemo(() => new Map(entities.map((e) => [e.id, e])), [entities]);

  const loadDuplicates = useCallback(async () => {
    setDupLoading(true);
    try {
      const r = await apiFetch(`/api/hr/foundation/duplicates?entityType=${entityType}`);
      if (!r.ok) throw new Error("failed");
      const data = await r.json() as { groups?: DuplicateGroup[] };
      setDuplicateGroups(data.groups ?? []);
    } catch {
      setDuplicateGroups([]);
      toast.error(isAr ? "تعذّر تحميل المكررات" : "Could not load duplicate groups");
    } finally {
      setDupLoading(false);
    }
  }, [apiFetch, entityType, isAr]);

  useEffect(() => {
    if (!isAdmin) return;
    setTargetId(null);
    setSourceIds([]);
    setSelectedGroupKey("manual");
    void loadDuplicates();
  }, [entityType, isAdmin, loadDuplicates]);

  function applyGroup(group: DuplicateGroup) {
    const sorted = [...group.ids].sort((a, b) => a - b);
    const canonical = sorted[0]!;
    const sources = sorted.slice(1);
    setTargetId(canonical);
    setSourceIds(sources);
  }

  function toggleSource(id: number) {
    setSourceIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  const filteredSources = sourceIds.filter((id) => id !== targetId);

  async function runMerge(dryRun: boolean) {
    if (!targetId || !filteredSources.length) {
      toast.error(isAr ? "اختر الهدف والمصادر" : "Select target and at least one source");
      return null;
    }
    const r = await apiFetch("/api/hr/foundation/merge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entityType,
        targetId,
        sourceIds: filteredSources,
        dryRun,
        createAliases,
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      throw new Error(typeof data.error === "string" ? data.error : "merge failed");
    }
    return data as MergeDryRunResult;
  }

  async function handleDryRun() {
    setDryRunBusy(true);
    try {
      const result = await runMerge(true);
      if (!result) return;
      setDryRunResult(result);
      setDryRunOpen(true);
    } catch (e) {
      toast.error(isAr ? "فشلت المعاينة" : "Dry-run failed", {
        description: e instanceof Error ? e.message : undefined,
      } as { description?: string });
    } finally {
      setDryRunBusy(false);
    }
  }

  async function handleConfirmMerge() {
    setCommitBusy(true);
    try {
      const result = await runMerge(false);
      if (!result) return;
      toast.success(isAr ? "تم الدمج بنجاح" : "Merge completed", {
        description: isAr
          ? `معطّل: ${result.deactivated ?? 0} — أسماء بديلة: ${result.aliasesCreated ?? 0}`
          : `Deactivated: ${result.deactivated ?? 0} — Aliases: ${result.aliasesCreated ?? 0}`,
      });
      setConfirmOpen(false);
      setDryRunOpen(false);
      setDryRunResult(null);
      setTargetId(null);
      setSourceIds([]);
      setSelectedGroupKey("manual");
      onMerged();
      await loadDuplicates();
    } catch (e) {
      toast.error(isAr ? "فشل الدمج" : "Merge failed", {
        description: e instanceof Error ? e.message : undefined,
      } as { description?: string });
    } finally {
      setCommitBusy(false);
    }
  }

  if (!isAdmin) return null;

  const labels = impactLabels(isAr);

  return (
    <div className="rounded-md border p-3 flex flex-col gap-3 mt-2">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-sm">
          <div className="font-medium flex items-center gap-2">
            <GitMerge className="w-4 h-4 text-primary" />
            {isAr ? "دمج المكررات (Governance)" : "Merge duplicates (Governance)"}
          </div>
          <div className="text-xs text-muted-foreground">
            {isAr
              ? "اختر السجل الصحيح (الهدف) ثم ادمج المكررات — معاينة قبل التنفيذ. لا يحذف سجلات الموظفين."
              : "Pick the canonical record (target), merge duplicates — dry-run first. Employee rows are reassigned, not deleted."}
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void loadDuplicates()} disabled={dupLoading}>
          <RefreshCw className={`w-4 h-4 me-2 ${dupLoading ? "animate-spin" : ""}`} />
          {isAr ? "تحديث المكررات" : "Refresh duplicates"}
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-2">
          <Label>{isAr ? "نوع الكيان" : "Entity type"}</Label>
          <Select value={entityType} onValueChange={(v) => setEntityType(v as MergeEntityType)}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ENTITY_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {isAr ? o.labelAr : o.labelEn}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>{isAr ? "مجموعة مكررة (اختياري)" : "Duplicate group (optional)"}</Label>
          <Select
            value={selectedGroupKey}
            onValueChange={(v) => {
              setSelectedGroupKey(v);
              if (v === "manual") return;
              const g = duplicateGroups.find((x) => x.key === v);
              if (g) applyGroup(g);
            }}
          >
            <SelectTrigger className="h-9">
              <SelectValue placeholder={isAr ? "اختيار يدوي" : "Manual selection"} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="manual">{isAr ? "— اختيار يدوي —" : "— Manual —"}</SelectItem>
              {duplicateGroups.map((g) => (
                <SelectItem key={g.key} value={g.key}>
                  {g.label} ({g.ids.length} {isAr ? "سجلات" : "records"})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!dupLoading && duplicateGroups.length === 0 && (
            <p className="text-xs text-muted-foreground">
              {isAr ? "لا توجد مجموعات مكررة لهذا النوع." : "No duplicate groups for this type."}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <Label>{isAr ? "السجل الصحيح (الهدف)" : "Canonical target"}</Label>
        <Select
          value={targetId != null ? String(targetId) : ""}
          onValueChange={(v) => {
            const id = Number(v);
            setTargetId(id);
            setSourceIds((prev) => prev.filter((x) => x !== id));
          }}
        >
          <SelectTrigger className="h-9">
            <SelectValue placeholder={isAr ? "اختر الهدف" : "Select target"} />
          </SelectTrigger>
          <SelectContent>
            {entities.map((e) => (
              <SelectItem key={e.id} value={String(e.id)}>
                {entityLabel(e, entityType)}
                {e.isActive === false ? ` (${isAr ? "غير نشط" : "inactive"})` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>{isAr ? "مصادر الدمج (مكررات)" : "Sources to merge"}</Label>
        <div className="border rounded-md max-h-48 overflow-y-auto p-2 space-y-1">
          {entities.filter((e) => e.id !== targetId).map((e) => (
            <label key={e.id} className="flex items-center gap-2 text-sm py-1 cursor-pointer">
              <Checkbox
                checked={sourceIds.includes(e.id)}
                onCheckedChange={() => toggleSource(e.id)}
              />
              <span>{entityLabel(e, entityType)}</span>
              {e.isActive === false && (
                <Badge variant="secondary" className="text-[10px]">{isAr ? "غير نشط" : "inactive"}</Badge>
              )}
            </label>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Switch id="merge-aliases" checked={createAliases} onCheckedChange={(v) => setCreateAliases(Boolean(v))} />
        <Label htmlFor="merge-aliases" className="text-sm font-normal cursor-pointer">
          {isAr ? "إنشاء alias للأكواد القديمة (موصى به للاستيراد)" : "Create aliases for old codes (recommended for imports)"}
        </Label>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => void handleDryRun()} disabled={dryRunBusy || !targetId || !filteredSources.length}>
          <Search className="w-4 h-4 me-2" />
          {dryRunBusy ? (isAr ? "جاري المعاينة..." : "Previewing...") : (isAr ? "معاينة (Dry-run)" : "Dry-run preview")}
        </Button>
        <Button
          size="sm"
          disabled={!targetId || !filteredSources.length || dryRunBusy}
          onClick={() => setConfirmOpen(true)}
        >
          <GitMerge className="w-4 h-4 me-2" />
          {isAr ? "تأكيد الدمج" : "Confirm merge"}
        </Button>
      </div>

      <Dialog open={dryRunOpen} onOpenChange={setDryRunOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{isAr ? "نتيجة المعاينة" : "Dry-run result"}</DialogTitle>
            <DialogDescription>
              {isAr ? "لا تغييرات على قاعدة البيانات — للمراجعة فقط." : "No database changes — review only."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            {(dryRunResult?.impact ? Object.entries(dryRunResult.impact) : []).map(([k, v]) => (
              <div key={k} className="flex justify-between border-b py-1">
                <span>{isAr ? (labels[k]?.ar ?? k) : (labels[k]?.en ?? k)}</span>
                <span className="font-mono font-semibold">{v}</span>
              </div>
            ))}
            <p className="text-xs text-muted-foreground pt-2">
              {isAr
                ? `الهدف #${dryRunResult?.targetId} ← مصادر: ${dryRunResult?.sourceIds?.join(", ")}`
                : `Target #${dryRunResult?.targetId} ← sources: ${dryRunResult?.sourceIds?.join(", ")}`}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDryRunOpen(false)}>{isAr ? "إغلاق" : "Close"}</Button>
            <Button onClick={() => { setDryRunOpen(false); setConfirmOpen(true); }}>
              {isAr ? "متابعة للتأكيد" : "Proceed to confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{isAr ? "تأكيد دمج المكررات؟" : "Confirm merge?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {isAr
                ? `سيتم نقل المراجع إلى #${targetId} وتعطيل المصادر (${filteredSources.join(", ")}). يُنصح بتشغيل المعاينة أولاً.`
                : `References move to #${targetId}; sources (${filteredSources.join(", ")}) will be deactivated where supported. Run dry-run first if unsure.`}
              {targetId && filteredSources.length > 0 && (
                <span className="block mt-2 font-medium">
                  {entityById.get(targetId) ? entityLabel(entityById.get(targetId)!, entityType) : ""}
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={commitBusy}>{isAr ? "إلغاء" : "Cancel"}</AlertDialogCancel>
            <AlertDialogAction disabled={commitBusy} onClick={(e) => { e.preventDefault(); void handleConfirmMerge(); }}>
              {commitBusy ? (isAr ? "جاري الدمج..." : "Merging...") : (isAr ? "دمج" : "Merge")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
