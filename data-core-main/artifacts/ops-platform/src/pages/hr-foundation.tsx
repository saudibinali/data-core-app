import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import {
  createHrContractType,
  createHrDocumentType,
  createHrEmployeeStatus,
  createHrEmploymentType,
  createHrJobGrade,
  createHrJobTitle,
  createHrLeavePolicy,
  createHrOrgUnit,
  createHrPosition,
  createHrProbationPolicy,
  createHrWorkLocation,
  deleteHrContractType,
  deleteHrDocumentType,
  deleteHrEmployeeStatus,
  deleteHrEmploymentType,
  deleteHrJobGrade,
  deleteHrJobTitle,
  deleteHrLeavePolicy,
  deleteHrOrgUnit,
  deleteHrPosition,
  deleteHrProbationPolicy,
  deleteHrWorkLocation,
  getListHrContractTypesQueryKey,
  getListHrDocumentTypesQueryKey,
  getListHrEmployeeStatusesQueryKey,
  getListHrEmploymentTypesQueryKey,
  getListHrJobGradesQueryKey,
  getListHrJobTitlesQueryKey,
  getListHrLeavePoliciesQueryKey,
  getListHrOrgUnitsQueryKey,
  getListHrPositionsQueryKey,
  getListHrProbationPoliciesQueryKey,
  getListHrWorkLocationsQueryKey,
  seedHrFoundation,
  updateHrContractType,
  updateHrDocumentType,
  updateHrEmployeeStatus,
  updateHrEmploymentType,
  updateHrJobGrade,
  updateHrJobTitle,
  updateHrLeavePolicy,
  updateHrOrgUnit,
  updateHrPosition,
  updateHrProbationPolicy,
  updateHrWorkLocation,
  useListHrContractTypes,
  useListHrDocumentTypes,
  useListHrEmployeeStatuses,
  useListHrEmploymentTypes,
  useListHrJobGrades,
  useListHrJobTitles,
  useListHrLeavePolicies,
  useListHrOrgUnits,
  useListHrPositions,
  useListHrProbationPolicies,
  useListHrWorkLocations,
} from "@workspace/api-client-react";
import { useApiFetch } from "@/hooks/use-api-fetch";
import { usePermissions } from "@/hooks/use-permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  Layers, Building2, Briefcase, Star, UserCheck, FileText,
  MapPin, Calendar, Shield, Tags, Pencil, Trash2, Plus,
  Sparkles, RefreshCw, Settings, Code2, Download, FileSpreadsheet, Upload,
} from "lucide-react";
import { toast } from "sonner";
import { toCode } from "@/lib/hr-utils";
import { downloadWithAuth } from "@workspace/api-client-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ─── Shared types ─────────────────────────────────────────────────────────────
type BaseEntity = Record<string, unknown> & { id: number; isActive: boolean };

type FormField =
  | { key: string; labelEn: string; labelAr: string; type: "text" | "number" | "color" | "textarea"; placeholder?: string }
  | { key: string; labelEn: string; labelAr: string; type: "boolean" }
  | { key: string; labelEn: string; labelAr: string; type: "select"; options: { value: string; labelEn: string; labelAr: string }[] };

// ─── Domain types ─────────────────────────────────────────────────────────────
interface HrEmployeeStatus  extends BaseEntity { code: string; name: string; nameAr?: string; color: string; isDefault: boolean; isFinal: boolean; allowSelfService: boolean; displayOrder: number; }
interface HrEmploymentType  extends BaseEntity { code: string; name: string; nameAr?: string; color: string; displayOrder: number; }
interface HrContractType    extends BaseEntity { code: string; name: string; nameAr?: string; color: string; displayOrder: number; }
interface HrWorkLocation    extends BaseEntity { name: string; nameAr?: string; code?: string; type: string; address?: string; city?: string; country?: string; timezone?: string; displayOrder: number; }
interface HrPosition        extends BaseEntity { code?: string; title: string; titleAr?: string; description?: string; status: string; headcount: number; currentOccupancy: number; displayOrder: number; jobTitleId?: number; orgUnitId?: number; jobGradeId?: number; workLocationId?: number; }
interface HrDocumentType    extends BaseEntity { name: string; nameAr?: string; code?: string; hasExpiry: boolean; isRequired: boolean; displayOrder: number; }
interface HrLeavePolicy     extends BaseEntity { name: string; nameAr?: string; code?: string; leaveType: string; annualDays: number; accrualType: string; carryOver: boolean; maxCarryOverDays?: number; paid: boolean; requiresApproval: boolean; displayOrder: number; }
interface HrProbationPolicy extends BaseEntity { name: string; nameAr?: string; durationDays: number; extendable: boolean; maxExtensionDays?: number; }
interface HrOrgUnit         extends BaseEntity { name: string; nameAr?: string; type: string; code?: string; parentId?: number; }
interface HrJobGrade        extends BaseEntity { name: string; nameAr?: string; code?: string; level?: number; description?: string; }
interface HrJobTitle        extends BaseEntity { name: string; nameAr?: string; code?: string; description?: string; }

// ─── Colour dot ───────────────────────────────────────────────────────────────
function ColorDot({ color }: { color: string }) {
  return <span className="inline-block w-3 h-3 rounded-full border mr-1.5 shrink-0" style={{ backgroundColor: color }} />;
}

// ─── Code preview badge ───────────────────────────────────────────────────────
function CodePreview({ code }: { code: string }) {
  if (!code) return null;
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1">
      <Code2 className="w-3 h-3 shrink-0" />
      <span className="font-mono bg-muted px-1.5 py-0.5 rounded tracking-wide">{code}</span>
    </div>
  );
}

// ─── SimpleEntityCard (non-generic, with auto-code) ───────────────────────────
interface SimpleEntityCardProps {
  title: string;
  titleAr: string;
  description: string;
  descriptionAr: string;
  items: BaseEntity[];
  loading: boolean;
  onSave: (values: Record<string, unknown>, id?: number) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  formFields: FormField[];
  renderRow: (item: BaseEntity) => React.ReactNode;
  /** Which field drives the auto-generated code ('name' or 'title') */
  codeSourceKey?: string;
  isAr?: boolean;
}

function SimpleEntityCard({
  title, titleAr, description, descriptionAr,
  items, loading, onSave, onDelete, formFields, renderRow,
  codeSourceKey = 'name', isAr = false,
}: SimpleEntityCardProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editItem, setEditItem]     = useState<BaseEntity | null>(null);
  const [deleteId, setDeleteId]     = useState<number | null>(null);
  const [values, setValues]         = useState<Record<string, unknown>>({});
  const [saving, setSaving]         = useState(false);

  // Live-computed code from the name/title field
  const computedCode = toCode(String(values[codeSourceKey] ?? ''));

  const openAdd  = () => { setEditItem(null); setValues({ isActive: true }); setDialogOpen(true); };
  const openEdit = (item: BaseEntity) => { setEditItem(item); setValues({ ...item }); setDialogOpen(true); };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Normalise: convert __none__ sentinel → null, strip empty strings
      const cleaned: Record<string, unknown> = { _computedCode: computedCode };
      for (const [k, v] of Object.entries(values)) {
        cleaned[k] = (v === '__none__' || v === '') ? null : v;
      }
      await onSave(cleaned, editItem?.id);
      setDialogOpen(false);
    } finally { setSaving(false); }
  };

  const setVal = (key: string, val: unknown) => setValues(v => ({ ...v, [key]: val }));

  const cardTitle = isAr ? titleAr : title;
  const cardDesc  = isAr ? descriptionAr : description;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">{cardTitle}</CardTitle>
            <CardDescription className="text-sm mt-0.5">{cardDesc}</CardDescription>
          </div>
          <Button size="sm" onClick={openAdd} className="shrink-0">
            <Plus className="w-4 h-4 me-1" />
            {isAr ? "إضافة" : "Add"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
            <RefreshCw className="w-4 h-4 animate-spin" />
            {isAr ? "جارٍ التحميل..." : "Loading..."}
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            {isAr ? "لا توجد عناصر - اضغط إضافة للبدء" : "No items yet - click Add to get started."}
          </p>
        ) : (
          <div className="divide-y">
            {items.map(item => (
              <div key={item.id} className="flex items-center justify-between py-2.5 gap-2">
                <div className="flex-1 min-w-0">{renderRow(item)}</div>
                <div className="flex items-center gap-1 shrink-0">
                  {!item.isActive && (
                    <Badge variant="outline" className="text-xs text-muted-foreground">
                      {isAr ? "غير نشط" : "Inactive"}
                    </Badge>
                  )}
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(item)}>
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setDeleteId(item.id)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      {/* ── Form dialog ──────────────────────────────────────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto" dir={isAr ? "rtl" : "ltr"}>
          <DialogHeader>
            <DialogTitle>
              {editItem
                ? (isAr ? `تعديل ${titleAr}` : `Edit ${title}`)
                : (isAr ? `إضافة ${titleAr}` : `New ${title}`)}
            </DialogTitle>
            <DialogDescription>{cardDesc}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            {formFields.map((field, idx) => {
              const label = isAr ? field.labelAr : field.labelEn;
              const isNameField = field.key === codeSourceKey && idx === 0;

              return (
                <div key={field.key} className="grid gap-1.5">
                  <Label htmlFor={field.key}>{label}</Label>

                  {field.type === "boolean" ? (
                    <div className="flex items-center gap-2">
                      <Switch
                        id={field.key}
                        checked={Boolean(values[field.key])}
                        onCheckedChange={v => setVal(field.key, v)}
                      />
                      <span className="text-sm text-muted-foreground">
                        {Boolean(values[field.key])
                          ? (isAr ? "نعم" : "Yes")
                          : (isAr ? "لا" : "No")}
                      </span>
                    </div>

                  ) : field.type === "select" ? (
                    <Select
                      value={String(values[field.key] ?? "__none__")}
                      onValueChange={v => setVal(field.key, v)}
                    >
                      <SelectTrigger id={field.key}>
                        <SelectValue placeholder={isAr ? `اختر ${field.labelAr}` : `Select ${field.labelEn}`} />
                      </SelectTrigger>
                      <SelectContent>
                        {field.options.map(o => (
                          <SelectItem key={o.value} value={o.value}>
                            {isAr ? o.labelAr : o.labelEn}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                  ) : field.type === "textarea" ? (
                    <Textarea
                      id={field.key}
                      value={String(values[field.key] ?? "")}
                      onChange={e => setVal(field.key, e.target.value)}
                      placeholder={field.placeholder}
                      rows={2}
                      dir={field.key === 'nameAr' || field.key === 'titleAr' ? "rtl" : undefined}
                    />

                  ) : field.type === "color" ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        id={field.key}
                        value={String(values[field.key] ?? "#6366f1")}
                        onChange={e => setVal(field.key, e.target.value)}
                        className="h-9 w-16 rounded border cursor-pointer"
                      />
                      <Input
                        value={String(values[field.key] ?? "#6366f1")}
                        onChange={e => setVal(field.key, e.target.value)}
                        className="font-mono"
                        placeholder="#6366f1"
                      />
                    </div>

                  ) : (
                    <>
                      <Input
                        id={field.key}
                        type={field.type === "number" ? "number" : "text"}
                        value={String(values[field.key] ?? "")}
                        onChange={e => setVal(field.key, field.type === "number" ? Number(e.target.value) : e.target.value)}
                        placeholder={field.placeholder}
                        dir={field.key === 'nameAr' || field.key === 'titleAr' ? "rtl" : undefined}
                      />
                      {/* Show live code preview under the primary name field */}
                      {isNameField && computedCode && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Code2 className="w-3 h-3 shrink-0" />
                          <span>{isAr ? "المعرّف التلقائي:" : "System ID:"}</span>
                          <code className="font-mono bg-muted px-1.5 py-0.5 rounded tracking-wide">{computedCode}</code>
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>

          <DialogFooter dir={isAr ? "rtl" : "ltr"}>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {isAr ? "إلغاء" : "Cancel"}
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <RefreshCw className="w-4 h-4 animate-spin me-1" />}
              {editItem
                ? (isAr ? "حفظ التغييرات" : "Save Changes")
                : (isAr ? "إنشاء" : "Create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirm ───────────────────────────────────────────────────── */}
      <AlertDialog open={deleteId !== null} onOpenChange={o => !o && setDeleteId(null)}>
        <AlertDialogContent dir={isAr ? "rtl" : "ltr"}>
          <AlertDialogHeader>
            <AlertDialogTitle>{isAr ? "حذف هذا العنصر؟" : "Delete this item?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {isAr
                ? "لا يمكن التراجع عن هذا الإجراء. العناصر المرتبطة بسجلات موجودة قد تتأثر."
                : "This action cannot be undone. Items in use may affect existing records."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{isAr ? "إلغاء" : "Cancel"}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => { await onDelete(deleteId!); setDeleteId(null); }}
            >
              {isAr ? "حذف" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function HrFoundationPage() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language.startsWith("ar");
  const apiFetch = useApiFetch();
  const queryClient = useQueryClient();
  const { isAdmin } = usePermissions();

  const { data: statuses = [], isLoading: statusesLoading, refetch: refetchStatuses } = useListHrEmployeeStatuses();
  const { data: empTypes = [], isLoading: empTypesLoading, refetch: refetchEmpTypes } = useListHrEmploymentTypes();
  const { data: contractTypes = [], isLoading: contractTypesLoading, refetch: refetchContractTypes } = useListHrContractTypes();
  const { data: workLocations = [], isLoading: workLocationsLoading, refetch: refetchWorkLocations } = useListHrWorkLocations();
  const { data: positions = [], isLoading: positionsLoading, refetch: refetchPositions } = useListHrPositions();
  const { data: docTypes = [], isLoading: docTypesLoading, refetch: refetchDocTypes } = useListHrDocumentTypes();
  const { data: leavePolicies = [], isLoading: leavePoliciesLoading, refetch: refetchLeavePolicies } = useListHrLeavePolicies();
  const { data: probationPolicies = [], isLoading: probationPoliciesLoading, refetch: refetchProbationPolicies } = useListHrProbationPolicies();

  const { data: orgUnits = [], refetch: refetchOrgUnits } = useListHrOrgUnits();
  const { data: jobGrades = [], refetch: refetchJobGrades } = useListHrJobGrades();
  const { data: jobTitles = [], refetch: refetchJobTitles } = useListHrJobTitles();

  const [loading,  setLoading]  = useState<Record<string, boolean>>({});
  const [seeding,  setSeeding]  = useState(false);
  const [activeTab, setActiveTab] = useState("statuses");

  const setLoad = (key: string, val: boolean) => setLoading(prev => ({ ...prev, [key]: val }));

  const refetchAll = () => {
    void refetchStatuses();
    void refetchEmpTypes();
    void refetchContractTypes();
    void refetchWorkLocations();
    void refetchPositions();
    void refetchDocTypes();
    void refetchLeavePolicies();
    void refetchProbationPolicies();
    void refetchOrgUnits();
    void refetchJobGrades();
    void refetchJobTitles();
  };

  const handleSeed = async () => {
    setSeeding(true);
    try {
      await seedHrFoundation();
      toast.success(t("hr_foundation_seed_ok"));
      refetchAll();
    } catch {
      toast.error(t("hr_foundation_seed_fail"));
    } finally { setSeeding(false); }
  };

  function makeCodegenCrud(
    invalidate: () => Promise<unknown>,
    loadKey: string,
    handlers: {
      create: (values: Record<string, unknown>) => Promise<{ id: number }>;
      update: (id: number, values: Record<string, unknown>) => Promise<{ id: number }>;
      remove: (id: number) => Promise<void>;
    },
  ) {
    const save = async (values: Record<string, unknown>, id?: number) => {
      setLoad(loadKey, true);
      try {
        if (id) await handlers.update(id, values);
        else await handlers.create(values);
        await invalidate();
        toast.success(id ? t("hr_entity_updated") : t("hr_entity_created"));
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : t("hr_entity_save_fail"));
      } finally { setLoad(loadKey, false); }
    };

    const del = async (id: number) => {
      setLoad(loadKey, true);
      try {
        await handlers.remove(id);
        await invalidate();
        toast.success(t("hr_entity_deleted"));
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : t("hr_entity_delete_fail"));
      } finally { setLoad(loadKey, false); }
    };

    return { save, del };
  }

  const invalidateOrg = () => queryClient.invalidateQueries({ queryKey: getListHrOrgUnitsQueryKey() });
  const invalidateJg = () => queryClient.invalidateQueries({ queryKey: getListHrJobGradesQueryKey() });
  const invalidateJt = () => queryClient.invalidateQueries({ queryKey: getListHrJobTitlesQueryKey() });

  const ouCrud = makeCodegenCrud(invalidateOrg, "orgUnits", {
    create: (v) => createHrOrgUnit(v as Parameters<typeof createHrOrgUnit>[0]),
    update: (id, v) => updateHrOrgUnit(id, v as Parameters<typeof updateHrOrgUnit>[1]),
    remove: deleteHrOrgUnit,
  });
  const jgCrud = makeCodegenCrud(invalidateJg, "jobGrades", {
    create: (v) => createHrJobGrade(v as Parameters<typeof createHrJobGrade>[0]),
    update: (id, v) => updateHrJobGrade(id, v as Parameters<typeof updateHrJobGrade>[1]),
    remove: deleteHrJobGrade,
  });
  const jtCrud = makeCodegenCrud(invalidateJt, "jobTitles", {
    create: (v) => createHrJobTitle(v as Parameters<typeof createHrJobTitle>[0]),
    update: (id, v) => updateHrJobTitle(id, v as Parameters<typeof updateHrJobTitle>[1]),
    remove: deleteHrJobTitle,
  });

  const invalidateStatuses = () => queryClient.invalidateQueries({ queryKey: getListHrEmployeeStatusesQueryKey() });
  const invalidateEmpTypes = () => queryClient.invalidateQueries({ queryKey: getListHrEmploymentTypesQueryKey() });
  const invalidateContractTypes = () => queryClient.invalidateQueries({ queryKey: getListHrContractTypesQueryKey() });
  const invalidateWorkLocations = () => queryClient.invalidateQueries({ queryKey: getListHrWorkLocationsQueryKey() });
  const invalidatePositions = () => queryClient.invalidateQueries({ queryKey: getListHrPositionsQueryKey() });
  const invalidateDocTypes = () => queryClient.invalidateQueries({ queryKey: getListHrDocumentTypesQueryKey() });
  const invalidateLeavePolicies = () => queryClient.invalidateQueries({ queryKey: getListHrLeavePoliciesQueryKey() });
  const invalidateProbation = () => queryClient.invalidateQueries({ queryKey: getListHrProbationPoliciesQueryKey() });

  const statusCrud = makeCodegenCrud(invalidateStatuses, "statuses", {
    create: (v) => createHrEmployeeStatus(v as Parameters<typeof createHrEmployeeStatus>[0]),
    update: (id, v) => updateHrEmployeeStatus(id, v as Parameters<typeof updateHrEmployeeStatus>[1]),
    remove: deleteHrEmployeeStatus,
  });
  const etCrud = makeCodegenCrud(invalidateEmpTypes, "empTypes", {
    create: (v) => createHrEmploymentType(v as Parameters<typeof createHrEmploymentType>[0]),
    update: (id, v) => updateHrEmploymentType(id, v as Parameters<typeof updateHrEmploymentType>[1]),
    remove: deleteHrEmploymentType,
  });
  const ctCrud = makeCodegenCrud(invalidateContractTypes, "contractTypes", {
    create: (v) => createHrContractType(v as Parameters<typeof createHrContractType>[0]),
    update: (id, v) => updateHrContractType(id, v as Parameters<typeof updateHrContractType>[1]),
    remove: deleteHrContractType,
  });
  const wlCrud = makeCodegenCrud(invalidateWorkLocations, "workLocations", {
    create: (v) => createHrWorkLocation(v as Parameters<typeof createHrWorkLocation>[0]),
    update: (id, v) => updateHrWorkLocation(id, v as Parameters<typeof updateHrWorkLocation>[1]),
    remove: deleteHrWorkLocation,
  });
  const posCrud = makeCodegenCrud(invalidatePositions, "positions", {
    create: (v) => createHrPosition(v as Parameters<typeof createHrPosition>[0]),
    update: (id, v) => updateHrPosition(id, v as Parameters<typeof updateHrPosition>[1]),
    remove: deleteHrPosition,
  });
  const dtCrud = makeCodegenCrud(invalidateDocTypes, "docTypes", {
    create: (v) => createHrDocumentType(v as Parameters<typeof createHrDocumentType>[0]),
    update: (id, v) => updateHrDocumentType(id, v as Parameters<typeof updateHrDocumentType>[1]),
    remove: deleteHrDocumentType,
  });
  const lpCrud = makeCodegenCrud(invalidateLeavePolicies, "leavePolicies", {
    create: (v) => createHrLeavePolicy(v as Parameters<typeof createHrLeavePolicy>[0]),
    update: (id, v) => updateHrLeavePolicy(id, v as Parameters<typeof updateHrLeavePolicy>[1]),
    remove: deleteHrLeavePolicy,
  });
  const probCrud = makeCodegenCrud(invalidateProbation, "probation", {
    create: (v) => createHrProbationPolicy(v as Parameters<typeof createHrProbationPolicy>[0]),
    update: (id, v) => updateHrProbationPolicy(id, v as Parameters<typeof updateHrProbationPolicy>[1]),
    remove: deleteHrProbationPolicy,
  });

  // ── Shared option lists ────────────────────────────────────────────────────
  // Use "__none__" sentinel (never empty string - Radix SelectItem rejects it)
  const noneOpt = { value: "__none__", labelEn: "- None -", labelAr: "- لا يوجد -" };
  const ouOpts  = [noneOpt, ...orgUnits.map(o => ({ value: String(o.id), labelEn: o.name, labelAr: o.nameAr || o.name }))];
  const jgOpts  = [noneOpt, ...jobGrades.map(o => ({ value: String(o.id), labelEn: o.name, labelAr: o.nameAr || o.name }))];
  const jtOpts  = [noneOpt, ...jobTitles.map(o => ({ value: String(o.id), labelEn: o.name, labelAr: o.nameAr || o.name }))];
  const wlOpts  = [noneOpt, ...workLocations.map(o => ({ value: String(o.id), labelEn: o.name, labelAr: o.nameAr || o.name }))];

  // ── Position status class map ──────────────────────────────────────────────
  const posStatusCls: Record<string, string> = {
    vacant:   "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
    filled:   "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
    frozen:   "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
    archived: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  };
  const posStatusLabelAr: Record<string, string> = {
    vacant: "شاغر", filled: "مشغول", frozen: "مجمّد", archived: "مؤرشف",
  };
  const leaveTypeAr: Record<string, string> = {
    annual: "سنوية", sick: "مرضية", emergency: "طارئة",
    maternity: "أمومة", paternity: "أبوة", unpaid: "بدون راتب", other: "أخرى",
  };
  const leaveTypeEn: Record<string, string> = {
    annual: "Annual", sick: "Sick", emergency: "Emergency",
    maternity: "Maternity", paternity: "Paternity", unpaid: "Unpaid", other: "Other",
  };

  async function downloadEmployeeTemplate() {
    try {
      await downloadWithAuth(`${BASE}/api/hr/employees/import-template`, "employee_import_template.xlsx");
      toast.success(t("hr_foundation_template_ok"));
    } catch {
      toast.error(t("hr_foundation_template_fail"));
    }
  }

  async function exportMasterData() {
    try {
      const r = await apiFetch("/api/hr/import/export/master-data");
      if (!r.ok) throw new Error("export failed");
      const data = await r.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `hr_master_data_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(t("hr_foundation_export_ok"));
    } catch {
      toast.error(t("hr_foundation_export_fail"));
    }
  }

  // ── Tab definitions ────────────────────────────────────────────────────────
  const tabs = [
    { id: "statuses",         labelEn: "Statuses",        labelAr: "الحالات",          Icon: UserCheck  },
    { id: "employment-types", labelEn: "Emp. Types",       labelAr: "أنواع التوظيف",    Icon: Briefcase  },
    { id: "contract-types",   labelEn: "Contract Types",   labelAr: "أنواع العقود",     Icon: FileText   },
    { id: "work-locations",   labelEn: "Work Locations",   labelAr: "مواقع العمل",      Icon: MapPin     },
    { id: "positions",        labelEn: "Positions",        labelAr: "المناصب",          Icon: Settings   },
    { id: "doc-types",        labelEn: "Document Types",   labelAr: "أنواع المستندات",  Icon: FileText   },
    { id: "leave-policies",   labelEn: "Leave Policies",   labelAr: "سياسات الإجازات", Icon: Calendar   },
    { id: "probation",        labelEn: "Probation",        labelAr: "فترة الاختبار",    Icon: Shield     },
    { id: "org-units",        labelEn: "Org Units",        labelAr: "الوحدات التنظيمية",Icon: Building2  },
    { id: "job-grades",       labelEn: "Job Grades",       labelAr: "الدرجات الوظيفية",Icon: Star       },
    { id: "job-titles",       labelEn: "Job Titles",       labelAr: "المسمّيات الوظيفية",Icon: Tags      },
  ];

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto" dir={isAr ? "rtl" : "ltr"}>
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Layers className="w-6 h-6 text-primary" />
            {t("hr_foundation_title")}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {t("hr_foundation_subtitle")}
          </p>
        </div>
        {isAdmin && (
          <Button variant="outline" onClick={handleSeed} disabled={seeding} className="shrink-0">
            {seeding
              ? <RefreshCw className="w-4 h-4 animate-spin me-2" />
              : <Sparkles className="w-4 h-4 me-2" />}
            {t("hr_foundation_seed")}
          </Button>
        )}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Upload className="w-4 h-4" />
            {t("hr_foundation_import_export")}
          </CardTitle>
          <CardDescription>
            {t("hr_foundation_import_desc")}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={downloadEmployeeTemplate}>
            <FileSpreadsheet className="w-4 h-4 me-2 text-green-600" />
            {t("hr_foundation_template")}
          </Button>
          <Button variant="outline" size="sm" onClick={exportMasterData}>
            <Download className="w-4 h-4 me-2" />
            {t("hr_foundation_export")}
          </Button>
          <Button variant="ghost" size="sm" onClick={refetchAll}>
            <RefreshCw className="w-4 h-4 me-2" />
            {t("hr_foundation_refresh")}
          </Button>
        </CardContent>
      </Card>

      {/* ── Tabs ──────────────────────────────────────────────────────────── */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex flex-wrap h-auto gap-1 bg-muted p-1 w-full">
          {tabs.map(({ id, labelEn, labelAr, Icon }) => (
            <TabsTrigger key={id} value={id} className="flex items-center gap-1.5 text-xs h-8 px-2.5">
              <Icon className="w-3.5 h-3.5" />
              {isAr ? labelAr : labelEn}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* ── EMPLOYEE STATUSES ──────────────────────────────────────────── */}
        <TabsContent value="statuses" className="mt-4">
          <SimpleEntityCard
            title="Employee Statuses" titleAr="حالات الموظفين"
            description="Dynamic status definitions. Mark terminal statuses (Resigned, Terminated) as Final."
            descriptionAr="تعريف الحالات الديناميكية. علّم الحالات النهائية (استقالة، إنهاء خدمة) بـ 'نهائية'."
            items={statuses as BaseEntity[]}
            loading={Boolean(loading.statuses) || statusesLoading}
            onSave={statusCrud.save}
            onDelete={statusCrud.del}
            isAr={isAr}
            codeSourceKey="name"
            formFields={[
              { key: "name",             type: "text",    labelEn: "Name (English)",                   labelAr: "الاسم (إنجليزي)",           placeholder: "e.g. Active" },
              { key: "nameAr",           type: "text",    labelEn: "Name (Arabic)",                    labelAr: "الاسم (عربي)",               placeholder: "مثال: نشط" },
              { key: "color",            type: "color",   labelEn: "Colour",                           labelAr: "اللون" },
              { key: "displayOrder",     type: "number",  labelEn: "Display Order",                    labelAr: "ترتيب العرض" },
              { key: "isDefault",        type: "boolean", labelEn: "Default Status",                   labelAr: "الحالة الافتراضية" },
              { key: "isFinal",          type: "boolean", labelEn: "Terminal (Resigned / Terminated)",  labelAr: "نهائية (استقالة / إنهاء)" },
              { key: "allowSelfService", type: "boolean", labelEn: "Allow Self-Service",               labelAr: "السماح بالخدمة الذاتية" },
              { key: "isActive",         type: "boolean", labelEn: "Active",                           labelAr: "نشط" },
            ]}
            renderRow={item => {
              const s = item as HrEmployeeStatus;
              return (
                <div className="flex items-center gap-2 flex-wrap">
                  <ColorDot color={s.color} />
                  <span className="font-medium text-sm">{isAr && s.nameAr ? s.nameAr : s.name}</span>
                  {s.isDefault && <Badge variant="secondary" className="text-xs">{isAr ? "افتراضي" : "Default"}</Badge>}
                  {s.isFinal   && <Badge variant="outline" className="text-xs text-destructive border-destructive/30">{isAr ? "نهائية" : "Terminal"}</Badge>}
                  <CodePreview code={s.code} />
                </div>
              );
            }}
          />
        </TabsContent>

        {/* ── EMPLOYMENT TYPES ───────────────────────────────────────────── */}
        <TabsContent value="employment-types" className="mt-4">
          <SimpleEntityCard
            title="Employment Types" titleAr="أنواع التوظيف"
            description="Full-time, Part-time, Contractor, Intern, Temporary - fully configurable."
            descriptionAr="دوام كامل، جزئي، متعاقد، متدرب، مؤقت - قابل للتهيئة الكاملة."
            items={empTypes as BaseEntity[]}
            loading={Boolean(loading.empTypes) || empTypesLoading}
            onSave={etCrud.save}
            onDelete={etCrud.del}
            isAr={isAr}
            codeSourceKey="name"
            formFields={[
              { key: "name",         type: "text",   labelEn: "Name (English)", labelAr: "الاسم (إنجليزي)", placeholder: "e.g. Full-Time" },
              { key: "nameAr",       type: "text",   labelEn: "Name (Arabic)",  labelAr: "الاسم (عربي)",    placeholder: "مثال: دوام كامل" },
              { key: "color",        type: "color",  labelEn: "Colour",         labelAr: "اللون" },
              { key: "displayOrder", type: "number", labelEn: "Display Order",  labelAr: "ترتيب العرض" },
              { key: "isActive",     type: "boolean",labelEn: "Active",         labelAr: "نشط" },
            ]}
            renderRow={item => {
              const e = item as HrEmploymentType;
              return (
                <div className="flex items-center gap-2">
                  <ColorDot color={e.color} />
                  <span className="font-medium text-sm">{isAr && e.nameAr ? e.nameAr : e.name}</span>
                  <CodePreview code={e.code} />
                </div>
              );
            }}
          />
        </TabsContent>

        {/* ── CONTRACT TYPES ──────────────────────────────────────────────── */}
        <TabsContent value="contract-types" className="mt-4">
          <SimpleEntityCard
            title="Contract Types" titleAr="أنواع العقود"
            description="Annual, Open-Ended, Project-Based, Training - fully configurable."
            descriptionAr="سنوي، مفتوح المدة، مشروع، تدريب - قابل للتهيئة الكاملة."
            items={contractTypes as BaseEntity[]}
            loading={Boolean(loading.contractTypes) || contractTypesLoading}
            onSave={ctCrud.save}
            onDelete={ctCrud.del}
            isAr={isAr}
            codeSourceKey="name"
            formFields={[
              { key: "name",         type: "text",   labelEn: "Name (English)", labelAr: "الاسم (إنجليزي)", placeholder: "e.g. Annual" },
              { key: "nameAr",       type: "text",   labelEn: "Name (Arabic)",  labelAr: "الاسم (عربي)",    placeholder: "مثال: سنوي" },
              { key: "color",        type: "color",  labelEn: "Colour",         labelAr: "اللون" },
              { key: "displayOrder", type: "number", labelEn: "Display Order",  labelAr: "ترتيب العرض" },
              { key: "isActive",     type: "boolean",labelEn: "Active",         labelAr: "نشط" },
            ]}
            renderRow={item => {
              const c = item as HrContractType;
              return (
                <div className="flex items-center gap-2">
                  <ColorDot color={c.color} />
                  <span className="font-medium text-sm">{isAr && c.nameAr ? c.nameAr : c.name}</span>
                  <CodePreview code={c.code} />
                </div>
              );
            }}
          />
        </TabsContent>

        {/* ── WORK LOCATIONS ──────────────────────────────────────────────── */}
        <TabsContent value="work-locations" className="mt-4">
          <SimpleEntityCard
            title="Work Locations" titleAr="مواقع العمل"
            description="Office branches, remote, hybrid, and field sites."
            descriptionAr="الفروع، العمل عن بُعد، الهجين، والمواقع الميدانية."
            items={workLocations as BaseEntity[]}
            loading={Boolean(loading.workLocations) || workLocationsLoading}
            onSave={wlCrud.save}
            onDelete={wlCrud.del}
            isAr={isAr}
            codeSourceKey="name"
            formFields={[
              { key: "name",         type: "text",   labelEn: "Name (English)", labelAr: "الاسم (إنجليزي)", placeholder: "e.g. Riyadh HQ" },
              { key: "nameAr",       type: "text",   labelEn: "Name (Arabic)",  labelAr: "الاسم (عربي)",    placeholder: "مثال: مقر الرياض" },
              { key: "type",         type: "select", labelEn: "Type",           labelAr: "النوع",
                options: [
                  { value: "office", labelEn: "Office",  labelAr: "مكتب" },
                  { value: "remote", labelEn: "Remote",  labelAr: "عن بُعد" },
                  { value: "hybrid", labelEn: "Hybrid",  labelAr: "هجين" },
                  { value: "field",  labelEn: "Field",   labelAr: "ميداني" },
                ]},
              { key: "city",         type: "text",   labelEn: "City",           labelAr: "المدينة" },
              { key: "country",      type: "text",   labelEn: "Country",        labelAr: "الدولة" },
              { key: "address",      type: "text",   labelEn: "Address",        labelAr: "العنوان" },
              { key: "timezone",     type: "text",   labelEn: "Timezone",       labelAr: "المنطقة الزمنية", placeholder: "e.g. Asia/Riyadh" },
              { key: "displayOrder", type: "number", labelEn: "Display Order",  labelAr: "ترتيب العرض" },
              { key: "isActive",     type: "boolean",labelEn: "Active",         labelAr: "نشط" },
            ]}
            renderRow={item => {
              const w = item as HrWorkLocation;
              const typeLabels: Record<string, [string, string]> = {
                office: ["Office", "مكتب"], remote: ["Remote", "عن بُعد"],
                hybrid: ["Hybrid", "هجين"], field: ["Field", "ميداني"],
              };
              return (
                <div className="flex items-center gap-2 flex-wrap">
                  <MapPin className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span className="font-medium text-sm">{isAr && w.nameAr ? w.nameAr : w.name}</span>
                  <Badge variant="secondary" className="text-xs">
                    {isAr ? (typeLabels[w.type]?.[1] ?? w.type) : (typeLabels[w.type]?.[0] ?? w.type)}
                  </Badge>
                  {w.city && <span className="text-muted-foreground text-xs">{w.city}</span>}
                </div>
              );
            }}
          />
        </TabsContent>

        {/* ── POSITIONS ───────────────────────────────────────────────────── */}
        <TabsContent value="positions" className="mt-4">
          <SimpleEntityCard
            title="Positions" titleAr="المناصب"
            description='Actual seats in the org chart - distinct from Job Titles.'
            descriptionAr='المقاعد الفعلية في الهيكل التنظيمي - مختلفة عن المسمّيات الوظيفية.'
            items={positions as BaseEntity[]}
            loading={Boolean(loading.positions) || positionsLoading}
            onSave={posCrud.save}
            onDelete={posCrud.del}
            isAr={isAr}
            codeSourceKey="title"
            formFields={[
              { key: "title",          type: "text",   labelEn: "Position Title (English)", labelAr: "عنوان المنصب (إنجليزي)" },
              { key: "titleAr",        type: "text",   labelEn: "Position Title (Arabic)",  labelAr: "عنوان المنصب (عربي)" },
              { key: "description",    type: "textarea",labelEn: "Description",             labelAr: "الوصف" },
              { key: "status",         type: "select", labelEn: "Status",                   labelAr: "الحالة",
                options: [
                  { value: "vacant",   labelEn: "Vacant",   labelAr: "شاغر" },
                  { value: "filled",   labelEn: "Filled",   labelAr: "مشغول" },
                  { value: "frozen",   labelEn: "Frozen",   labelAr: "مجمّد" },
                  { value: "archived", labelEn: "Archived", labelAr: "مؤرشف" },
                ]},
              { key: "headcount",      type: "number", labelEn: "Headcount",                labelAr: "العدد المطلوب" },
              { key: "jobTitleId",     type: "select", labelEn: "Job Title",                labelAr: "المسمّى الوظيفي", options: jtOpts },
              { key: "orgUnitId",      type: "select", labelEn: "Org Unit / Department",    labelAr: "الوحدة التنظيمية / القسم", options: ouOpts },
              { key: "jobGradeId",     type: "select", labelEn: "Job Grade",                labelAr: "الدرجة الوظيفية", options: jgOpts },
              { key: "workLocationId", type: "select", labelEn: "Work Location",            labelAr: "موقع العمل", options: wlOpts },
              { key: "displayOrder",   type: "number", labelEn: "Display Order",            labelAr: "ترتيب العرض" },
              { key: "isActive",       type: "boolean",labelEn: "Active",                   labelAr: "نشط" },
            ]}
            renderRow={item => {
              const p = item as HrPosition;
              const s = p.status;
              return (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">{isAr && p.titleAr ? p.titleAr : p.title}</span>
                  <Badge className={`text-xs ${posStatusCls[s] ?? ""}`}>
                    {isAr ? posStatusLabelAr[s] ?? s : s}
                  </Badge>
                  <span className="text-xs text-muted-foreground">{p.currentOccupancy}/{p.headcount}</span>
                </div>
              );
            }}
          />
        </TabsContent>

        {/* ── DOCUMENT TYPES ──────────────────────────────────────────────── */}
        <TabsContent value="doc-types" className="mt-4">
          <SimpleEntityCard
            title="Document Types" titleAr="أنواع المستندات"
            description="National ID, Passport, Certificates, Work Permits - define all categories."
            descriptionAr="هوية وطنية، جواز سفر، شهادات، تصاريح عمل - عرّف جميع الفئات هنا."
            items={docTypes as BaseEntity[]}
            loading={Boolean(loading.docTypes) || docTypesLoading}
            onSave={dtCrud.save}
            onDelete={dtCrud.del}
            isAr={isAr}
            codeSourceKey="name"
            formFields={[
              { key: "name",         type: "text",   labelEn: "Name (English)",  labelAr: "الاسم (إنجليزي)", placeholder: "e.g. National ID" },
              { key: "nameAr",       type: "text",   labelEn: "Name (Arabic)",   labelAr: "الاسم (عربي)",    placeholder: "مثال: هوية وطنية" },
              { key: "hasExpiry",    type: "boolean",labelEn: "Has Expiry Date", labelAr: "له تاريخ انتهاء" },
              { key: "isRequired",   type: "boolean",labelEn: "Required",        labelAr: "إلزامي" },
              { key: "displayOrder", type: "number", labelEn: "Display Order",   labelAr: "ترتيب العرض" },
              { key: "isActive",     type: "boolean",labelEn: "Active",          labelAr: "نشط" },
            ]}
            renderRow={item => {
              const d = item as HrDocumentType;
              return (
                <div className="flex items-center gap-2 flex-wrap">
                  <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span className="font-medium text-sm">{isAr && d.nameAr ? d.nameAr : d.name}</span>
                  {d.isRequired && <Badge className="text-xs bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300">{isAr ? "إلزامي" : "Required"}</Badge>}
                  {d.hasExpiry  && <Badge variant="outline" className="text-xs">{isAr ? "له انتهاء" : "Has Expiry"}</Badge>}
                </div>
              );
            }}
          />
        </TabsContent>

        {/* ── LEAVE POLICIES ──────────────────────────────────────────────── */}
        <TabsContent value="leave-policies" className="mt-4">
          <SimpleEntityCard
            title="Leave Policies" titleAr="سياسات الإجازات"
            description="Annual days, accrual type, carry-over, paid/unpaid - one policy per leave type."
            descriptionAr="الأيام السنوية، نوع الاستحقاق، الترحيل، مدفوعة/غير مدفوعة - سياسة لكل نوع."
            items={leavePolicies as BaseEntity[]}
            loading={Boolean(loading.leavePolicies) || leavePoliciesLoading}
            onSave={lpCrud.save}
            onDelete={lpCrud.del}
            isAr={isAr}
            codeSourceKey="name"
            formFields={[
              { key: "name",            type: "text",   labelEn: "Name (English)", labelAr: "الاسم (إنجليزي)" },
              { key: "nameAr",          type: "text",   labelEn: "Name (Arabic)",  labelAr: "الاسم (عربي)" },
              { key: "leaveType",       type: "select", labelEn: "Leave Type",     labelAr: "نوع الإجازة",
                options: [
                  { value: "annual",    labelEn: "Annual",    labelAr: "سنوية" },
                  { value: "sick",      labelEn: "Sick",      labelAr: "مرضية" },
                  { value: "emergency", labelEn: "Emergency", labelAr: "طارئة" },
                  { value: "maternity", labelEn: "Maternity", labelAr: "أمومة" },
                  { value: "paternity", labelEn: "Paternity", labelAr: "أبوة" },
                  { value: "unpaid",    labelEn: "Unpaid",    labelAr: "بدون راتب" },
                  { value: "other",     labelEn: "Other",     labelAr: "أخرى" },
                ]},
              { key: "annualDays",      type: "number", labelEn: "Annual Days",           labelAr: "الأيام السنوية" },
              { key: "accrualType",     type: "select", labelEn: "Accrual",               labelAr: "طريقة الاستحقاق",
                options: [
                  { value: "monthly", labelEn: "Monthly",           labelAr: "شهري" },
                  { value: "annual",  labelEn: "Annual (lump sum)", labelAr: "سنوي (دفعة واحدة)" },
                  { value: "none",    labelEn: "None",              labelAr: "لا يوجد" },
                ]},
              { key: "carryOver",       type: "boolean",labelEn: "Allow Carry-Over",      labelAr: "السماح بالترحيل" },
              { key: "maxCarryOverDays",type: "number", labelEn: "Max Carry-Over (days)", labelAr: "حد أقصى للترحيل (أيام)" },
              { key: "paid",            type: "boolean",labelEn: "Paid Leave",            labelAr: "إجازة مدفوعة" },
              { key: "requiresApproval",type: "boolean",labelEn: "Requires Approval",     labelAr: "تتطلب موافقة" },
              { key: "displayOrder",    type: "number", labelEn: "Display Order",         labelAr: "ترتيب العرض" },
              { key: "isActive",        type: "boolean",labelEn: "Active",                labelAr: "نشط" },
            ]}
            renderRow={item => {
              const l = item as HrLeavePolicy;
              return (
                <div className="flex items-center gap-2 flex-wrap">
                  <Calendar className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span className="font-medium text-sm">{isAr && l.nameAr ? l.nameAr : l.name}</span>
                  <Badge variant="secondary" className="text-xs">
                    {isAr ? leaveTypeAr[l.leaveType] ?? l.leaveType : leaveTypeEn[l.leaveType] ?? l.leaveType}
                  </Badge>
                  <span className="text-xs text-muted-foreground">{l.annualDays} {isAr ? "يوم/سنة" : "days/yr"}</span>
                  {l.paid
                    ? <Badge className="text-xs bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300">{isAr ? "مدفوعة" : "Paid"}</Badge>
                    : <Badge variant="outline" className="text-xs">{isAr ? "غير مدفوعة" : "Unpaid"}</Badge>}
                  {l.carryOver && <Badge variant="outline" className="text-xs">{isAr ? "ترحيل" : "Carry-Over"}</Badge>}
                </div>
              );
            }}
          />
        </TabsContent>

        {/* ── PROBATION POLICIES ──────────────────────────────────────────── */}
        <TabsContent value="probation" className="mt-4">
          <SimpleEntityCard
            title="Probation Policies" titleAr="سياسات فترة الاختبار"
            description="Duration and extension rules for different employee categories."
            descriptionAr="مدة الاختبار وقواعد التمديد لفئات الموظفين المختلفة."
            items={probationPolicies as BaseEntity[]}
            loading={Boolean(loading.probation) || probationPoliciesLoading}
            onSave={probCrud.save}
            onDelete={probCrud.del}
            isAr={isAr}
            codeSourceKey="name"
            formFields={[
              { key: "name",             type: "text",   labelEn: "Name (English)",          labelAr: "الاسم (إنجليزي)" },
              { key: "nameAr",           type: "text",   labelEn: "Name (Arabic)",           labelAr: "الاسم (عربي)" },
              { key: "durationDays",     type: "number", labelEn: "Duration (days)",         labelAr: "المدة (أيام)" },
              { key: "extendable",       type: "boolean",labelEn: "Extendable",              labelAr: "قابلة للتمديد" },
              { key: "maxExtensionDays", type: "number", labelEn: "Max Extension (days)",    labelAr: "أقصى تمديد (أيام)" },
              { key: "isActive",         type: "boolean",labelEn: "Active",                  labelAr: "نشط" },
            ]}
            renderRow={item => {
              const p = item as HrProbationPolicy;
              return (
                <div className="flex items-center gap-2">
                  <Shield className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span className="font-medium text-sm">{isAr && p.nameAr ? p.nameAr : p.name}</span>
                  <Badge variant="secondary" className="text-xs">{p.durationDays} {isAr ? "يوم" : "days"}</Badge>
                  {p.extendable && (
                    <Badge variant="outline" className="text-xs">
                      {isAr ? "قابلة للتمديد" : "Extendable"}{p.maxExtensionDays ? ` +${p.maxExtensionDays}` : ""}
                    </Badge>
                  )}
                </div>
              );
            }}
          />
        </TabsContent>

        {/* ── ORG UNITS ───────────────────────────────────────────────────── */}
        <TabsContent value="org-units" className="mt-4">
          <SimpleEntityCard
            title="Org Units / Departments" titleAr="الوحدات التنظيمية / الأقسام"
            description="Company → Division → Department → Team hierarchy."
            descriptionAr="شركة ← إدارة ← قسم ← فريق - هيكل تنظيمي هرمي."
            items={orgUnits as BaseEntity[]}
            loading={Boolean(loading.orgUnits)}
            onSave={ouCrud.save}
            onDelete={ouCrud.del}
            isAr={isAr}
            codeSourceKey="name"
            formFields={[
              { key: "name",     type: "text",   labelEn: "Name (English)", labelAr: "الاسم (إنجليزي)" },
              { key: "nameAr",   type: "text",   labelEn: "Name (Arabic)",  labelAr: "الاسم (عربي)" },
              { key: "type",     type: "select", labelEn: "Type",           labelAr: "النوع",
                options: [
                  { value: "company",    labelEn: "Company",    labelAr: "شركة" },
                  { value: "division",   labelEn: "Division",   labelAr: "إدارة" },
                  { value: "department", labelEn: "Department", labelAr: "قسم" },
                  { value: "team",       labelEn: "Team",       labelAr: "فريق" },
                  { value: "unit",       labelEn: "Unit",       labelAr: "وحدة" },
                ]},
              { key: "parentId", type: "select", labelEn: "Parent Unit",   labelAr: "الوحدة الأم", options: ouOpts },
              { key: "isActive", type: "boolean",labelEn: "Active",        labelAr: "نشط" },
            ]}
            renderRow={item => {
              const o = item as HrOrgUnit;
              const typeAr: Record<string, string> = { company: "شركة", division: "إدارة", department: "قسم", team: "فريق", unit: "وحدة" };
              return (
                <div className="flex items-center gap-2">
                  <Building2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span className="font-medium text-sm">{isAr && o.nameAr ? o.nameAr : o.name}</span>
                  <Badge variant="secondary" className="text-xs capitalize">
                    {isAr ? typeAr[o.type] ?? o.type : o.type}
                  </Badge>
                </div>
              );
            }}
          />
        </TabsContent>

        {/* ── JOB GRADES ──────────────────────────────────────────────────── */}
        <TabsContent value="job-grades" className="mt-4">
          <SimpleEntityCard
            title="Job Grades" titleAr="الدرجات الوظيفية"
            description="Career levels and grade bands - linked to salary ranges and policies."
            descriptionAr="المستويات الوظيفية والدرجات - مرتبطة بنطاقات الرواتب والسياسات."
            items={jobGrades as BaseEntity[]}
            loading={Boolean(loading.jobGrades)}
            onSave={jgCrud.save}
            onDelete={jgCrud.del}
            isAr={isAr}
            codeSourceKey="name"
            formFields={[
              { key: "name",        type: "text",    labelEn: "Grade Name (English)", labelAr: "اسم الدرجة (إنجليزي)", placeholder: "e.g. Senior" },
              { key: "nameAr",      type: "text",    labelEn: "Grade Name (Arabic)",  labelAr: "اسم الدرجة (عربي)",    placeholder: "مثال: أول" },
              { key: "level",       type: "number",  labelEn: "Level (numeric)",      labelAr: "المستوى (رقمي)" },
              { key: "description", type: "textarea",labelEn: "Description",          labelAr: "الوصف" },
              { key: "isActive",    type: "boolean", labelEn: "Active",               labelAr: "نشط" },
            ]}
            renderRow={item => {
              const g = item as HrJobGrade;
              return (
                <div className="flex items-center gap-2">
                  <Star className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span className="font-medium text-sm">{isAr && g.nameAr ? g.nameAr : g.name}</span>
                  {g.level != null && <Badge variant="secondary" className="text-xs">{isAr ? `مستوى ${g.level}` : `Level ${g.level}`}</Badge>}
                  <CodePreview code={g.code ?? ''} />
                </div>
              );
            }}
          />
        </TabsContent>

        {/* ── JOB TITLES ──────────────────────────────────────────────────── */}
        <TabsContent value="job-titles" className="mt-4">
          <SimpleEntityCard
            title="Job Titles" titleAr="المسمّيات الوظيفية"
            description='The name of the role - stored as a relation, never free text.'
            descriptionAr='اسم الدور الوظيفي - مخزّن كعلاقة، لا نص حر.'
            items={jobTitles as BaseEntity[]}
            loading={Boolean(loading.jobTitles)}
            onSave={jtCrud.save}
            onDelete={jtCrud.del}
            isAr={isAr}
            codeSourceKey="name"
            formFields={[
              { key: "name",        type: "text",    labelEn: "Title (English)", labelAr: "الاسم (إنجليزي)", placeholder: "e.g. Network Engineer" },
              { key: "nameAr",      type: "text",    labelEn: "Title (Arabic)",  labelAr: "الاسم (عربي)",    placeholder: "مثال: مهندس شبكات" },
              { key: "description", type: "textarea",labelEn: "Description",     labelAr: "الوصف" },
              { key: "isActive",    type: "boolean", labelEn: "Active",          labelAr: "نشط" },
            ]}
            renderRow={item => {
              const j = item as HrJobTitle;
              return (
                <div className="flex items-center gap-2">
                  <Briefcase className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span className="font-medium text-sm">{isAr && j.nameAr ? j.nameAr : j.name}</span>
                  <CodePreview code={j.code ?? ''} />
                </div>
              );
            }}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
