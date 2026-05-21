import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import {
  useListSelfServiceForms,
  useListSelfServiceServices,
  useListMySubmissions,
  useListApprovals,
  useUpdateApproval,
} from "@workspace/api-client-react";
import { usePermissions } from "@/hooks/use-permissions";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { InlineFormDialog } from "@/components/forms/form-renderer";
import {
  ConciergeBell, Search, ChevronRight,
  FileText, ClipboardList, Plane, HeartPulse, Award, Wrench,
  RefreshCw, UserCheck, Package, Briefcase, DollarSign,
  CheckSquare, Check, X, ArrowRight, Clock, AlertCircle,
  CheckCircle2, XCircle, FileCheck, Hash, User,
  type LucideIcon,
} from "lucide-react";

// ── Icon / style helpers ──────────────────────────────────────────────────────

const ICON_COMPONENTS: Record<string, LucideIcon> = {
  FileText, ClipboardList, Plane, HeartPulse, Award, Wrench,
  RefreshCw, UserCheck, Package, Briefcase,
};

const ICON_HINTS: Record<string, LucideIcon> = {
  leave: Plane, travel: Plane, health: HeartPulse, medical: HeartPulse,
  award: Award, training: Award, maintenance: Wrench, it: Wrench,
  onboarding: UserCheck, request: Package, hr: Briefcase, general: ClipboardList,
};

function getCategoryStyle(key: string) {
  const MAP: Record<string, { bg: string; dot: string; text: string }> = {
    hr:          { bg: "bg-violet-500/10", dot: "bg-violet-500",  text: "text-violet-600 dark:text-violet-400" },
    tickets:     { bg: "bg-blue-500/10",   dot: "bg-blue-500",    text: "text-blue-600 dark:text-blue-400" },
    approvals:   { bg: "bg-amber-500/10",  dot: "bg-amber-500",   text: "text-amber-600 dark:text-amber-400" },
    departments: { bg: "bg-emerald-500/10",dot: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400" },
    leave:       { bg: "bg-sky-500/10",    dot: "bg-sky-500",     text: "text-sky-600 dark:text-sky-400" },
    general:     { bg: "bg-slate-500/10",  dot: "bg-slate-500",   text: "text-slate-600 dark:text-slate-400" },
    forms:       { bg: "bg-teal-500/10",   dot: "bg-teal-500",    text: "text-teal-600 dark:text-teal-400" },
    other:       { bg: "bg-slate-500/10",  dot: "bg-slate-500",   text: "text-slate-600 dark:text-slate-400" },
  };
  return MAP[key] ?? MAP["general"]!;
}

function guessIcon(icon: string | null | undefined, name: string, category?: string | null): LucideIcon {
  if (icon && ICON_COMPONENTS[icon]) return ICON_COMPONENTS[icon]!;
  const hay = `${name} ${category ?? ""}`.toLowerCase();
  for (const [key, ic] of Object.entries(ICON_HINTS)) {
    if (hay.includes(key)) return ic;
  }
  return FileText;
}

const CATEGORY_LABELS: Record<string, { en: string; ar: string }> = {
  hr:          { en: "Human Resources",    ar: "الموارد البشرية" },
  leave:       { en: "Leave & Attendance", ar: "الإجازات والحضور" },
  tickets:     { en: "Tickets",            ar: "التذاكر" },
  approvals:   { en: "Approvals",          ar: "الموافقات" },
  departments: { en: "Departments",        ar: "الأقسام" },
  general:     { en: "General",            ar: "عام" },
  forms:       { en: "Forms",              ar: "النماذج" },
  other:       { en: "Other",              ar: "أخرى" },
};

function categoryLabel(key: string, isAr: boolean) {
  const m = CATEGORY_LABELS[key];
  if (!m) return key;
  return isAr ? m.ar : m.en;
}

// ── Status helpers ────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, {
  labelEn: string; labelAr: string;
  icon: LucideIcon; bg: string; text: string; dot: string;
}> = {
  draft:            { labelEn: "Draft",            labelAr: "مسودة",              icon: FileText,    bg: "bg-slate-100 dark:bg-slate-800",   text: "text-slate-600 dark:text-slate-400",   dot: "bg-slate-400" },
  submitted:        { labelEn: "Submitted",         labelAr: "مُقدَّم",            icon: Clock,       bg: "bg-blue-50 dark:bg-blue-950/40",    text: "text-blue-700 dark:text-blue-300",     dot: "bg-blue-500" },
  pending_approval: { labelEn: "Pending Approval",  labelAr: "بانتظار الموافقة",  icon: Clock,       bg: "bg-amber-50 dark:bg-amber-950/40",  text: "text-amber-700 dark:text-amber-300",   dot: "bg-amber-500" },
  approved:         { labelEn: "Approved",           labelAr: "مقبول",             icon: CheckCircle2, bg: "bg-emerald-50 dark:bg-emerald-950/40", text: "text-emerald-700 dark:text-emerald-300", dot: "bg-emerald-500" },
  rejected:         { labelEn: "Rejected",           labelAr: "مرفوض",             icon: XCircle,     bg: "bg-red-50 dark:bg-red-950/40",      text: "text-red-700 dark:text-red-300",       dot: "bg-red-500" },
  cancelled:        { labelEn: "Cancelled",          labelAr: "ملغى",              icon: X,           bg: "bg-slate-100 dark:bg-slate-800",    text: "text-slate-600 dark:text-slate-400",   dot: "bg-slate-400" },
  completed:        { labelEn: "Completed",          labelAr: "مكتمل",             icon: FileCheck,   bg: "bg-teal-50 dark:bg-teal-950/40",    text: "text-teal-700 dark:text-teal-300",     dot: "bg-teal-500" },
};

function StatusBadge({ status, isAr }: { status: string; isAr: boolean }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG["submitted"]!;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${cfg.bg} ${cfg.text}`}>
      <Icon className="w-3 h-3" />
      {isAr ? cfg.labelAr : cfg.labelEn}
    </span>
  );
}

// ── Unified service item type ─────────────────────────────────────────────────

type ServiceItem = {
  id:            string;
  name:          string;
  nameAr?:       string | null;
  description?:  string | null;
  descriptionAr?: string | null;
  category:      string;
  icon?:         string | null;
  formId?:       number | null;
};

// ════════════════════════════════════════════════════════════════════════════
// TAB 1 - Submit a Request
// ════════════════════════════════════════════════════════════════════════════

function SubmitRequestTab({ isAr }: { isAr: boolean }) {
  const [search, setSearch]             = useState("");
  const [dialogFormId, setDialogFormId] = useState<number | null>(null);
  const [dialogOpen, setDialogOpen]     = useState(false);

  const { data: forms = [],    isLoading: formsLoading }    = useListSelfServiceForms();
  const { data: services = [], isLoading: servicesLoading } = useListSelfServiceServices();
  const isLoading = formsLoading || servicesLoading;

  function openForm(formId: number) {
    setDialogFormId(formId);
    setDialogOpen(true);
  }

  const allItems: ServiceItem[] = useMemo(() => {
    const formItems: ServiceItem[] = (forms as any[]).map((f) => ({
      id: `form-${f.id}`, name: f.name, nameAr: f.nameAr,
      description: f.description, descriptionAr: f.descriptionAr,
      category: f.module ?? f.category ?? "general", icon: null, formId: f.id,
    }));
    const serviceItems: ServiceItem[] = (services as any[]).map((s) => ({
      id: `service-${s.id}`, name: s.name ?? "", nameAr: s.nameAr,
      description: s.description, descriptionAr: s.descriptionAr,
      category: s.category ?? "other", icon: s.icon, formId: s.formId ?? null,
    }));
    const serviceFormIds = new Set((services as any[]).filter((s) => s.formId).map((s) => `form-${s.formId}`));
    return [...formItems.filter((f) => !serviceFormIds.has(f.id)), ...serviceItems];
  }, [forms, services]);

  const filtered = useMemo(() => {
    if (!search.trim()) return allItems;
    const q = search.toLowerCase();
    return allItems.filter((item) => {
      const name = (isAr && item.nameAr ? item.nameAr : item.name).toLowerCase();
      const desc = (isAr && item.descriptionAr ? item.descriptionAr : (item.description ?? "")).toLowerCase();
      return name.includes(q) || desc.includes(q) || item.category.includes(q);
    });
  }, [allItems, search, isAr]);

  const grouped = useMemo(() => {
    const g: Record<string, ServiceItem[]> = {};
    for (const item of filtered) (g[item.category] ??= []).push(item);
    return g;
  }, [filtered]);

  const groupKeys = Object.keys(grouped).sort();

  return (
    <div className="space-y-6">
      {/* Quick Links */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <Link href="/self-service/payslips">
          <Card className="hover:shadow-md hover:border-primary/30 transition-all cursor-pointer group">
            <CardContent className="p-5 flex items-center gap-4">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <DollarSign className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm">{isAr ? "كشف الراتب" : "My Payslips"}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{isAr ? "عرض وتنزيل كشوف الرواتب" : "View & download your payslips"}</p>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 group-hover:text-primary transition-colors" />
            </CardContent>
          </Card>
        </Link>
        <Link href="/self-service/leave">
          <Card className="hover:shadow-md hover:border-primary/30 transition-all cursor-pointer group">
            <CardContent className="p-5 flex items-center gap-4">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 bg-sky-500/10 text-sky-600 dark:text-sky-400">
                <Plane className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm">{isAr ? "إجازاتي" : "My Leave"}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{isAr ? "طلب إجازة ومتابعة الرصيد" : "Request leave & track your balance"}</p>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 group-hover:text-primary transition-colors" />
            </CardContent>
          </Card>
        </Link>
        <Link href="/self-service/attendance">
          <Card className="hover:shadow-md hover:border-primary/30 transition-all cursor-pointer group">
            <CardContent className="p-5 flex items-center gap-4">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 bg-violet-500/10 text-violet-600 dark:text-violet-400">
                <Clock className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm">{isAr ? "حضوري" : "My Attendance"}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {isAr ? "تسجيل دخول/خروج" : "Clock in/out"}
                </p>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 group-hover:text-primary transition-colors" />
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        <Input
          placeholder={isAr ? "بحث في الخدمات..." : "Search services..."}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}><CardContent className="p-5"><Skeleton className="h-20 w-full" /></CardContent></Card>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <ConciergeBell className="w-14 h-14 text-muted-foreground/20 mb-4" />
          <p className="text-lg font-medium text-muted-foreground">
            {search
              ? (isAr ? "لا توجد خدمات مطابقة للبحث" : "No services match your search")
              : (isAr ? "لا توجد خدمات متاحة حالياً" : "No services available yet")}
          </p>
          {search && (
            <button className="mt-2 text-sm text-primary hover:underline" onClick={() => setSearch("")}>
              {isAr ? "مسح البحث" : "Clear search"}
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-8">
          {groupKeys.map((cat) => {
            const style = getCategoryStyle(cat);
            return (
              <div key={cat}>
                <div className="flex items-center gap-2 mb-3">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${style.dot}`} />
                  <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                    {categoryLabel(cat, isAr)}
                  </h2>
                  <span className="text-xs text-muted-foreground/50">({grouped[cat]!.length})</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                  {grouped[cat]!.map((item) => {
                    const Icon  = guessIcon(item.icon, item.name, item.category);
                    const name  = isAr && item.nameAr ? item.nameAr : item.name;
                    const desc  = isAr && item.descriptionAr ? item.descriptionAr : item.description;
                    const hasForm = !!item.formId;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        disabled={!hasForm}
                        onClick={() => hasForm && openForm(item.formId!)}
                        className="text-left w-full disabled:cursor-not-allowed"
                      >
                        <Card className={`transition-all group h-full ${hasForm ? "hover:shadow-md hover:border-primary/30 cursor-pointer" : "opacity-55"}`}>
                          <CardContent className="p-5">
                            <div className="flex items-start gap-4">
                              <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${style.bg} ${style.text}`}>
                                <Icon className="w-5 h-5" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-2">
                                  <p className="font-semibold text-sm leading-snug">{name}</p>
                                  {hasForm && <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 group-hover:text-primary transition-colors" />}
                                </div>
                                {desc && <p className="text-xs text-muted-foreground mt-1 line-clamp-2 leading-relaxed">{desc}</p>}
                                {!hasForm && (
                                  <Badge variant="outline" className="text-xs py-0 mt-1.5 text-muted-foreground">
                                    {isAr ? "قريباً" : "Coming soon"}
                                  </Badge>
                                )}
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <InlineFormDialog
        formId={dialogFormId}
        open={dialogOpen}
        onOpenChange={(open) => { setDialogOpen(open); if (!open) setDialogFormId(null); }}
      />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// TAB 2 - My Requests
// ════════════════════════════════════════════════════════════════════════════

function MyRequestsTab({ isAr }: { isAr: boolean }) {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const { data: submissions = [], isLoading } = useListMySubmissions(
    statusFilter !== "all" ? { status: statusFilter } : undefined,
  );

  const STATUS_FILTERS = [
    { value: "all",            en: "All",              ar: "الكل" },
    { value: "submitted",      en: "Submitted",        ar: "مُقدَّم" },
    { value: "pending_approval", en: "Pending",        ar: "معلّق" },
    { value: "approved",       en: "Approved",         ar: "مقبول" },
    { value: "rejected",       en: "Rejected",         ar: "مرفوض" },
    { value: "completed",      en: "Completed",        ar: "مكتمل" },
  ];

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-28 w-full rounded-xl" />)}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Filter pills */}
      <div className="flex items-center gap-2 flex-wrap">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setStatusFilter(f.value)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              statusFilter === f.value
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            {isAr ? f.ar : f.en}
          </button>
        ))}
      </div>

      {(submissions as any[]).length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <FileCheck className="w-14 h-14 text-muted-foreground/20 mb-4" />
          <p className="text-lg font-medium text-muted-foreground">
            {isAr ? "لا توجد طلبات بعد" : "No requests yet"}
          </p>
          <p className="text-sm text-muted-foreground/70 mt-1">
            {isAr
              ? "ستظهر طلباتك هنا بعد تقديمها من قسم \"تقديم طلب\""
              : "Submitted requests will appear here after you fill them out"}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {(submissions as any[]).map((sub) => {
            const cfg    = STATUS_CONFIG[sub.status as string] ?? STATUS_CONFIG["submitted"]!;
            const fName  = isAr && sub.formNameAr ? sub.formNameAr : sub.formName;
            const isTerminal = ["approved", "rejected", "completed", "cancelled"].includes(sub.status as string);

            return (
              <Card key={sub.id} className="hover:shadow-sm transition-shadow">
                <CardContent className="p-5">
                  <div className="flex flex-col gap-3">
                    {/* Top row: number + status + date */}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        {sub.requestNumber && (
                          <span className="inline-flex items-center gap-1 text-xs font-mono font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-md shrink-0">
                            <Hash className="w-3 h-3" />
                            {sub.requestNumber as string}
                          </span>
                        )}
                        <StatusBadge status={sub.status as string} isAr={isAr} />
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {formatDistanceToNow(new Date(sub.submittedAt as string), { addSuffix: true })}
                      </span>
                    </div>

                    {/* Form name */}
                    <div>
                      <p className="font-semibold text-sm leading-snug">{fName ?? (isAr ? "نموذج غير معروف" : "Unknown form")}</p>
                    </div>

                    {/* Current step / waiting on */}
                    {!isTerminal && sub.currentStepLabel && (
                      <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 rounded-lg px-3 py-2">
                        <Clock className="w-3.5 h-3.5 shrink-0" />
                        <span>
                          {isAr ? "الخطوة الحالية: " : "Current step: "}
                          <span className="font-medium">{sub.currentStepLabel as string}</span>
                        </span>
                        {sub.waitingOnName && (
                          <span className="text-muted-foreground">
                            {" · "}
                            <User className="w-3 h-3 inline mx-0.5" />
                            {sub.waitingOnName as string}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Review note / rejection reason */}
                    {sub.reviewNote && (
                      <div className={`flex items-start gap-2 text-xs rounded-lg px-3 py-2 ${
                        sub.status === "rejected"
                          ? "bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300"
                          : "bg-muted text-muted-foreground"
                      }`}>
                        <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        <span>
                          <span className="font-medium">
                            {sub.status === "rejected"
                              ? (isAr ? "سبب الرفض: " : "Rejection reason: ")
                              : (isAr ? "ملاحظة: " : "Note: ")}
                          </span>
                          {sub.reviewNote as string}
                        </span>
                      </div>
                    )}

                    {/* Draft badge */}
                    {sub.status === "draft" && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted rounded-lg px-3 py-2">
                        <FileText className="w-3.5 h-3.5 shrink-0" />
                        {isAr ? "هذا الطلب محفوظ كمسودة ولم يُقدَّم بعد" : "This request is saved as a draft and not submitted yet"}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// TAB 3 - Pending Approvals (managers only)
// ════════════════════════════════════════════════════════════════════════════

function ApprovalsTab({ isAr }: { isAr: boolean }) {
  const { data: approvals, isLoading } = useListApprovals({ status: "pending" });
  const updateApproval = useUpdateApproval();
  const queryClient    = useQueryClient();

  const handleAction = (id: number, status: "approved" | "rejected") => {
    updateApproval.mutate(
      { id, data: { status } },
      { onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/approvals"] }) }
    );
  };

  if (isLoading) {
    return <div className="space-y-4">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full rounded-lg" />)}</div>;
  }

  if (!approvals?.length) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <CheckSquare className="w-14 h-14 text-muted-foreground/20 mb-4" />
        <p className="text-lg font-medium text-muted-foreground">
          {isAr ? "لا توجد موافقات معلّقة" : "No pending approvals"}
        </p>
        <p className="text-sm text-muted-foreground/70 mt-1">
          {isAr ? "ستظهر الطلبات المعلّقة هنا عند وجودها" : "Pending requests will appear here when available"}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {(approvals as any[]).map((app) => (
        <Card key={app.id} className="hover:shadow-sm transition-shadow">
          <CardContent className="p-5">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge className="text-[10px] uppercase tracking-wider bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-none">
                    {isAr ? "في انتظار الموافقة" : "Pending"}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(app.createdAt), { addSuffix: true })}
                  </span>
                </div>
                <p className="font-semibold">{isAr ? "طلب موافقة" : "Approval Request"}</p>
                <p className="text-sm text-muted-foreground">
                  {isAr ? `بواسطة: ${app.requestedByName}` : `Requested by: ${app.requestedByName}`}
                </p>
                <Link href={`/tickets/${app.ticketId}`} className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
                  {isAr ? "عرض التذكرة" : "View ticket"}
                  <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  variant="outline" size="sm"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/20"
                  onClick={() => handleAction(app.id, "rejected")}
                  disabled={updateApproval.isPending}
                >
                  <X className="w-4 h-4 mr-1.5" />
                  {isAr ? "رفض" : "Reject"}
                </Button>
                <Button
                  size="sm" className="bg-green-600 hover:bg-green-700 text-white"
                  onClick={() => handleAction(app.id, "approved")}
                  disabled={updateApproval.isPending}
                >
                  <Check className="w-4 h-4 mr-1.5" />
                  {isAr ? "قبول" : "Approve"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Main page
// ════════════════════════════════════════════════════════════════════════════

type Tab = "submit" | "my-requests" | "approvals";

export default function SelfServicePage() {
  const { i18n }           = useTranslation();
  const isAr               = i18n.language.startsWith("ar");
  const { isAdminOrManager } = usePermissions();
  const { data: mySubmissions = [] } = useListMySubmissions();

  const [activeTab, setActiveTab] = useState<Tab>("submit");

  const pendingCount = (mySubmissions as any[]).filter((s) =>
    ["submitted", "pending_approval"].includes(s.status as string)
  ).length;

  const tabs: { key: Tab; labelEn: string; labelAr: string; badge?: number }[] = [
    { key: "submit",       labelEn: "Submit a Request",    labelAr: "تقديم طلب" },
    { key: "my-requests",  labelEn: "My Requests",         labelAr: "طلباتي",      badge: pendingCount },
    ...(isAdminOrManager
      ? [{ key: "approvals" as Tab, labelEn: "Pending Approvals", labelAr: "الموافقات المعلّقة" }]
      : []),
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ConciergeBell className="w-6 h-6 text-primary" />
          {isAr ? "الخدمات الذاتية" : "Self-Service"}
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {isAr
            ? "قدّم طلباتك، تصفّح الخدمات المتاحة، وراجع موافقاتك"
            : "Browse available services, submit requests, and track their status"}
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-0.5 border-b border-border">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`relative px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === tab.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
            }`}
          >
            {isAr ? tab.labelAr : tab.labelEn}
            {tab.badge != null && tab.badge > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center w-4 h-4 text-[10px] font-bold rounded-full bg-primary text-primary-foreground">
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {activeTab === "submit"      && <SubmitRequestTab isAr={isAr} />}
      {activeTab === "my-requests" && <MyRequestsTab   isAr={isAr} />}
      {activeTab === "approvals"   && <ApprovalsTab    isAr={isAr} />}
    </div>
  );
}
