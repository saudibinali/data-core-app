import { useState } from "react";
import { useLocation, useParams } from "wouter";
import { useTranslation } from "react-i18next";
import {
  useGetForm, useUpdateForm, useDeleteForm, useAddFormField, useUpdateFormField,
  useDeleteFormField, useReorderFormFields, useListFormSubmissions,
  useUpdateSubmissionStatus, useListFormDataSources, useGetFormDataSourceData,
} from "@workspace/api-client-react";
import {
  ArrowLeft, ClipboardList, Plus, Trash2, GripVertical,
  ChevronDown, ChevronUp, Save, Loader2, Eye, CheckCircle2,
  XCircle, Clock, Settings, List, Database, Layers, Users, Archive,
  Building2, GitFork, Shield, Box, Ticket, UsersRound,
  UserCog, ShieldCheck, User, ShieldPlus, Zap,
  AlignLeft, AlignJustify, Hash, Mail, Phone, Calendar,
  CheckSquare, ToggleLeft, ToggleRight, Paperclip, Sparkles, Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import FormAudienceBuilder from "@/components/forms/form-audience-builder";
import FormWorkflowBuilder from "@/components/forms/form-workflow-builder";
import {
  FORM_CATEGORIES, DEFAULT_AUDIENCE, DEFAULT_WORKFLOW_PLAN,
  buildFormWorkflowEventPreview,
  type FormAudienceConfig, type FormWorkflowPlan,
} from "@/lib/form-smart-types";
import { formatDistanceToNow } from "date-fns";

// ── Icon map for data source categories ───────────────────────────────────────
const DS_ICON_MAP: Record<string, React.ElementType> = {
  Users, Building2, GitFork, Shield, Box, Ticket, UsersRound,
  UserCog, ShieldCheck, User, ShieldPlus, Zap,
};

function DsIcon({ icon, className }: { icon: string; className?: string }) {
  const Icon = DS_ICON_MAP[icon] ?? Database;
  return <Icon className={className ?? "w-4 h-4"} />;
}

// ── Category colours ──────────────────────────────────────────────────────────
const CAT_STYLE: Record<string, string> = {
  people:       "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  organization: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  operations:   "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  automation:   "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  access:       "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
  platform:     "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
};

const FIELD_TYPES = [
  { value: "text",              label: "Text" },
  { value: "textarea",          label: "Long Text" },
  { value: "number",            label: "Number" },
  { value: "email",             label: "Email" },
  { value: "phone",             label: "Phone" },
  { value: "date",              label: "Date" },
  { value: "time",              label: "Time" },
  { value: "dropdown",          label: "Dropdown" },
  { value: "radio",             label: "Radio Buttons" },
  { value: "checkbox",          label: "Checkboxes" },
  { value: "multi_select",      label: "Multi-select" },
  { value: "boolean",           label: "Yes / No" },
  { value: "file",              label: "File Upload" },
  { value: "user",              label: "User Picker" },
  { value: "department",        label: "Department Picker" },
  { value: "employee_lookup",   label: "Employee Lookup (رقم الموظف)" },
];

const FRIENDLY_TYPES: { value: string; label: string; labelAr: string; Icon: React.ElementType; hint?: string; hintAr?: string }[] = [
  { value: "text",            label: "Short Answer",      labelAr: "إجابة قصيرة",    Icon: AlignLeft },
  { value: "textarea",        label: "Long Answer",       labelAr: "إجابة مطولة",    Icon: AlignJustify },
  { value: "number",          label: "Number",            labelAr: "رقم",             Icon: Hash },
  { value: "email",           label: "Email",             labelAr: "بريد إلكتروني",  Icon: Mail },
  { value: "phone",           label: "Phone",             labelAr: "هاتف",            Icon: Phone },
  { value: "date",            label: "Date",              labelAr: "تاريخ",           Icon: Calendar },
  { value: "time",            label: "Time",              labelAr: "وقت",             Icon: Clock },
  { value: "dropdown",        label: "Single Choice",     labelAr: "اختيار واحد",    Icon: ChevronDown },
  { value: "checkbox",        label: "Multiple Choice",   labelAr: "اختيار متعدد",   Icon: CheckSquare },
  { value: "boolean",         label: "Yes / No",          labelAr: "نعم / لا",        Icon: ToggleLeft },
  { value: "file",            label: "File Upload",       labelAr: "رفع ملف",         Icon: Paperclip },
  {
    value:   "employee_lookup",
    label:   "Employee Lookup",
    labelAr: "بحث برقم الموظف",
    Icon:    User,
    hint:    "Auto-fills name, manager & department from employee number",
    hintAr:  "يملأ الاسم والمدير والقسم تلقائياً من رقم الموظف",
  },
];

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    active:           "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
    draft:            "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
    archived:         "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
    submitted:        "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
    pending_approval: "bg-amber-100 text-amber-700",
    approved:         "bg-emerald-100 text-emerald-700",
    rejected:         "bg-red-100 text-red-700",
    completed:        "bg-teal-100 text-teal-700",
    cancelled:        "bg-slate-100 text-slate-700",
  };
  return (
    <span className={`px-1.5 py-0.5 rounded text-xs font-medium border-0 ${map[status] ?? "bg-muted text-muted-foreground"}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

// ── Field form state ──────────────────────────────────────────────────────────
type SourceType = "static" | "dynamic";

interface AddFieldForm {
  name:         string;
  label:        string;
  labelAr:      string;
  type:         string;
  required:     boolean;
  placeholder:  string;
  defaultValue: string;
  optionsRaw:   string;
  // dynamic data source
  sourceType:   SourceType;
  dsKey:        string;   // selected data source key
  dsMultiple:   boolean;
}

const EMPTY_FIELD: AddFieldForm = {
  name: "", label: "", labelAr: "", type: "text",
  required: false, placeholder: "", defaultValue: "", optionsRaw: "",
  sourceType: "static", dsKey: "", dsMultiple: false,
};

function parseOptions(raw: string) {
  if (!raw.trim()) return undefined;
  return raw.split("\n").map((line) => {
    const [value, label, labelAr] = line.split("|").map((s) => s.trim());
    return { value: value ?? "", label: label ?? value ?? "", labelAr: labelAr ?? null };
  }).filter((o) => o.value);
}

// ── Autonomous field generation helpers ──────────────────────────────────────

function labelToKey(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, "_")
    .replace(/^_+|_+$/g, "")
    || "field";
}

function inferFieldType(label: string, sourceType: SourceType): string {
  if (sourceType === "dynamic") return "dropdown";
  const l = label.toLowerCase();
  if (/email/.test(l)) return "email";
  if (/phone|mobile|tel/.test(l)) return "phone";
  if (/\bdate\b|deadline|due date|birth|expiry|start date|end date/.test(l)) return "date";
  if (/\btime\b/.test(l)) return "time";
  if (/number|count|amount|qty|quantity|price|cost|total|\bage\b|year|score|rating|salary/.test(l)) return "number";
  if (/description|notes?|comment|reason|remark|details?|summary|bio|message|feedback|explanation/.test(l)) return "textarea";
  if (/\bis\s|\bhas\s|yes.*no|enabled?|active|approved?|verified?|checked?|toggle|flag/.test(l)) return "boolean";
  if (/file|attachment|document|upload|image|photo|\bcv\b|resume/.test(l)) return "file";
  return "text";
}

function uniqueKey(base: string, existingKeys: string[]): string {
  if (!existingKeys.includes(base)) return base;
  let n = 2;
  while (existingKeys.includes(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

function parseSimpleOptions(raw: string) {
  if (!raw.trim()) return undefined;
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({
      value: labelToKey(line) || line.slice(0, 40).replace(/\s/g, "_"),
      label: line,
      labelAr: null,
    }));
}

function DataSourcePreview({ dsKey, isAr }: { dsKey: string; isAr: boolean }) {
  const { data: items = [], isLoading, isError } = useGetFormDataSourceData(dsKey);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground p-3 bg-muted/40 rounded-lg border border-dashed">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        {isAr ? "جارٍ جلب البيانات الحية..." : "Fetching live data..."}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="text-xs text-destructive p-3 bg-destructive/5 rounded-lg border border-destructive/20">
        {isAr ? "تعذّر جلب البيانات" : "Could not load data"}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="text-xs text-muted-foreground p-3 bg-muted/40 rounded-lg border border-dashed">
        {isAr ? "لا توجد بيانات بعد" : "No items found in this source yet"}
      </div>
    );
  }

  const preview = items.slice(0, 6);
  const remaining = items.length - preview.length;

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
        <Database className="w-3 h-3" />
        {isAr ? `معاينة حية - ${items.length} عنصر` : `Live preview - ${items.length} item${items.length !== 1 ? "s" : ""}`}
      </p>
      <div className="grid grid-cols-2 gap-1">
        {preview.map((item) => (
          <div key={item.value} className="flex items-center gap-1.5 px-2 py-1 bg-muted/50 rounded text-xs truncate">
            <span className="w-1.5 h-1.5 rounded-full bg-primary/60 shrink-0" />
            <span className="truncate">{isAr && item.labelAr ? item.labelAr : item.label}</span>
          </div>
        ))}
      </div>
      {remaining > 0 && (
        <p className="text-xs text-muted-foreground text-center">
          {isAr ? `+ ${remaining} آخرون` : `+ ${remaining} more`}
        </p>
      )}
    </div>
  );
}

export default function AdminFormsDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { i18n } = useTranslation();
  const isAr = i18n.language.startsWith("ar");
  const { toast } = useToast();
  const formId = Number(id);

  const { data: form, isLoading, refetch } = useGetForm(formId);
  const updateForm    = useUpdateForm();
  const addField      = useAddFormField();
  const updateField   = useUpdateFormField();
  const deleteField   = useDeleteFormField();
  const reorderFields = useReorderFormFields();
  const { data: submissions, refetch: refetchSubs } = useListFormSubmissions(formId, {});
  const updateStatus  = useUpdateSubmissionStatus();

  // Data sources catalog
  const { data: dataSources = [] } = useListFormDataSources();

  const deleteForm = useDeleteForm();

  const [addFieldOpen,      setAddFieldOpen]      = useState(false);
  const [newField,          setNewField]          = useState<AddFieldForm>(EMPTY_FIELD);
  const [editingStatus,     setEditingStatus]     = useState<number | null>(null);
  const [statusUpdate,      setStatusUpdate]      = useState({ status: "", reviewNote: "" });
  const [editingSettings,   setEditingSettings]   = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  // Settings form state - full fields
  const [editName,          setEditName]          = useState("");
  const [editNameAr,        setEditNameAr]        = useState("");
  const [editDescription,   setEditDescription]   = useState("");
  const [editDescriptionAr, setEditDescriptionAr] = useState("");
  const [editModule,        setEditModule]        = useState("");
  const [editCategory,      setEditCategory]      = useState("");
  const [editCustomCategory, setEditCustomCategory] = useState("");
  const [editStatus,        setEditStatus]        = useState("");
  const [editSelfService,   setEditSelfService]   = useState(false);
  const [editAudience,      setEditAudience]      = useState<FormAudienceConfig>(DEFAULT_AUDIENCE);
  const [editWorkflowPlan,  setEditWorkflowPlan]  = useState<FormWorkflowPlan>(DEFAULT_WORKFLOW_PLAN);

  // Group data sources by category
  const dsCategories = dataSources.reduce<Record<string, typeof dataSources>>((acc, ds) => {
    (acc[ds.category] ??= []).push(ds);
    return acc;
  }, {});

  function startEditSettings() {
    setEditName(form?.name ?? "");
    setEditNameAr(form?.nameAr ?? "");
    setEditDescription(form?.description ?? "");
    setEditDescriptionAr(form?.descriptionAr ?? "");
    setEditModule(form?.module ?? "");
    const cat = form?.category ?? "general";
    const known = FORM_CATEGORIES.some((c) => c.value === cat);
    setEditCategory(known ? cat : "other");
    setEditCustomCategory(known ? "" : cat);
    setEditStatus(form?.status ?? "draft");
    setEditSelfService(form?.showInSelfService ?? false);
    const perms = form?.permissions as Record<string, unknown> | null;
    const aud = perms?.audience as FormAudienceConfig | undefined;
    if (aud) {
      setEditAudience({ ...aud, visibleTo: (perms?.visibleTo as FormAudienceConfig["visibleTo"]) ?? aud.visibleTo });
    } else {
      setEditAudience({
        mode: (perms?.visibleTo as string) === "all" ? "all" : "preset",
        visibleTo: (perms?.visibleTo as FormAudienceConfig["visibleTo"]) ?? "all",
      });
    }
    const settings = form?.settings as Record<string, unknown> | null;
    setEditWorkflowPlan((settings?.workflowPlan as FormWorkflowPlan) ?? DEFAULT_WORKFLOW_PLAN);
    setEditingSettings(true);
  }

  function saveSettings() {
    const resolvedCategory = editCategory === "other" ? (editCustomCategory.trim() || "other") : editCategory;
    updateForm.mutate(
      {
        id: formId,
        data: {
          name:          editName,
          nameAr:        editNameAr   || undefined,
          description:   editDescription   || undefined,
          descriptionAr: editDescriptionAr || undefined,
          module:        editModule   || undefined,
          category:      resolvedCategory || undefined,
          status:           editStatus as "draft" | "active" | "archived",
          showInSelfService: editSelfService,
          audience: editAudience,
          workflowPlan: editWorkflowPlan,
        } as Record<string, unknown>,
      },
      {
        onSuccess: () => {
          toast({ title: isAr ? "تم حفظ التغييرات" : "Form updated" });
          setEditingSettings(false);
          void refetch();
        },
        onError: () => toast({ title: isAr ? "فشل الحفظ" : "Failed to save", variant: "destructive" }),
      },
    );
  }

  function toggleStatus() {
    const next = form?.status === "active" ? "draft" : "active";
    updateForm.mutate(
      { id: formId, data: { status: next } },
      {
        onSuccess: () => {
          toast({ title: next === "active"
            ? (isAr ? "تم تنشيط النموذج" : "Form activated")
            : (isAr ? "تم إيقاف النموذج" : "Form set to draft") });
          void refetch();
        },
        onError: () => toast({ title: isAr ? "فشلت العملية" : "Failed to update status", variant: "destructive" }),
      },
    );
  }

  function handleDelete() {
    deleteForm.mutate(
      { id: formId },
      {
        onSuccess: () => {
          toast({ title: isAr ? "تم حذف النموذج" : "Form deleted" });
          navigate("/admin/hr/forms");
        },
        onError: () => toast({ title: isAr ? "فشل الحذف" : "Failed to delete", variant: "destructive" }),
      },
    );
  }

  function selectDataSource(key: string) {
    const ds = dataSources.find((d) => d.key === key);
    if (!ds) return;
    setNewField((p) => {
      const newLabel = p.label || ds.label;
      const existingKeys = (form?.fields ?? []).map((f) => f.name);
      const baseKey = labelToKey(newLabel);
      const autoKey = uniqueKey(baseKey, existingKeys);
      return {
        ...p,
        dsKey:      key,
        dsMultiple: ds.allowMultiple,
        type:       ds.allowMultiple ? "multi_select" : "dropdown",
        label:      newLabel,
        labelAr:    p.labelAr || ds.labelAr,
        name:       autoKey,
      };
    });
  }

  function handleLabelChange(label: string) {
    const existingKeys = (form?.fields ?? []).map((f) => f.name);
    const baseKey = labelToKey(label);
    const autoKey = uniqueKey(baseKey, existingKeys);
    const autoType = inferFieldType(label, newField.sourceType);
    setNewField((p) => ({ ...p, label, name: autoKey, type: autoType }));
  }

  function handleAddField() {
    if (!newField.label.trim()) {
      toast({ title: isAr ? "الرجاء إدخال اسم الحقل" : "Field label is required", variant: "destructive" });
      return;
    }
    if (newField.sourceType === "dynamic" && !newField.dsKey) {
      toast({ title: isAr ? "الرجاء اختيار مصدر البيانات" : "Please select a data source", variant: "destructive" });
      return;
    }

    // Auto-generate key if somehow empty
    const existingKeys = (form?.fields ?? []).map((f) => f.name);
    const finalKey = newField.name.trim() || uniqueKey(labelToKey(newField.label), existingKeys);

    // Options: simple one-per-line format
    const needsOpts = ["dropdown", "radio", "checkbox", "multi_select"].includes(newField.type);
    const options = newField.sourceType === "static" && needsOpts
      ? parseSimpleOptions(newField.optionsRaw)
      : undefined;

    const dataSource = newField.sourceType === "dynamic"
      ? { key: newField.dsKey, multiple: newField.dsMultiple }
      : undefined;

    addField.mutate(
      {
        id: formId,
        data: {
          name:         finalKey,
          label:        newField.label,
          labelAr:      newField.labelAr || undefined,
          type:         newField.type as "text" | "textarea" | "number" | "email" | "phone" | "dropdown" | "checkbox" | "radio" | "date" | "time" | "file" | "user" | "department" | "multi_select" | "boolean",
          required:     newField.required,
          placeholder:  newField.placeholder || undefined,
          defaultValue: newField.defaultValue || undefined,
          options,
          dataSource,
        },
      },
      {
        onSuccess: () => {
          toast({ title: isAr ? "تمت إضافة الحقل" : "Field added" });
          setNewField(EMPTY_FIELD);
          setAddFieldOpen(false);
          void refetch();
        },
        onError: () => toast({ title: isAr ? "فشل إضافة الحقل" : "Failed to add field", variant: "destructive" }),
      },
    );
  }

  function handleDeleteField(fieldId: number) {
    deleteField.mutate(
      { id: formId, fieldId },
      { onSuccess: () => { toast({ title: "Field deleted" }); void refetch(); } },
    );
  }

  function moveField(fieldId: number, dir: -1 | 1) {
    const fields = [...(form?.fields ?? [])].sort((a, b) => a.displayOrder - b.displayOrder);
    const idx = fields.findIndex((f) => f.id === fieldId);
    if (idx < 0) return;
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= fields.length) return;
    const ids = fields.map((f) => f.id);
    [ids[idx], ids[swapIdx]] = [ids[swapIdx]!, ids[idx]!];
    reorderFields.mutate({ id: formId, data: { fieldIds: ids } }, {
      onSuccess: () => void refetch(),
    });
  }

  function handleUpdateStatus() {
    if (!editingStatus || !statusUpdate.status) return;
    updateStatus.mutate(
      { id: editingStatus!, data: { status: statusUpdate.status as "pending_approval" | "approved" | "rejected" | "cancelled" | "completed", reviewNote: statusUpdate.reviewNote || undefined } },
      {
        onSuccess: () => {
          toast({ title: "Status updated" });
          setEditingStatus(null);
          setStatusUpdate({ status: "", reviewNote: "" });
          void refetchSubs();
        },
      },
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!form) {
    return (
      <Card>
        <CardContent className="py-16 text-center">
          <p className="text-muted-foreground">{isAr ? "لم يتم العثور على النموذج" : "Form not found"}</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate("/admin/hr/forms")}>
            <ArrowLeft className="w-4 h-4 mr-2" /> Back
          </Button>
        </CardContent>
      </Card>
    );
  }

  const sortedFields = [...(form.fields ?? [])].sort((a, b) => a.displayOrder - b.displayOrder);

  const needsOptions = ["dropdown", "radio", "checkbox", "multi_select"].includes(newField.type);
  const selectedDs = dataSources.find((d) => d.key === newField.dsKey);

  return (
    <div className="space-y-6">
      {/* Back */}
      <Button variant="ghost" size="sm" onClick={() => navigate("/admin/hr/forms")} className="-ml-2">
        <ArrowLeft className="w-4 h-4 mr-1" /> {isAr ? "إدارة النماذج" : "Manage Forms"}
      </Button>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <ClipboardList className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold">
              {isAr && form.nameAr ? form.nameAr : form.name}
            </h1>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <StatusBadge status={form.status ?? "draft"} />
              {form.module && (
                <span className="text-xs font-medium capitalize bg-muted px-1.5 py-0.5 rounded">{form.module}</span>
              )}
              {form.category && (
                <span className="text-xs text-muted-foreground">{form.category}</span>
              )}
              {form.workflowEvent && (
                <span className="text-xs text-muted-foreground font-mono">{form.workflowEvent}</span>
              )}
            </div>
            {form.description && (
              <p className="text-xs text-muted-foreground mt-1 max-w-md">
                {isAr && form.descriptionAr ? form.descriptionAr : form.description}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => window.open(`/forms/${formId}`, "_blank")}>
            <Eye className="w-4 h-4 mr-2" /> {isAr ? "معاينة" : "Preview"}
          </Button>

          {/* Quick activate / deactivate toggle */}
          <Button
            variant="outline"
            size="sm"
            onClick={toggleStatus}
            disabled={updateForm.isPending}
            className={form.status === "active"
              ? "border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-400 dark:hover:bg-emerald-950/30"
              : "text-muted-foreground"}
          >
            {form.status === "active"
              ? <><ToggleRight className="w-4 h-4 mr-1.5 text-emerald-600" />{isAr ? "نشط" : "Active"}</>
              : <><ToggleLeft  className="w-4 h-4 mr-1.5" />{isAr ? "غير نشط" : "Inactive"}</>}
          </Button>

          <Button size="sm" variant="outline" onClick={startEditSettings}>
            <Settings className="w-4 h-4 mr-2" /> {isAr ? "تعديل" : "Edit"}
          </Button>

          {/* Delete button */}
          <Button
            size="sm"
            variant="destructive"
            onClick={() => setDeleteConfirmOpen(true)}
          >
            <Trash2 className="w-4 h-4 mr-2" /> {isAr ? "حذف" : "Delete"}
          </Button>
        </div>
      </div>

      <Tabs defaultValue="fields">
        <TabsList>
          <TabsTrigger value="fields"><List className="w-4 h-4 mr-2" />{isAr ? "الحقول" : "Fields"}</TabsTrigger>
          <TabsTrigger value="submissions">
            {isAr ? "التقديمات" : "Submissions"}
            {(submissions?.length ?? 0) > 0 && (
              <span className="ml-2 text-xs bg-primary text-primary-foreground rounded-full px-1.5 py-0.5">
                {submissions?.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── Fields Tab ───────────────────────────────────────────── */}
        <TabsContent value="fields" className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-muted-foreground">
              {sortedFields.length} {isAr ? "حقل" : "fields"}
            </p>
            <Button size="sm" onClick={() => setAddFieldOpen(true)}>
              <Plus className="w-4 h-4 mr-2" /> {isAr ? "إضافة حقل" : "Add Field"}
            </Button>
          </div>

          {sortedFields.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center space-y-3">
                <p className="text-muted-foreground text-sm">
                  {isAr ? "لا توجد حقول بعد. أضف أول حقل" : "No fields yet. Add your first field"}
                </p>
                <Button size="sm" onClick={() => setAddFieldOpen(true)}>
                  <Plus className="w-4 h-4 mr-2" /> {isAr ? "إضافة حقل" : "Add Field"}
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {sortedFields.map((field, idx) => {
                const ds = field.dataSource as { key?: string; multiple?: boolean } | null | undefined;
                const dsDef = ds?.key ? dataSources.find((d) => d.key === ds.key) : null;
                return (
                  <Card key={field.id}>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3">
                        <GripVertical className="w-4 h-4 text-muted-foreground shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm">{field.label}</span>
                            {field.labelAr && (
                              <span className="text-sm text-muted-foreground" dir="rtl">{field.labelAr}</span>
                            )}
                            {field.required && (
                              <span className="text-xs text-destructive">required</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            <span className="text-xs font-mono text-muted-foreground">{field.name}</span>
                            <span className="text-xs bg-muted px-1 rounded">{field.type}</span>
                            {dsDef && (
                              <span className={`text-xs px-1.5 py-0.5 rounded flex items-center gap-1 font-medium ${CAT_STYLE[dsDef.category] ?? ""}`}>
                                <DsIcon icon={dsDef.icon} className="w-3 h-3" />
                                {dsDef.label}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Button
                            variant="ghost" size="icon" className="h-7 w-7"
                            disabled={idx === 0}
                            onClick={() => moveField(field.id, -1)}
                          >
                            <ChevronUp className="w-3 h-3" />
                          </Button>
                          <Button
                            variant="ghost" size="icon" className="h-7 w-7"
                            disabled={idx === sortedFields.length - 1}
                            onClick={() => moveField(field.id, 1)}
                          >
                            <ChevronDown className="w-3 h-3" />
                          </Button>
                          <Button
                            variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive"
                            onClick={() => handleDeleteField(field.id)}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ── Submissions Tab ──────────────────────────────────────── */}
        <TabsContent value="submissions" className="space-y-4">
          {!submissions || submissions.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-muted-foreground text-sm">
                  {isAr ? "لا توجد تقديمات بعد" : "No submissions yet"}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {submissions.map((sub) => (
                <Card key={sub.id}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">#{sub.id}</span>
                          <StatusBadge status={sub.status ?? "submitted"} />
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {sub.submittedByName ?? "-"} ·{" "}
                          {sub.submittedAt
                            ? formatDistanceToNow(new Date(sub.submittedAt), { addSuffix: true })
                            : "-"}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        {sub.status === "submitted" && (
                          <Button size="sm" variant="outline" onClick={() => {
                            setEditingStatus(sub.id);
                            setStatusUpdate({ status: "pending_approval", reviewNote: "" });
                          }}>
                            {isAr ? "مراجعة" : "Review"}
                          </Button>
                        )}
                        {(sub.status === "submitted" || sub.status === "pending_approval") && (
                          <>
                            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white"
                              onClick={() => { setEditingStatus(sub.id); setStatusUpdate({ status: "approved", reviewNote: "" }); }}>
                              <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                              {isAr ? "قبول" : "Approve"}
                            </Button>
                            <Button size="sm" variant="destructive"
                              onClick={() => { setEditingStatus(sub.id); setStatusUpdate({ status: "rejected", reviewNote: "" }); }}>
                              <XCircle className="w-3.5 h-3.5 mr-1" />
                              {isAr ? "رفض" : "Reject"}
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                    {sub.data && Object.keys(sub.data as object).length > 0 && (
                      <div className="mt-3 pt-3 border-t grid grid-cols-2 gap-x-4 gap-y-1">
                        {Object.entries(sub.data as Record<string, unknown>).slice(0, 6).map(([k, v]) => (
                          <div key={k} className="text-xs">
                            <span className="text-muted-foreground capitalize">{k.replace(/_/g, " ")}: </span>
                            <span className="font-medium">{String(v)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* ── Add Field Dialog ──────────────────────────────────────────────── */}
      <Dialog open={addFieldOpen} onOpenChange={(o) => { setAddFieldOpen(o); if (!o) setNewField(EMPTY_FIELD); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="w-4 h-4" />
              {isAr ? "إضافة حقل جديد" : "Add New Field"}
            </DialogTitle>
            <DialogDescription className="flex items-center gap-1">
              <Sparkles className="w-3 h-3" />
              {isAr
                ? "يُولِّد النظام المعرّفات التقنية والبنية والتحقق تلقائيًا"
                : "System auto-generates field IDs, schema bindings, and validation rules"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-2">

            {/* ── Step 1: Label ─────────────────────────────────────── */}
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="font-medium">
                    {isAr ? "اسم الحقل" : "Field Name"} <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    autoFocus
                    value={newField.label}
                    onChange={(e) => handleLabelChange(e.target.value)}
                    placeholder={isAr ? "مثال: القسم" : "e.g. Department"}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="font-medium">{isAr ? "الاسم بالعربية" : "Arabic Name"}</Label>
                  <Input
                    value={newField.labelAr}
                    onChange={(e) => setNewField((p) => ({ ...p, labelAr: e.target.value }))}
                    placeholder={isAr ? "اختياري" : "Optional"}
                    dir="rtl"
                  />
                </div>
              </div>

              {/* Auto-generated system info badge */}
              {newField.label && (
                <div className="flex items-center gap-2 px-3 py-2 bg-muted/60 rounded-lg text-xs text-muted-foreground border border-dashed">
                  <Info className="w-3 h-3 shrink-0" />
                  <span>
                    {isAr ? "المعرّف التلقائي:" : "Auto ID:"}
                    <code className="mx-1 px-1 py-0.5 bg-background rounded font-mono text-[11px]">{newField.name || "..."}</code>
                    {"·"}
                    <span className="ml-1">{FRIENDLY_TYPES.find(t => t.value === newField.type)?.[isAr ? "labelAr" : "label"] ?? newField.type}</span>
                  </span>
                  <span className="ml-auto text-[10px] opacity-60">{isAr ? "مُولَّد تلقائيًا" : "auto-generated"}</span>
                </div>
              )}
            </div>

            {/* ── Step 2: Source type ───────────────────────────────── */}
            <div className="space-y-2">
              <Label className="font-medium">{isAr ? "مصدر البيانات" : "Data Source"}</Label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setNewField((p) => ({ ...p, sourceType: "static", dsKey: "", type: inferFieldType(p.label, "static") }))}
                  className={`flex items-center gap-3 p-3.5 rounded-xl border-2 transition-all text-left ${
                    newField.sourceType === "static"
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/40 hover:bg-muted/30"
                  }`}
                >
                  <div className={`p-2 rounded-lg shrink-0 ${newField.sourceType === "static" ? "bg-primary/10" : "bg-muted"}`}>
                    <Layers className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="font-semibold text-sm">{isAr ? "حقل ثابت" : "Custom Field"}</p>
                    <p className="text-xs text-muted-foreground">{isAr ? "خيارات يدوية أو نص حر" : "Free text or fixed options"}</p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setNewField((p) => ({ ...p, sourceType: "dynamic", type: "dropdown" }))}
                  className={`flex items-center gap-3 p-3.5 rounded-xl border-2 transition-all text-left ${
                    newField.sourceType === "dynamic"
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/40 hover:bg-muted/30"
                  }`}
                >
                  <div className={`p-2 rounded-lg shrink-0 ${newField.sourceType === "dynamic" ? "bg-primary/10" : "bg-muted"}`}>
                    <Database className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="font-semibold text-sm">{isAr ? "بيانات المنصة" : "Platform Data"}</p>
                    <p className="text-xs text-muted-foreground">{isAr ? "تُحمَّل تلقائيًا من النظام" : "Live data from your workspace"}</p>
                  </div>
                </button>
              </div>
            </div>

            {/* ── Step 3a: Dynamic datasource picker ────────────────── */}
            {newField.sourceType === "dynamic" && (
              <div className="space-y-3">
                <Label className="text-sm font-medium">
                  {isAr ? "اختر مصدر البيانات" : "Choose Data Source"} <span className="text-destructive">*</span>
                </Label>
                {dataSources.length === 0 ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground p-3 bg-muted rounded-lg">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {isAr ? "جارٍ التحميل..." : "Loading..."}
                  </div>
                ) : (
                  <div className="space-y-3 max-h-56 overflow-y-auto pr-1">
                    {Object.entries(dsCategories).map(([cat, sources]) => (
                      <div key={cat}>
                        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 capitalize">
                          {cat}
                        </p>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                          {sources.map((ds) => (
                            <button
                              key={ds.key}
                              type="button"
                              onClick={() => selectDataSource(ds.key)}
                              className={`flex items-center gap-2 p-2.5 rounded-lg border text-left transition-all text-xs ${
                                newField.dsKey === ds.key
                                  ? "border-primary bg-primary/5 font-medium"
                                  : "border-border hover:border-primary/40 hover:bg-muted/30"
                              }`}
                            >
                              <span className={`p-1 rounded ${CAT_STYLE[ds.category] ?? "bg-muted"}`}>
                                <DsIcon icon={ds.icon} className="w-3.5 h-3.5" />
                              </span>
                              <span className="truncate">{isAr ? ds.labelAr : ds.label}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {selectedDs && (
                  <div className="space-y-2">
                    <div className="flex items-start gap-2 p-3 bg-primary/5 border border-primary/20 rounded-lg text-xs">
                      <DsIcon icon={selectedDs.icon} className="w-3.5 h-3.5 mt-0.5 text-primary" />
                      <div>
                        <p className="font-medium text-primary">{isAr ? selectedDs.labelAr : selectedDs.label}</p>
                        <p className="text-muted-foreground">{isAr ? selectedDs.descriptionAr : selectedDs.description}</p>
                      </div>
                    </div>
                    <DataSourcePreview dsKey={selectedDs.key} isAr={isAr} />
                    {selectedDs.allowMultiple && (
                      <label className="flex items-center gap-2 cursor-pointer text-sm pt-1">
                        <input
                          type="checkbox"
                          checked={newField.dsMultiple}
                          onChange={(e) => setNewField((p) => ({
                            ...p,
                            dsMultiple: e.target.checked,
                            type: e.target.checked ? "multi_select" : "dropdown",
                          }))}
                        />
                        {isAr ? "السماح باختيار متعدد" : "Allow multiple selections"}
                      </label>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ── Step 3b: Static - visual field type picker ────────── */}
            {newField.sourceType === "static" && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">{isAr ? "نوع الإدخال" : "Input Type"}</Label>
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Sparkles className="w-3 h-3" />
                    {isAr ? "مُختار تلقائيًا من الاسم" : "Auto-selected from name"}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {FRIENDLY_TYPES.map(({ value, label, labelAr, Icon }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setNewField((p) => ({ ...p, type: value }))}
                      className={`flex flex-col items-center gap-1.5 p-2.5 rounded-lg border text-center transition-all ${
                        newField.type === value
                          ? "border-primary bg-primary/5 text-primary font-medium"
                          : "border-border hover:border-primary/30 hover:bg-muted/40 text-muted-foreground"
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      <span className="text-[11px] leading-tight">{isAr ? labelAr : label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ── Step 4: Options (static choice fields) ────────────── */}
            {newField.sourceType === "static" && needsOptions && (
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">
                  {isAr ? "الخيارات" : "Options"}
                  <span className="text-xs text-muted-foreground font-normal ml-2">
                    {isAr ? "(خيار واحد في كل سطر)" : "(one option per line)"}
                  </span>
                </Label>
                <Textarea
                  value={newField.optionsRaw}
                  onChange={(e) => setNewField((p) => ({ ...p, optionsRaw: e.target.value }))}
                  placeholder={isAr
                    ? "إجازة سنوية\nإجازة مرضية\nإجازة بدون راتب"
                    : "Annual Leave\nSick Leave\nUnpaid Leave"}
                  rows={4}
                  className="text-sm resize-none"
                />
                <p className="text-xs text-muted-foreground">
                  {isAr
                    ? "يُولِّد النظام المعرّفات الداخلية تلقائيًا من النصوص"
                    : "System auto-generates internal values from your text"}
                </p>
              </div>
            )}

            {/* ── Step 5: Required + Placeholder ───────────────────── */}
            <div className="flex items-center justify-between gap-4 pt-1">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={newField.required}
                  onChange={(e) => setNewField((p) => ({ ...p, required: e.target.checked }))}
                  className="rounded"
                />
                <span className="text-sm font-medium">{isAr ? "حقل إلزامي" : "Required field"}</span>
              </label>
              {newField.sourceType === "static" && !needsOptions && newField.type !== "boolean" && newField.type !== "file" && (
                <div className="flex-1 max-w-56">
                  <Input
                    value={newField.placeholder}
                    onChange={(e) => setNewField((p) => ({ ...p, placeholder: e.target.value }))}
                    placeholder={isAr ? "نص توضيحي (اختياري)" : "Placeholder text (optional)"}
                    className="text-sm h-8"
                  />
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setAddFieldOpen(false); setNewField(EMPTY_FIELD); }}>
              {isAr ? "إلغاء" : "Cancel"}
            </Button>
            <Button onClick={handleAddField} disabled={addField.isPending}>
              {addField.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {isAr ? "إضافة الحقل" : "Add Field"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit Settings Dialog ────────────────────────────────────────── */}
      <Dialog open={editingSettings} onOpenChange={setEditingSettings}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings className="w-4 h-4" />
              {isAr ? "تعديل إعدادات النموذج" : "Edit Form Settings"}
            </DialogTitle>
            <DialogDescription>
              {isAr ? "تعديل شامل لخصائص النموذج" : "Update all form properties"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-2">
            {/* Name row */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{isAr ? "الاسم" : "Name"} <span className="text-destructive">*</span></Label>
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder={isAr ? "اسم النموذج" : "Form name"}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{isAr ? "الاسم بالعربية" : "Arabic Name"}</Label>
                <Input
                  value={editNameAr}
                  onChange={(e) => setEditNameAr(e.target.value)}
                  placeholder={isAr ? "اختياري" : "Optional"}
                  dir="rtl"
                />
              </div>
            </div>

            {/* Description row */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{isAr ? "الوصف" : "Description"}</Label>
                <Textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  placeholder={isAr ? "وصف مختصر للنموذج" : "Short description"}
                  rows={2}
                  className="resize-none text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label>{isAr ? "الوصف بالعربية" : "Arabic Description"}</Label>
                <Textarea
                  value={editDescriptionAr}
                  onChange={(e) => setEditDescriptionAr(e.target.value)}
                  placeholder={isAr ? "اختياري" : "Optional"}
                  rows={2}
                  dir="rtl"
                  className="resize-none text-sm"
                />
              </div>
            </div>

            {/* Module + Category */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{isAr ? "الوحدة" : "Module"}</Label>
                <Select value={editModule} onValueChange={setEditModule}>
                  <SelectTrigger><SelectValue placeholder={isAr ? "اختر الوحدة" : "Select module"} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hr">{isAr ? "الموارد البشرية" : "HR"}</SelectItem>
                    <SelectItem value="tickets">{isAr ? "التذاكر" : "Tickets"}</SelectItem>
                    <SelectItem value="departments">{isAr ? "الأقسام" : "Departments"}</SelectItem>
                    <SelectItem value="general">{isAr ? "عام" : "General"}</SelectItem>
                    <SelectItem value="admin">{isAr ? "إداري" : "Admin"}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{isAr ? "الفئة" : "Category"}</Label>
                <Select value={editCategory} onValueChange={setEditCategory}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FORM_CATEGORIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>{isAr ? c.labelAr : c.labelEn}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {editCategory === "other" && (
                  <Input
                    value={editCustomCategory}
                    onChange={(e) => setEditCustomCategory(e.target.value)}
                    placeholder={isAr ? "فئة مخصصة" : "Custom category"}
                    className="mt-2"
                  />
                )}
              </div>
            </div>

            {/* Status */}
            <div className="space-y-1.5">
              <Label>{isAr ? "الحالة" : "Status"}</Label>
              <div className="grid grid-cols-3 gap-2">
                {(["draft", "active", "archived"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setEditStatus(s)}
                    className={`flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition-all text-sm font-medium ${
                      editStatus === s
                        ? s === "active"   ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                        : s === "archived" ? "border-slate-400 bg-slate-50 text-slate-600 dark:bg-slate-800/40 dark:text-slate-300"
                                           : "border-amber-400 bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                        : "border-border hover:border-primary/40 text-muted-foreground"
                    }`}
                  >
                    {s === "active"   && <ToggleRight className="w-4 h-4" />}
                    {s === "draft"    && <Clock className="w-4 h-4" />}
                    {s === "archived" && <Archive className="w-4 h-4" />}
                    <span className="capitalize">{isAr
                      ? (s === "active" ? "نشط" : s === "draft" ? "مسودة" : "مؤرشف")
                      : s}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Self-Service Portal toggle */}
            <div className="flex items-center justify-between rounded-lg border p-4 bg-muted/30">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Layers className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium">{isAr ? "إظهار في الخدمات الذاتية" : "Show in Self-Service Portal"}</p>
                  <p className="text-xs text-muted-foreground">
                    {isAr ? "يتيح للموظفين رؤية هذا النموذج وتقديمه مباشرة" : "Employees can browse and submit this form directly"}
                  </p>
                </div>
              </div>
              <Switch checked={editSelfService} onCheckedChange={setEditSelfService} />
            </div>

            <div className="space-y-2">
              <Label>{isAr ? "من يمكنه الوصول؟" : "Who can access?"}</Label>
              <FormAudienceBuilder value={editAudience} onChange={setEditAudience} isAr={isAr} showInSelfService={editSelfService} />
            </div>

            <div className="space-y-2">
              <Label>{isAr ? "مسار الموافقة" : "Approval workflow"}</Label>
              <FormWorkflowBuilder
                value={editWorkflowPlan}
                onChange={setEditWorkflowPlan}
                isAr={isAr}
                formName={editName || form.name}
                autoEvent={buildFormWorkflowEventPreview(editModule || form.module, editName || form.name)}
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEditingSettings(false)}>
              {isAr ? "إلغاء" : "Cancel"}
            </Button>
            <Button onClick={saveSettings} disabled={updateForm.isPending || !editName.trim()}>
              {updateForm.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              <Save className="w-4 h-4 mr-2" />
              {isAr ? "حفظ التغييرات" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirmation ──────────────────────────────────────────── */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="w-5 h-5" />
              {isAr ? "حذف النموذج نهائياً؟" : "Delete form permanently?"}
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block">
                {isAr
                  ? `سيتم حذف النموذج "${form.name}" وجميع حقوله وتقديماته بشكل نهائي.`
                  : `This will permanently delete "${form.name}" along with all its fields and submissions.`}
              </span>
              <span className="block font-medium text-foreground">
                {isAr ? "لا يمكن التراجع عن هذا الإجراء." : "This action cannot be undone."}
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{isAr ? "إلغاء" : "Cancel"}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteForm.isPending}
            >
              {deleteForm.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {isAr ? "نعم، احذف النموذج" : "Yes, delete form"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Review Status Dialog ────────────────────────────────────────── */}
      <Dialog open={editingStatus !== null} onOpenChange={(o) => !o && setEditingStatus(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{isAr ? "تحديث حالة التقديم" : "Update Submission Status"}</DialogTitle>
            <DialogDescription>{isAr ? "اختر الحالة الجديدة وأضف ملاحظة اختيارية" : "Choose the new status and add an optional review note"}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>New Status</Label>
              <Select
                value={statusUpdate.status}
                onValueChange={(v) => setStatusUpdate((p) => ({ ...p, status: v }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending_approval">Pending Approval</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Review Note (optional)</Label>
              <Textarea
                value={statusUpdate.reviewNote}
                onChange={(e) => setStatusUpdate((p) => ({ ...p, reviewNote: e.target.value }))}
                placeholder="Add a note..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingStatus(null)}>Cancel</Button>
            <Button onClick={handleUpdateStatus} disabled={updateStatus.isPending || !statusUpdate.status}>
              {updateStatus.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Update
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
