import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useParams } from "wouter";
import {
  useCreateHrService,
  useUpdateHrService,
  useGetHrService,
  useListForms,
  useListHrCategories,
  useCreateHrCategory,
  getListHrCategoriesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  ChevronLeft, Save, FileText, Plane, HeartPulse, Award, Wrench,
  RefreshCw, UserCheck, Package, ClipboardList, Briefcase, Plus,
  Trash2, Tag, Zap, GitBranch, Settings, Eye, X, GripVertical,
  CheckCircle2, Circle, AlertCircle, Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Icon palette ──────────────────────────────────────────────────────────────

const ICONS = [
  { name: "FileText",    Icon: FileText },
  { name: "Plane",       Icon: Plane },
  { name: "HeartPulse",  Icon: HeartPulse },
  { name: "Award",       Icon: Award },
  { name: "Wrench",      Icon: Wrench },
  { name: "RefreshCw",   Icon: RefreshCw },
  { name: "UserCheck",   Icon: UserCheck },
  { name: "Package",     Icon: Package },
  { name: "ClipboardList", Icon: ClipboardList },
  { name: "Briefcase",   Icon: Briefcase },
  { name: "Tag",         Icon: Tag },
  { name: "Settings",    Icon: Settings },
];

const STATUS_COLORS = [
  "#f59e0b", "#3b82f6", "#22c55e", "#ef4444",
  "#8b5cf6", "#ec4899", "#14b8a6", "#f97316",
  "#64748b", "#06b6d4",
];

const DEFAULT_STATUSES = [
  { key: "pending",      label: "Pending",      labelAr: "معلق",          color: "#f59e0b", isDefault: true,  isFinal: false },
  { key: "under_review", label: "Under Review",  labelAr: "قيد المراجعة", color: "#3b82f6", isDefault: false, isFinal: false },
  { key: "approved",     label: "Approved",      labelAr: "موافق عليه",   color: "#22c55e", isDefault: false, isFinal: true  },
  { key: "rejected",     label: "Rejected",      labelAr: "مرفوض",        color: "#ef4444", isDefault: false, isFinal: true  },
];

// ── Slug helper ───────────────────────────────────────────────────────────────

function toEventSlug(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[\u0600-\u06FF]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .substring(0, 40) || "service";
}

// ── Status Builder ────────────────────────────────────────────────────────────

interface StatusStep {
  key: string;
  label: string;
  labelAr: string;
  color: string;
  isDefault: boolean;
  isFinal: boolean;
}

function StatusBuilder({ statuses, onChange, isAr }: {
  statuses: StatusStep[];
  onChange: (s: StatusStep[]) => void;
  isAr: boolean;
}) {
  const [newLabel, setNewLabel] = useState("");

  function addStatus() {
    if (!newLabel.trim()) return;
    const key = newLabel.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    if (statuses.some(s => s.key === key)) return;
    onChange([...statuses, {
      key,
      label: newLabel.trim(),
      labelAr: "",
      color: STATUS_COLORS[statuses.length % STATUS_COLORS.length],
      isDefault: false,
      isFinal: false,
    }]);
    setNewLabel("");
  }

  function update(idx: number, patch: Partial<StatusStep>) {
    const next = statuses.map((s, i) => {
      if (i !== idx) return s;
      return { ...s, ...patch };
    });
    // ensure only one isDefault
    if (patch.isDefault) {
      next.forEach((s, i) => { if (i !== idx) s.isDefault = false; });
    }
    onChange(next);
  }

  function remove(idx: number) {
    onChange(statuses.filter((_, i) => i !== idx));
  }

  return (
    <div className="space-y-3">
      {/* Status list */}
      <div className="space-y-2">
        {statuses.map((s, idx) => (
          <div key={s.key} className="flex items-center gap-2 rounded-lg border border-border bg-card p-3">
            <GripVertical className="w-4 h-4 text-muted-foreground/40 shrink-0 cursor-grab" />
            <div
              className="w-3 h-3 rounded-full shrink-0 cursor-pointer ring-1 ring-black/10"
              style={{ backgroundColor: s.color }}
              onClick={() => {
                const idx2 = STATUS_COLORS.indexOf(s.color);
                const next = STATUS_COLORS[(idx2 + 1) % STATUS_COLORS.length];
                update(idx, { color: next });
              }}
              title={isAr ? "اضغط لتغيير اللون" : "Click to change color"}
            />
            <div className="flex-1 grid grid-cols-2 gap-2 min-w-0">
              <Input
                value={s.label}
                onChange={e => update(idx, { label: e.target.value })}
                placeholder={isAr ? "اسم الحالة (EN)" : "Status label"}
                className="h-7 text-xs"
              />
              <Input
                value={s.labelAr}
                onChange={e => update(idx, { labelAr: e.target.value })}
                placeholder="اسم الحالة (AR)"
                className="h-7 text-xs"
                dir="rtl"
              />
            </div>
            <div className="flex items-center gap-2 shrink-0 text-xs text-muted-foreground">
              <button
                type="button"
                onClick={() => update(idx, { isDefault: !s.isDefault })}
                title={isAr ? "الحالة الابتدائية" : "Default (starting) status"}
                className={cn("p-1 rounded transition-colors", s.isDefault ? "text-primary" : "hover:text-primary")}
              >
                {s.isDefault ? <CheckCircle2 className="w-4 h-4" /> : <Circle className="w-4 h-4" />}
              </button>
              <button
                type="button"
                onClick={() => update(idx, { isFinal: !s.isFinal })}
                title={isAr ? "حالة نهائية" : "Final (terminal) status"}
                className={cn("p-1 rounded transition-colors", s.isFinal ? "text-amber-600" : "hover:text-amber-600")}
              >
                <AlertCircle className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => remove(idx)}
                className="p-1 rounded hover:text-destructive transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground px-1">
        <span className="flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5 text-primary" /> {isAr ? "ابتدائية" : "Starting"}</span>
        <span className="flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5 text-amber-600" /> {isAr ? "نهائية" : "Terminal"}</span>
        <span>{isAr ? "الدائرة = انقر لتغيير اللون" : "Color dot = click to cycle"}</span>
      </div>

      {/* Add new status */}
      <div className="flex gap-2">
        <Input
          value={newLabel}
          onChange={e => setNewLabel(e.target.value)}
          placeholder={isAr ? "اسم حالة جديدة..." : "New status label..."}
          className="h-8 text-sm"
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addStatus(); } }}
        />
        <Button type="button" size="sm" variant="outline" onClick={addStatus} className="gap-1.5 h-8 shrink-0">
          <Plus className="w-3.5 h-3.5" />
          {isAr ? "إضافة" : "Add"}
        </Button>
      </div>
    </div>
  );
}

// ── Category Selector with inline Create ──────────────────────────────────────

function CategorySelector({ value, onChange, isAr }: {
  value: string;
  onChange: (v: string) => void;
  isAr: boolean;
}) {
  const queryClient = useQueryClient();
  const { data: categories = [] } = useListHrCategories();
  const createCat = useCreateHrCategory();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#6366f1");

  const CATEGORY_COLORS = ["#6366f1", "#8b5cf6", "#ec4899", "#ef4444", "#f97316", "#22c55e", "#14b8a6", "#3b82f6", "#64748b"];

  function handleAddCategory() {
    if (!newName.trim()) return;
    createCat.mutate(
      { data: { name: newName.trim(), color: newColor } },
      {
        onSuccess: (cat: any) => {
          queryClient.invalidateQueries({ queryKey: getListHrCategoriesQueryKey() });
          onChange(cat.slug);
          setAdding(false);
          setNewName("");
        },
      }
    );
  }

  return (
    <div className="space-y-2">
      {adding ? (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
          <p className="text-xs font-medium text-primary">{isAr ? "إنشاء تصنيف جديد" : "Create new category"}</p>
          <Input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder={isAr ? "اسم التصنيف..." : "Category name..."}
            className="h-8 text-sm"
            autoFocus
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleAddCategory(); } }}
          />
          <div className="flex items-center gap-2">
            <div className="flex gap-1.5 flex-wrap">
              {CATEGORY_COLORS.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setNewColor(c)}
                  className={cn("w-5 h-5 rounded-full transition-all border-2", newColor === c ? "border-foreground scale-110" : "border-transparent")}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => setAdding(false)} className="h-7 text-xs">
              {isAr ? "إلغاء" : "Cancel"}
            </Button>
            <Button type="button" size="sm" onClick={handleAddCategory} disabled={!newName.trim() || createCat.isPending} className="h-7 text-xs gap-1">
              {createCat.isPending && <Loader2 className="w-3 h-3 animate-spin" />}
              {isAr ? "إنشاء" : "Create"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <Select value={value || "none"} onValueChange={v => onChange(v === "none" ? "" : v)}>
            <SelectTrigger className="flex-1">
              <SelectValue placeholder={isAr ? "اختر تصنيفاً..." : "Select a category..."} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{isAr ? "بدون تصنيف" : "No category"}</SelectItem>
              {(categories as any[]).map((c: any) => (
                <SelectItem key={c.slug} value={c.slug}>
                  <span className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: c.color }} />
                    {isAr && c.nameAr ? c.nameAr : c.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" size="sm" variant="outline" onClick={() => setAdding(true)} className="gap-1.5 shrink-0">
            <Plus className="w-3.5 h-3.5" />
            {isAr ? "تصنيف جديد" : "New"}
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function HrServicesAdminNewPage() {
  const { i18n } = useTranslation();
  const isAr = i18n.language.startsWith("ar");
  const params = useParams<{ id?: string }>();
  const isEdit = !!params.id;
  const [, navigate] = useLocation();
  const { toast } = useToast();

  // ── Form state ─────────────────────────────────────────────────────────────
  const [name, setName]         = useState("");
  const [nameAr, setNameAr]     = useState("");
  const [description, setDescription]         = useState("");
  const [descriptionAr, setDescriptionAr]     = useState("");
  const [icon, setIcon]         = useState("FileText");
  const [category, setCategory] = useState("");
  const [formId, setFormId]     = useState("");
  const [status, setStatus]     = useState("active");
  const [displayOrder, setDisplayOrder] = useState("0");
  const [visibleTo, setVisibleTo]       = useState("all");

  // Workflow event - auto-generated, optionally customized
  const [autoEvent, setAutoEvent]           = useState("");
  const [customizeEvent, setCustomizeEvent] = useState(false);
  const [customEvent, setCustomEvent]       = useState("");

  // Settings
  const [requiresApproval, setRequiresApproval]   = useState(true);
  const [allowAttachments, setAllowAttachments]   = useState(true);
  const [successMessage, setSuccessMessage]       = useState("");

  // Request statuses
  const [requestStatuses, setRequestStatuses] = useState<StatusStep[]>(DEFAULT_STATUSES);

  // Tab state
  const [tab, setTab] = useState<"info" | "flow" | "workflow" | "preview">("info");

  // ── Data ───────────────────────────────────────────────────────────────────
  const { data: existing, isLoading: loadingExisting } = useGetHrService(
    isEdit ? Number(params.id) : 0,
    { query: { enabled: isEdit && !!params.id, queryKey: ["hr-service", params.id] } }
  );

  const { data: formsList } = useListForms({ status: "active" });
  const createMutation = useCreateHrService();
  const updateMutation = useUpdateHrService();

  // Auto-update event slug from name
  const updateAutoEvent = useCallback((n: string) => {
    const slug = `hr.${toEventSlug(n)}.submitted`;
    setAutoEvent(slug);
    if (!customizeEvent) setCustomEvent(slug);
  }, [customizeEvent]);

  useEffect(() => {
    if (name) updateAutoEvent(name);
  }, [name, updateAutoEvent]);

  // Load existing service in edit mode
  useEffect(() => {
    if (existing && isEdit) {
      const e = existing as any;
      setName(e.name ?? "");
      setNameAr(e.nameAr ?? "");
      setDescription(e.description ?? "");
      setDescriptionAr(e.descriptionAr ?? "");
      setIcon(e.icon ?? "FileText");
      setCategory(e.category ?? "");
      setFormId(String(e.formId ?? ""));
      setStatus(e.status ?? "active");
      setDisplayOrder(String(e.displayOrder ?? 0));
      const ev = e.workflowEvent ?? "";
      setAutoEvent(ev || `hr.${toEventSlug(e.name)}.submitted`);
      setCustomEvent(ev);
      setCustomizeEvent(!!ev && ev !== `hr.${toEventSlug(e.name)}.submitted`);
      const s = e.settings ?? {};
      setRequiresApproval(s.requiresApproval ?? true);
      setAllowAttachments(s.allowAttachments ?? true);
      setSuccessMessage(s.successMessage ?? "");
      if (s.requestStatuses?.length) setRequestStatuses(s.requestStatuses);
      const p = e.permissions ?? {};
      setVisibleTo(p.visibleTo ?? "all");
    }
  }, [existing, isEdit]);

  // ── Submit ─────────────────────────────────────────────────────────────────
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast({ title: isAr ? "اسم الخدمة مطلوب" : "Service name is required", variant: "destructive" });
      return;
    }

    const finalEvent = customizeEvent ? customEvent.trim() : autoEvent;

    const payload = {
      name: name.trim(),
      nameAr: nameAr.trim() || undefined,
      description: description.trim() || undefined,
      descriptionAr: descriptionAr.trim() || undefined,
      icon,
      category: category || undefined,
      formId: formId ? Number(formId) : undefined,
      workflowEvent: finalEvent || undefined,
      status,
      displayOrder: Number(displayOrder) || 0,
      permissions: { visibleTo },
      settings: {
        requiresApproval,
        allowAttachments,
        successMessage: successMessage.trim() || undefined,
        requestStatuses,
      },
    };

    if (isEdit) {
      updateMutation.mutate(
        { id: Number(params.id), data: payload },
        {
          onSuccess: () => {
            toast({ title: isAr ? "تم تحديث الخدمة" : "Service updated" });
            navigate("/admin/hr/services");
          },
          onError: () => toast({ title: isAr ? "فشل التحديث" : "Failed to update", variant: "destructive" }),
        }
      );
    } else {
      createMutation.mutate(
        { data: payload },
        {
          onSuccess: () => {
            toast({ title: isAr ? "تم إنشاء الخدمة وتسجيل الأحداث تلقائياً" : "Service created - events auto-registered" });
            navigate("/admin/hr/services");
          },
          onError: () => toast({ title: isAr ? "فشل الإنشاء" : "Failed to create", variant: "destructive" }),
        }
      );
    }
  }

  if (isEdit && loadingExisting) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-10 w-60" />
        <Card><CardContent className="p-6"><Skeleton className="h-64 w-full" /></CardContent></Card>
      </div>
    );
  }

  const isPending = createMutation.isPending || updateMutation.isPending;
  const { Icon: SelectedIcon } = ICONS.find(i => i.name === icon) ?? ICONS[0];
  const displayedEvent = customizeEvent ? customEvent : autoEvent;

  const TABS = [
    { id: "info",     label: isAr ? "معلومات الخدمة" : "Service Info",   icon: FileText },
    { id: "flow",     label: isAr ? "مسار الطلب"     : "Request Flow",   icon: GitBranch },
    { id: "workflow", label: isAr ? "سير العمل"       : "Workflow",       icon: Zap },
    { id: "preview",  label: isAr ? "معاينة"          : "Preview",        icon: Eye },
  ] as const;

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <Link href="/admin/hr/services">
          <button type="button" className="p-1 rounded-md hover:bg-accent transition-colors text-muted-foreground hover:text-foreground">
            <ChevronLeft className="w-5 h-5" />
          </button>
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold">
            {isEdit ? (isAr ? "تعديل الخدمة" : "Edit Service") : (isAr ? "إنشاء خدمة جديدة" : "Create New Service")}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {isAr
              ? "التصنيفات والحالات والأحداث تُولَّد تلقائياً - لا حاجة لإعداد يدوي"
              : "Categories, statuses and workflow events are auto-generated - no manual setup required"}
          </p>
        </div>
        <Button type="submit" disabled={isPending} className="gap-1.5 shrink-0">
          {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {isPending
            ? (isAr ? "جارٍ الحفظ..." : "Saving...")
            : isEdit ? (isAr ? "تحديث" : "Update") : (isAr ? "إنشاء الخدمة" : "Create Service")}
        </Button>
      </div>

      {/* ── Tab bar ───────────────────────────────────────────────────────── */}
      <div className="flex gap-1 border-b border-border">
        {TABS.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
              tab === t.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30"
            )}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Info Tab ──────────────────────────────────────────────────────── */}
      {tab === "info" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 space-y-5">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{isAr ? "الاسم والوصف" : "Name & Description"}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="name">
                      {isAr ? "اسم الخدمة (إنجليزي)" : "Service Name (English)"}
                      <span className="text-destructive ml-1">*</span>
                    </Label>
                    <Input
                      id="name"
                      value={name}
                      onChange={e => { setName(e.target.value); updateAutoEvent(e.target.value); }}
                      placeholder="e.g. Annual Leave Request"
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="nameAr">{isAr ? "اسم الخدمة (عربي)" : "Service Name (Arabic)"}</Label>
                    <Input id="nameAr" value={nameAr} onChange={e => setNameAr(e.target.value)} placeholder="مثال: طلب إجازة سنوية" dir="rtl" />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="description">{isAr ? "الوصف (إنجليزي)" : "Description (English)"}</Label>
                    <Textarea id="description" value={description} onChange={e => setDescription(e.target.value)} rows={3} placeholder="Brief description..." />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="descriptionAr">{isAr ? "الوصف (عربي)" : "Description (Arabic)"}</Label>
                    <Textarea id="descriptionAr" value={descriptionAr} onChange={e => setDescriptionAr(e.target.value)} rows={3} dir="rtl" placeholder="وصف مختصر..." />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">{isAr ? "التصنيف والإعدادات" : "Category & Settings"}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label>{isAr ? "التصنيف" : "Category"}</Label>
                  <CategorySelector value={category} onChange={setCategory} isAr={isAr} />
                  <p className="text-xs text-muted-foreground">{isAr ? "أنشئ تصنيفاً مخصصاً أو اختر من الموجودة" : "Create a custom category or pick from existing ones"}</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="status">{isAr ? "حالة الخدمة" : "Service Status"}</Label>
                    <Select value={status} onValueChange={setStatus}>
                      <SelectTrigger id="status"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">{isAr ? "نشطة" : "Active"}</SelectItem>
                        <SelectItem value="inactive">{isAr ? "غير نشطة" : "Inactive"}</SelectItem>
                        <SelectItem value="archived">{isAr ? "مؤرشفة" : "Archived"}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="formId">{isAr ? "النموذج المرتبط" : "Linked Form"}</Label>
                    <Select value={formId || "none"} onValueChange={v => setFormId(v === "none" ? "" : v)}>
                      <SelectTrigger id="formId"><SelectValue placeholder={isAr ? "اختر نموذجاً..." : "Select a form..."} /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">{isAr ? "بدون نموذج" : "No form"}</SelectItem>
                        {(formsList ?? []).map((f: any) => (
                          <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="visibleTo">{isAr ? "مرئي في الخدمات الذاتية لـ" : "Visible in Self-Service to"}</Label>
                  <Select value={visibleTo} onValueChange={setVisibleTo}>
                    <SelectTrigger id="visibleTo"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{isAr ? "الجميع" : "Everyone"}</SelectItem>
                      <SelectItem value="member">{isAr ? "الموظفون فقط" : "Employees only"}</SelectItem>
                      <SelectItem value="manager_above">{isAr ? "المدراء فما فوق" : "Managers & above"}</SelectItem>
                      <SelectItem value="admin_only">{isAr ? "المشرفون فقط" : "Admins only"}</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">{isAr ? "يُحدّد من يرى هذه الخدمة في بوابة الخدمات الذاتية" : "Controls who sees this service in the self-service portal"}</p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="displayOrder">{isAr ? "ترتيب العرض" : "Display Order"}</Label>
                  <Input id="displayOrder" type="number" min="0" value={displayOrder} onChange={e => setDisplayOrder(e.target.value)} className="w-28" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Icon picker */}
          <div className="space-y-5">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{isAr ? "الأيقونة" : "Icon"}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-4 gap-2">
                  {ICONS.map(({ name: n, Icon }) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setIcon(n)}
                      className={cn(
                        "p-2.5 rounded-lg flex flex-col items-center gap-1 transition-all text-xs",
                        icon === n
                          ? "bg-primary text-primary-foreground"
                          : "hover:bg-accent text-muted-foreground hover:text-foreground"
                      )}
                      title={n}
                    >
                      <Icon className="w-5 h-5" />
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Settings switches */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{isAr ? "إعدادات سريعة" : "Quick Settings"}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{isAr ? "يتطلب موافقة" : "Requires Approval"}</p>
                    <p className="text-xs text-muted-foreground">{isAr ? "يجب اعتماد الطلب من المدير" : "Request must be approved by a manager"}</p>
                  </div>
                  <Switch checked={requiresApproval} onCheckedChange={setRequiresApproval} />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{isAr ? "السماح بالمرفقات" : "Allow Attachments"}</p>
                    <p className="text-xs text-muted-foreground">{isAr ? "يمكن رفع مستندات داعمة" : "Allow uploading supporting documents"}</p>
                  </div>
                  <Switch checked={allowAttachments} onCheckedChange={setAllowAttachments} />
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* ── Request Flow Tab ──────────────────────────────────────────────── */}
      {tab === "flow" && (
        <div className="space-y-5 max-w-2xl">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{isAr ? "حالات مسار الطلب" : "Request Status Flow"}</CardTitle>
              <CardDescription>
                {isAr
                  ? "عرّف مراحل معالجة الطلب. ستظهر هذه الحالات للموظفين ومديري الموارد البشرية."
                  : "Define the stages a request goes through. These statuses are visible to employees and HR managers."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <StatusBuilder statuses={requestStatuses} onChange={setRequestStatuses} isAr={isAr} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{isAr ? "رسالة نجاح الإرسال" : "Submission Success Message"}</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                value={successMessage}
                onChange={e => setSuccessMessage(e.target.value)}
                placeholder={isAr ? "مثال: تم استلام طلبك وسيتم مراجعته خلال يومي عمل." : "e.g. Your request has been received and will be reviewed within 2 business days."}
                rows={3}
              />
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Workflow Tab ──────────────────────────────────────────────────── */}
      {tab === "workflow" && (
        <div className="space-y-5 max-w-2xl">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Zap className="w-4 h-4 text-primary" />
                {isAr ? "حدث سير العمل (مولَّد تلقائياً)" : "Workflow Trigger Event (Auto-Generated)"}
              </CardTitle>
              <CardDescription>
                {isAr
                  ? "يتم توليد حدث سير العمل تلقائياً من اسم الخدمة وتسجيله في سجل الأحداث. لا يلزمك إدخال أي شيء."
                  : "The workflow event is automatically derived from the service name and registered in the event registry. No manual input required."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Auto-generated event display */}
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 flex items-center gap-3">
                <Zap className="w-4 h-4 text-primary shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground mb-1">{isAr ? "الحدث المولَّد تلقائياً" : "Auto-generated event"}</p>
                  <code className="text-sm font-mono text-primary">{autoEvent || "hr.service_name.submitted"}</code>
                </div>
                {!customizeEvent && (
                  <Badge variant="secondary" className="text-xs gap-1 shrink-0">
                    <CheckCircle2 className="w-3 h-3" />
                    {isAr ? "نشط" : "Active"}
                  </Badge>
                )}
              </div>

              {/* Lifecycle events */}
              <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
                <p className="text-xs font-medium text-muted-foreground">{isAr ? "الأحداث المُسجَّلة تلقائياً" : "Auto-registered lifecycle events"}</p>
                {["submitted", "status_changed", "completed", "rejected"].map(suffix => {
                  const base = `hr.${toEventSlug(name || "service")}`;
                  return (
                    <div key={suffix} className="flex items-center gap-2 text-xs">
                      <div className="w-1.5 h-1.5 rounded-full bg-primary/60" />
                      <code className="font-mono text-muted-foreground">{base}.{suffix}</code>
                    </div>
                  );
                })}
              </div>

              {/* Override option */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{isAr ? "تخصيص الحدث يدوياً" : "Customize event manually"}</p>
                  <p className="text-xs text-muted-foreground">{isAr ? "تجاوز الحدث المولَّد تلقائياً" : "Override the auto-generated event"}</p>
                </div>
                <Switch checked={customizeEvent} onCheckedChange={v => { setCustomizeEvent(v); if (!v) setCustomEvent(autoEvent); }} />
              </div>

              {customizeEvent && (
                <div className="space-y-1.5">
                  <Label>{isAr ? "حدث مخصص" : "Custom Event"}</Label>
                  <Input
                    value={customEvent}
                    onChange={e => setCustomEvent(e.target.value)}
                    placeholder="hr.custom.submitted"
                    className="font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground">{isAr ? "استخدم نقاطاً فقط كفواصل، لا مسافات" : "Use dots as separators only, no spaces"}</p>
                </div>
              )}

              {/* Auto-workflow creation notice */}
              {!isEdit && (
                <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 p-3 flex items-start gap-2 text-xs text-emerald-800 dark:text-emerald-300">
                  <GitBranch className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>
                    {isAr
                      ? "سيتم إنشاء قالب سير عمل تلقائي (مسودة) عند حفظ الخدمة. يمكنك تفعيله من صفحة سير العمل لاحقاً."
                      : "A draft workflow template will be auto-created when you save. You can activate it from the Workflows page later."}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Preview Tab ───────────────────────────────────────────────────── */}
      {tab === "preview" && (
        <div className="space-y-5 max-w-lg">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{isAr ? "معاينة بطاقة الخدمة" : "Service Card Preview"}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-xl border border-border p-5 bg-gradient-to-br from-background to-muted/20 hover:shadow-md transition-shadow">
                <div className="flex items-start gap-4">
                  <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
                    <SelectedIcon className="w-7 h-7 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold">{name || (isAr ? "اسم الخدمة" : "Service Name")}</p>
                    {nameAr && <p className="text-sm text-muted-foreground" dir="rtl">{nameAr}</p>}
                    {description && <p className="text-sm text-muted-foreground mt-1.5 line-clamp-2">{description}</p>}
                    <div className="flex flex-wrap items-center gap-2 mt-3">
                      {category && (
                        <Badge variant="outline" className="text-xs">{category}</Badge>
                      )}
                      {formId && (
                        <Badge variant="outline" className="text-xs gap-1">
                          <FileText className="w-2.5 h-2.5" />
                          {isAr ? "نموذج مرتبط" : "Linked form"}
                        </Badge>
                      )}
                      {requiresApproval && (
                        <Badge variant="outline" className="text-xs">{isAr ? "يتطلب موافقة" : "Requires approval"}</Badge>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Status flow preview */}
          {requestStatuses.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{isAr ? "مسار حالات الطلب" : "Request Status Flow"}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-1 flex-wrap">
                  {requestStatuses.map((s, i) => (
                    <div key={s.key} className="flex items-center gap-1">
                      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium text-white" style={{ backgroundColor: s.color }}>
                        {s.isDefault && <Circle className="w-2.5 h-2.5 fill-white" />}
                        {s.isFinal && <AlertCircle className="w-2.5 h-2.5" />}
                        {isAr && s.labelAr ? s.labelAr : s.label}
                      </div>
                      {i < requestStatuses.length - 1 && (
                        <span className="text-muted-foreground text-xs">→</span>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Event preview */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Zap className="w-4 h-4 text-primary" />
                {isAr ? "الأحداث المولَّدة" : "Generated Events"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1.5">
                {["submitted", "status_changed", "completed", "rejected"].map(suffix => (
                  <div key={suffix} className="flex items-center gap-2 text-xs">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    <code className="font-mono text-muted-foreground">
                      hr.{toEventSlug(name || "service")}.{suffix}
                    </code>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Bottom save bar ───────────────────────────────────────────────── */}
      <div className="flex justify-end pt-2 border-t border-border">
        <div className="flex gap-3">
          <Link href="/admin/hr/services">
            <Button type="button" variant="outline">{isAr ? "إلغاء" : "Cancel"}</Button>
          </Link>
          <Button type="submit" disabled={isPending} className="gap-1.5">
            {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {isPending
              ? (isAr ? "جارٍ الحفظ..." : "Saving...")
              : isEdit ? (isAr ? "تحديث الخدمة" : "Update Service") : (isAr ? "إنشاء الخدمة" : "Create Service")}
          </Button>
        </div>
      </div>
    </form>
  );
}
