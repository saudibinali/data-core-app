import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createHrPayrollBand,
  createHrPayrollComponent,
  createHrPayrollRun,
  createHrPayrollStructure,
  deleteHrPayrollBand,
  deleteHrPayrollComponent,
  getListHrPayrollBandsQueryKey,
  getListHrPayrollCanonicalPeriodsQueryKey,
  getListHrPayrollCanonicalRunsQueryKey,
  getListHrPayrollComponentsQueryKey,
  getListHrPayrollRunsQueryKey,
  getListHrPayrollStructuresQueryKey,
  processHrPayrollRun,
  updateHrPayrollBand,
  updateHrPayrollComponent,
  updateHrPayrollRun,
  useCalculateHrPayrollCanonicalRun,
  useCreateHrPayrollCanonicalFinalRun,
  useListHrJobGrades,
  useListHrPayrollBands,
  useListHrPayrollCanonicalPeriods,
  useListHrPayrollCanonicalRuns,
  useListHrPayrollComponents,
  useListHrPayrollRuns,
  useListHrPayrollStructures,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { usePayrollCutover } from "@/lib/payroll-cutover-flags";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  DollarSign, Plus, Play, CheckCircle2, Wallet, BarChart3,
  Layers, Sliders, TrendingUp, ChevronRight, RefreshCw,
  Trash2, Pencil, Info, ArrowRight,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const MONTH_NAMES_AR = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];

function fmtCurrency(val: string | number | null, currency = "SAR") {
  const n = parseFloat(String(val ?? 0)) || 0;
  return `${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

const RUN_STATUS_CONFIG: Record<string, { label: string; labelAr: string; color: string }> = {
  draft:      { label: "Draft",      labelAr: "مسودة",    color: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" },
  processing: { label: "Processing", labelAr: "جاري",     color: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300" },
  approved:   { label: "Approved",   labelAr: "معتمد",    color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" },
  paid:       { label: "Paid",       labelAr: "مدفوع",    color: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300" },
  cancelled:  { label: "Cancelled",  labelAr: "ملغى",     color: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" },
};

const CANONICAL_RUN_STATUS_CONFIG: Record<string, { label: string; labelAr: string; color: string }> = {
  draft:       { label: "Draft",       labelAr: "مسودة",   color: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" },
  calculating: { label: "Calculating", labelAr: "حساب",    color: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300" },
  review:      { label: "Review",      labelAr: "مراجعة",  color: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300" },
  approved:    { label: "Approved",    labelAr: "معتمد",   color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" },
  locked:      { label: "Locked",      labelAr: "مقفل",    color: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300" },
};

const COMP_TYPE_CONFIG: Record<string, { label: string; labelAr: string; color: string }> = {
  base:       { label: "Base",       labelAr: "أساسي",    color: "bg-blue-100 text-blue-700" },
  allowance:  { label: "Allowance",  labelAr: "بدل",      color: "bg-emerald-100 text-emerald-700" },
  deduction:  { label: "Deduction",  labelAr: "خصم",      color: "bg-red-100 text-red-700" },
  bonus:      { label: "Bonus",      labelAr: "مكافأة",   color: "bg-amber-100 text-amber-700" },
  overtime:   { label: "Overtime",   labelAr: "إضافي",    color: "bg-violet-100 text-violet-700" },
};

type PayrollRecord = Record<string, unknown>;

export default function HrPayrollPage() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language.startsWith("ar");
  const { toast } = useToast();
  const qc = useQueryClient();

  const [activeTab, setActiveTab] = useState("runs");
  const [newRunOpen, setNewRunOpen] = useState(false);
  const [newComponentOpen, setNewComponentOpen] = useState(false);
  const [newStructureOpen, setNewStructureOpen] = useState(false);
  const [newBandOpen, setNewBandOpen] = useState(false);
  const [editingComponent, setEditingComponent] = useState<PayrollRecord | null>(null);
  const [editingBand, setEditingBand] = useState<PayrollRecord | null>(null);

  const [runForm, setRunForm] = useState({ periodYear: String(new Date().getFullYear()), periodMonth: String(new Date().getMonth() + 1), currencyCode: "SAR", notes: "" });
  const [canonicalPeriodId, setCanonicalPeriodId] = useState("");
  const { useCanonicalPayroll, legacyRunsReadOnly } = usePayrollCutover();
  const [compForm, setCompForm] = useState({ name: "", nameAr: "", componentType: "allowance", calculationType: "fixed", defaultValue: "", isTaxable: false });
  const [structForm, setStructForm] = useState({ name: "", nameAr: "", description: "", currencyCode: "SAR", isDefault: false });
  const [bandForm, setBandForm] = useState({ name: "", nameAr: "", gradeId: "__none__", currencyCode: "SAR", minAmount: "", midpointAmount: "", maxAmount: "" });

  const runsQ    = useListHrPayrollRuns({ query: { enabled: !useCanonicalPayroll } });
  const canonicalRunsQ = useListHrPayrollCanonicalRuns({ query: { enabled: useCanonicalPayroll } });
  const periodsQ = useListHrPayrollCanonicalPeriods({ query: { enabled: useCanonicalPayroll } });
  const compsQ   = useListHrPayrollComponents();
  const structsQ = useListHrPayrollStructures();
  const bandsQ   = useListHrPayrollBands();
  const gradesQ  = useListHrJobGrades();

  const invalidateRuns = () => qc.invalidateQueries({ queryKey: getListHrPayrollRunsQueryKey() });
  const invalidateComps = () => qc.invalidateQueries({ queryKey: getListHrPayrollComponentsQueryKey() });
  const invalidateStructs = () => qc.invalidateQueries({ queryKey: getListHrPayrollStructuresQueryKey() });
  const invalidateBands = () => qc.invalidateQueries({ queryKey: getListHrPayrollBandsQueryKey() });

  const createRun = useMutation({
    mutationFn: (body: Record<string, unknown>) => createHrPayrollRun(body),
    onSuccess: () => { void invalidateRuns(); setNewRunOpen(false); toast({ title: t("hr_payroll_run_created") }); },
    onError: () => toast({ title: t("hr_payroll_error"), variant: "destructive" }),
  });

  const processRun = useMutation({
    mutationFn: (id: number) => processHrPayrollRun(id),
    onSuccess: () => { void invalidateRuns(); toast({ title: t("hr_payroll_processed") }); },
    onError: () => toast({ title: t("hr_payroll_process_fail"), variant: "destructive" }),
  });

  const updateRunStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => updateHrPayrollRun(id, { status }),
    onSuccess: () => { void invalidateRuns(); toast({ title: t("hr_payroll_status_updated") }); },
  });

  const createCanonicalRun = useCreateHrPayrollCanonicalFinalRun({
    mutation: {
      onSuccess: () => {
        void invalidateRuns();
        void qc.invalidateQueries({ queryKey: getListHrPayrollCanonicalPeriodsQueryKey() });
        setNewRunOpen(false);
        toast({ title: isAr ? "تم إنشاء المسيرة" : "Payroll run created" });
      },
      onError: () => toast({ title: t("hr_payroll_error"), variant: "destructive" }),
    },
  });

  const calculateCanonicalRun = useCalculateHrPayrollCanonicalRun({
    mutation: {
      onSuccess: () => { void invalidateRuns(); toast({ title: t("hr_payroll_processed") }); },
      onError: () => toast({ title: t("hr_payroll_process_fail"), variant: "destructive" }),
    },
  });

  const createComp = useMutation({
    mutationFn: (body: Record<string, unknown>) => createHrPayrollComponent(body),
    onSuccess: () => { void invalidateComps(); setNewComponentOpen(false); setEditingComponent(null); toast({ title: isAr ? "تم الحفظ" : "Saved" }); },
  });

  const updateComp = useMutation({
    mutationFn: ({ id, ...body }: Record<string, unknown>) => updateHrPayrollComponent(Number(id), body),
    onSuccess: () => { void invalidateComps(); setEditingComponent(null); toast({ title: isAr ? "تم التحديث" : "Updated" }); },
  });

  const deleteComp = useMutation({
    mutationFn: (id: number) => deleteHrPayrollComponent(id),
    onSuccess: () => { void invalidateComps(); toast({ title: isAr ? "تم الحذف" : "Deleted" }); },
  });

  const createStruct = useMutation({
    mutationFn: (body: Record<string, unknown>) => createHrPayrollStructure(body),
    onSuccess: () => { void invalidateStructs(); setNewStructureOpen(false); toast({ title: isAr ? "تم الحفظ" : "Saved" }); },
  });

  const createBand = useMutation({
    mutationFn: (body: Record<string, unknown>) => createHrPayrollBand(body),
    onSuccess: () => { void invalidateBands(); setNewBandOpen(false); setEditingBand(null); toast({ title: isAr ? "تم الحفظ" : "Saved" }); },
  });

  const updateBand = useMutation({
    mutationFn: ({ id, ...body }: Record<string, unknown>) => updateHrPayrollBand(Number(id), body),
    onSuccess: () => { void invalidateBands(); setEditingBand(null); toast({ title: isAr ? "تم التحديث" : "Updated" }); },
  });

  const deleteBand = useMutation({
    mutationFn: (id: number) => deleteHrPayrollBand(id),
    onSuccess: () => { void invalidateBands(); },
  });

  const legacyRuns = (runsQ.data ?? []) as PayrollRecord[];
  const canonicalRuns = (canonicalRunsQ.data ?? []) as PayrollRecord[];
  const periods = (periodsQ.data ?? []) as PayrollRecord[];
  const runs = useCanonicalPayroll ? canonicalRuns : legacyRuns;
  const runsLoading = useCanonicalPayroll ? canonicalRunsQ.isLoading : runsQ.isLoading;
  const comps   = (compsQ.data   ?? []) as PayrollRecord[];
  const structs = (structsQ.data ?? []) as PayrollRecord[];
  const bands   = (bandsQ.data   ?? []) as PayrollRecord[];
  const grades  = (gradesQ.data  ?? []) as PayrollRecord[];

  const totalNetPaid = useCanonicalPayroll
    ? runs.filter((r) => r.status === "locked").reduce((s, r) => s + (parseFloat(String(r.netAmount ?? r.totalNet)) || 0), 0)
    : runs.filter((r) => r.status === "paid").reduce((s, r) => s + (parseFloat(String(r.totalNet)) || 0), 0);
  const pendingRuns = useCanonicalPayroll
    ? runs.filter((r) => ["draft", "calculating", "review"].includes(String(r.status)))
    : runs.filter((r) => ["draft", "processing"].includes(String(r.status)));

  const compFormData = editingComponent ?? compForm;
  const bandFormData = editingBand ?? bandForm;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6" dir={isAr ? "rtl" : "ltr"}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("hr_payroll_title")}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{t("hr_payroll_subtitle")}</p>
        </div>
        <div className="flex gap-2">
          {useCanonicalPayroll && (
            <Link href={`${BASE}/admin/hr/payroll-ops`}>
              <Button variant="outline" size="sm">{isAr ? "مركز العمليات" : "Ops Center"}</Button>
            </Link>
          )}
          <Link href={`${BASE}/hr`}>
            <Button variant="outline" size="sm">{t("hr_payroll_hub")}</Button>
          </Link>
        </div>
      </div>

      {useCanonicalPayroll && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>{isAr ? "مسيرات الرواتب — النموذج المعياري" : "Payroll runs — canonical mode"}</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>
              {isAr
                ? "إنشاء ومعالجة المسيرات عبر واجهات payroll canonical. مسارات hr_payroll_runs القديمة للقراءة فقط."
                : "Create and process runs via canonical payroll APIs. Legacy hr_payroll_runs are read-only."}
            </p>
            <Link href={`${BASE}/admin/hr/payroll-ops`} className="inline-flex items-center gap-1 text-sm font-medium hover:underline">
              {isAr ? "فتح مركز عمليات الرواتب" : "Open payroll operations center"}
              <ArrowRight className="w-3 h-3" />
            </Link>
          </AlertDescription>
        </Alert>
      )}

      {legacyRunsReadOnly && !useCanonicalPayroll && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>{isAr ? "مسيرات legacy مجمدة" : "Legacy payroll runs frozen"}</AlertTitle>
          <AlertDescription>
            {isAr
              ? "تفعيل PAYROLL_CANONICAL_WRITE لاستخدام المسيرات المعيارية."
              : "Enable PAYROLL_CANONICAL_WRITE to use canonical payroll runs."}
          </AlertDescription>
        </Alert>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { icon: Wallet,    label: isAr ? (useCanonicalPayroll ? "مسيرات مقفلة" : "مسيرات مدفوعة") : (useCanonicalPayroll ? "Locked Runs" : "Paid Runs"), value: runs.filter((r) => r.status === (useCanonicalPayroll ? "locked" : "paid")).length, color: "bg-violet-50 text-violet-600 dark:bg-violet-950" },
          { icon: RefreshCw, label: isAr ? "مسيرات معلقة" : "Pending Runs",  value: pendingRuns.length,                                color: "bg-amber-50 text-amber-600 dark:bg-amber-950" },
          { icon: Layers,    label: isAr ? "هياكل الراتب" : "Structures",     value: structs.length,                                    color: "bg-blue-50 text-blue-600 dark:bg-blue-950" },
          { icon: Sliders,   label: isAr ? "مكونات الراتب" : "Components",    value: comps.length,                                      color: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950" },
        ].map(({ icon: Icon, label, value, color }) => (
          <Card key={label} className="hover:shadow-md transition-shadow">
            <CardContent className="p-4 flex items-center gap-3">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${color}`}>
                <Icon className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="text-xl font-bold">{value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="runs">{t("hr_payroll_tab_runs")}</TabsTrigger>
          <TabsTrigger value="structures">{t("hr_payroll_tab_structures")}</TabsTrigger>
          <TabsTrigger value="components">{t("hr_payroll_tab_components")}</TabsTrigger>
          <TabsTrigger value="bands">{t("hr_payroll_tab_bands")}</TabsTrigger>
        </TabsList>

        {/* ── RUNS ───────────────────────────────────────────────── */}
        <TabsContent value="runs" className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-muted-foreground">{isAr ? `${runs.length} مسيرة` : `${runs.length} runs`}</p>
            <Button
              onClick={() => setNewRunOpen(true)}
              size="sm"
              disabled={legacyRunsReadOnly && !useCanonicalPayroll}
            >
              <Plus className="w-4 h-4 me-1" />{t("hr_payroll_new_run")}
            </Button>
          </div>
          {runsLoading ? (
            <div className="space-y-2">{[1,2,3].map((i) => <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />)}</div>
          ) : runs.length === 0 ? (
            <Card><CardContent className="p-8 text-center text-muted-foreground"><DollarSign className="w-10 h-10 mx-auto mb-2 opacity-30" /><p>{t("hr_payroll_no_runs")}</p></CardContent></Card>
          ) : (
            <div className="space-y-2">
              {runs.map((run) => {
                const statusCfg = useCanonicalPayroll
                  ? (CANONICAL_RUN_STATUS_CONFIG[String(run.status)] ?? CANONICAL_RUN_STATUS_CONFIG.draft)
                  : (RUN_STATUS_CONFIG[String(run.status)] ?? RUN_STATUS_CONFIG.draft);
                const monthIdx = Number(run.periodMonth) - 1;
                const monthName = run.periodMonth
                  ? (isAr ? MONTH_NAMES_AR[monthIdx] : MONTH_NAMES[monthIdx])
                  : null;
                const title = useCanonicalPayroll
                  ? String(run.periodLabel ?? `Period #${run.periodId ?? "?"}`)
                  : `${monthName} ${run.periodYear}`;
                const runHref = useCanonicalPayroll
                  ? `${BASE}/admin/hr/payroll/runs/${run.id}?canonical=1`
                  : `${BASE}/admin/hr/payroll/runs/${run.id}`;
                const netVal = useCanonicalPayroll ? run.netAmount ?? run.grossAmount : run.totalNet;
                return (
                  <Card key={String(run.id)} className="hover:shadow-sm transition-shadow">
                    <CardContent className="p-4 flex items-center gap-4">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center bg-primary/10`}>
                        <BarChart3 className="w-5 h-5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium">{title}</p>
                          <Badge className={statusCfg.color}>{isAr ? statusCfg.labelAr : statusCfg.label}</Badge>
                          {useCanonicalPayroll && run.runType && (
                            <Badge variant="outline" className="text-xs">{String(run.runType)}</Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {isAr ? "صافي:" : "Net:"} {fmtCurrency(netVal as string, String(run.currencyCode ?? "SAR"))}
                          {run.employeeCount != null && (
                            <>{" · "}{run.employeeCount} {isAr ? "موظف" : "employees"}</>
                          )}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {useCanonicalPayroll ? (
                          <>
                            {run.status === "draft" && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => calculateCanonicalRun.mutate({ id: Number(run.id) })}
                                disabled={calculateCanonicalRun.isPending}
                              >
                                <Play className="w-4 h-4 me-1" />{t("hr_payroll_process")}
                              </Button>
                            )}
                          </>
                        ) : (
                          <>
                            {run.status === "draft" && !legacyRunsReadOnly && (
                              <Button size="sm" variant="outline" onClick={() => processRun.mutate(Number(run.id))} disabled={processRun.isPending}>
                                <Play className="w-4 h-4 me-1" />{t("hr_payroll_process")}
                              </Button>
                            )}
                            {run.status === "processing" && !legacyRunsReadOnly && (
                              <Button size="sm" variant="outline" onClick={() => updateRunStatus.mutate({ id: Number(run.id), status: "approved" })}>
                                <CheckCircle2 className="w-4 h-4 me-1" />{t("hr_payroll_approve")}
                              </Button>
                            )}
                            {run.status === "approved" && !legacyRunsReadOnly && (
                              <Button size="sm" onClick={() => updateRunStatus.mutate({ id: Number(run.id), status: "paid" })}>
                                <Wallet className="w-4 h-4 me-1" />{t("hr_payroll_mark_paid")}
                              </Button>
                            )}
                          </>
                        )}
                        <Link href={runHref}>
                          <Button size="sm" variant="ghost"><ChevronRight className="w-4 h-4" /></Button>
                        </Link>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* Remaining tabs: structures, components, bands — unchanged UI, codegen-backed mutations */}
        <TabsContent value="structures" className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-muted-foreground">{structs.length} {isAr ? "هيكل" : "structures"}</p>
            <Button size="sm" onClick={() => setNewStructureOpen(true)}><Plus className="w-4 h-4 me-1" />{isAr ? "هيكل جديد" : "New Structure"}</Button>
          </div>
          {structsQ.isLoading ? (
            <div className="h-24 bg-muted animate-pulse rounded-lg" />
          ) : structs.length === 0 ? (
            <Card><CardContent className="p-6 text-center text-muted-foreground">{isAr ? "لا توجد هياكل" : "No structures yet"}</CardContent></Card>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {structs.map((s) => (
                <Card key={String(s.id)}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">{String(s.name)}</CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm text-muted-foreground">
                    {s.description ? String(s.description) : (isAr ? "بدون وصف" : "No description")}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="components" className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-muted-foreground">{comps.length} {isAr ? "مكون" : "components"}</p>
            <Button size="sm" onClick={() => { setEditingComponent(null); setNewComponentOpen(true); }}><Plus className="w-4 h-4 me-1" />{isAr ? "مكون جديد" : "New Component"}</Button>
          </div>
          {compsQ.isLoading ? (
            <div className="h-24 bg-muted animate-pulse rounded-lg" />
          ) : (
            <div className="space-y-2">
              {comps.map((c) => {
                const typeCfg = COMP_TYPE_CONFIG[String(c.componentType)] ?? COMP_TYPE_CONFIG.allowance;
                return (
                  <Card key={String(c.id)}>
                    <CardContent className="p-4 flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium">{String(c.name)}</p>
                        <Badge className={`mt-1 ${typeCfg.color}`}>{isAr ? typeCfg.labelAr : typeCfg.label}</Badge>
                      </div>
                      <div className="flex gap-2">
                        <Button size="icon" variant="ghost" onClick={() => setEditingComponent(c)}><Pencil className="w-4 h-4" /></Button>
                        <Button size="icon" variant="ghost" onClick={() => deleteComp.mutate(Number(c.id))}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="bands" className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-muted-foreground">{bands.length} {isAr ? "نطاق" : "bands"}</p>
            <Button size="sm" onClick={() => { setEditingBand(null); setNewBandOpen(true); }}><Plus className="w-4 h-4 me-1" />{isAr ? "نطاق جديد" : "New Band"}</Button>
          </div>
          {bandsQ.isLoading ? (
            <div className="h-24 bg-muted animate-pulse rounded-lg" />
          ) : (
            <div className="space-y-2">
              {bands.map((b) => (
                <Card key={String(b.id)}>
                  <CardContent className="p-4 flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium">{String(b.name)}</p>
                      <p className="text-xs text-muted-foreground">
                        {fmtCurrency(b.minAmount as string)} – {fmtCurrency(b.maxAmount as string)}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button size="icon" variant="ghost" onClick={() => setEditingBand(b)}><Pencil className="w-4 h-4" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => deleteBand.mutate(Number(b.id))}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* New run dialog */}
      <Dialog open={newRunOpen} onOpenChange={setNewRunOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{isAr ? "مسيرة رواتب جديدة" : "New Payroll Run"}</DialogTitle></DialogHeader>
          {useCanonicalPayroll ? (
            <div className="space-y-3 py-2">
              <div>
                <Label>{isAr ? "فترة الرواتب" : "Payroll period"}</Label>
                <Select value={canonicalPeriodId} onValueChange={setCanonicalPeriodId}>
                  <SelectTrigger><SelectValue placeholder={isAr ? "اختر الفترة" : "Select period"} /></SelectTrigger>
                  <SelectContent>
                    {periods.map((p) => (
                      <SelectItem key={String(p.id)} value={String(p.id)}>
                        {String(p.periodLabel ?? p.id)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {periods.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  {isAr ? "أنشئ فترة من مركز العمليات أو API canonical periods." : "Create a period via ops center or canonical periods API."}
                </p>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 py-2">
              <div><Label>{isAr ? "السنة" : "Year"}</Label><Input value={runForm.periodYear} onChange={(e) => setRunForm(f => ({ ...f, periodYear: e.target.value }))} /></div>
              <div><Label>{isAr ? "الشهر" : "Month"}</Label><Input type="number" min={1} max={12} value={runForm.periodMonth} onChange={(e) => setRunForm(f => ({ ...f, periodMonth: e.target.value }))} /></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewRunOpen(false)}>{isAr ? "إلغاء" : "Cancel"}</Button>
            {useCanonicalPayroll ? (
              <Button
                onClick={() => createCanonicalRun.mutate({ data: { periodId: Number(canonicalPeriodId) } })}
                disabled={createCanonicalRun.isPending || !canonicalPeriodId}
              >
                {isAr ? "إنشاء" : "Create"}
              </Button>
            ) : (
              <Button onClick={() => createRun.mutate({ ...runForm, periodYear: Number(runForm.periodYear), periodMonth: Number(runForm.periodMonth) })} disabled={createRun.isPending}>
                {isAr ? "إنشاء" : "Create"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Component dialog */}
      <Dialog open={newComponentOpen || !!editingComponent} onOpenChange={(v) => { if (!v) { setNewComponentOpen(false); setEditingComponent(null); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingComponent ? (isAr ? "تعديل مكون" : "Edit Component") : (isAr ? "مكون جديد" : "New Component")}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div><Label>{isAr ? "الاسم" : "Name"}</Label><Input value={String(compFormData.name ?? "")} onChange={(e) => editingComponent ? setEditingComponent({ ...editingComponent, name: e.target.value }) : setCompForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div><Label>{isAr ? "النوع" : "Type"}</Label>
              <Select value={String(compFormData.componentType ?? "allowance")} onValueChange={(v) => editingComponent ? setEditingComponent({ ...editingComponent, componentType: v }) : setCompForm(f => ({ ...f, componentType: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{Object.keys(COMP_TYPE_CONFIG).map(k => <SelectItem key={k} value={k}>{k}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => {
              const payload = { ...compFormData, defaultValue: compFormData.defaultValue || "0" };
              if (editingComponent) updateComp.mutate(payload);
              else createComp.mutate(payload);
            }}>{isAr ? "حفظ" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Structure dialog */}
      <Dialog open={newStructureOpen} onOpenChange={setNewStructureOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{isAr ? "هيكل راتب جديد" : "New Salary Structure"}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div><Label>{isAr ? "الاسم" : "Name"}</Label><Input value={structForm.name} onChange={(e) => setStructForm(f => ({ ...f, name: e.target.value }))} /></div>
          </div>
          <DialogFooter>
            <Button onClick={() => createStruct.mutate(structForm)}>{isAr ? "حفظ" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Band dialog */}
      <Dialog open={newBandOpen || !!editingBand} onOpenChange={(v) => { if (!v) { setNewBandOpen(false); setEditingBand(null); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingBand ? (isAr ? "تعديل نطاق" : "Edit Band") : (isAr ? "نطاق جديد" : "New Band")}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div><Label>{isAr ? "الاسم" : "Name"}</Label><Input value={String(bandFormData.name ?? "")} onChange={(e) => editingBand ? setEditingBand({ ...editingBand, name: e.target.value }) : setBandForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div className="grid grid-cols-3 gap-2">
              <div><Label>Min</Label><Input value={String(bandFormData.minAmount ?? "")} onChange={(e) => editingBand ? setEditingBand({ ...editingBand, minAmount: e.target.value }) : setBandForm(f => ({ ...f, minAmount: e.target.value }))} /></div>
              <div><Label>Mid</Label><Input value={String(bandFormData.midpointAmount ?? "")} onChange={(e) => editingBand ? setEditingBand({ ...editingBand, midpointAmount: e.target.value }) : setBandForm(f => ({ ...f, midpointAmount: e.target.value }))} /></div>
              <div><Label>Max</Label><Input value={String(bandFormData.maxAmount ?? "")} onChange={(e) => editingBand ? setEditingBand({ ...editingBand, maxAmount: e.target.value }) : setBandForm(f => ({ ...f, maxAmount: e.target.value }))} /></div>
            </div>
            {grades.length > 0 && (
              <div><Label>{isAr ? "الدرجة" : "Grade"}</Label>
                <Select value={String(bandFormData.gradeId ?? "__none__")} onValueChange={(v) => editingBand ? setEditingBand({ ...editingBand, gradeId: v === "__none__" ? null : Number(v) }) : setBandForm(f => ({ ...f, gradeId: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">{isAr ? "بدون" : "None"}</SelectItem>
                    {grades.map((g) => <SelectItem key={String(g.id)} value={String(g.id)}>{String(g.name)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => {
              const payload = { ...bandFormData, gradeId: bandFormData.gradeId === "__none__" ? null : bandFormData.gradeId };
              if (editingBand) updateBand.mutate(payload);
              else createBand.mutate(payload);
            }}>{isAr ? "حفظ" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {totalNetPaid > 0 && (
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <TrendingUp className="w-3 h-3" />
          {isAr ? `إجمالي المدفوع: ${fmtCurrency(totalNetPaid)}` : `Total paid: ${fmtCurrency(totalNetPaid)}`}
        </p>
      )}
    </div>
  );
}
