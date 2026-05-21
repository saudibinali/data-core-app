import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  FileText,
  Download,
  RefreshCw,
  PlusCircle,
  CalendarClock,
  Palette,
  FolderOpen,
  AlertCircle,
  ShieldOff,
  Search,
} from "lucide-react";
import { usePermissions } from "@/hooks/use-permissions";
import {
  canViewReportCenter,
  canManageReportCenter,
  REPORT_DEFINITION_LABELS,
} from "@/lib/report-center-config";
import {
  useReportDefinitions,
  useGeneratedReports,
  useExportJobs,
  useCreateExportJob,
  useDownloadGeneratedReport,
  useScheduledReports,
  useCreateSchedule,
  useToggleSchedule,
  useReportBranding,
  useUpdateBranding,
} from "@/hooks/use-report-center";
import { ReportStatusBadge, FormatBadge } from "@/components/reports/report-status-badge";
import { EntityDocumentsPanel } from "@/components/documents/entity-documents-panel";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

function defLabel(key: string, isAr: boolean): string {
  const L = REPORT_DEFINITION_LABELS[key];
  if (L) return isAr ? L.ar : L.en;
  return key;
}

function AccessDenied({ isAr }: { isAr: boolean }) {
  return (
    <div
      className="flex flex-col items-center justify-center py-16 text-center"
      data-testid="report-center-access-denied"
    >
      <ShieldOff className="w-12 h-12 text-muted-foreground mb-4" />
      <p className="text-lg font-medium">{isAr ? "غير مصرح" : "Access denied"}</p>
      <p className="text-sm text-muted-foreground mt-1">
        {isAr
          ? "تحتاج صلاحية hr.manage أو reports.view"
          : "You need hr.manage or reports.view permission"}
      </p>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <p className="text-sm text-muted-foreground py-8 text-center" data-testid="report-center-empty">
      {message}
    </p>
  );
}

function ErrorPanel({ message }: { message: string }) {
  return (
    <div
      className="flex items-center gap-2 text-destructive text-sm p-4 border border-destructive/30 rounded-lg"
      role="alert"
      data-testid="report-center-error"
    >
      <AlertCircle className="w-4 h-4 shrink-0" />
      {message}
    </div>
  );
}

export default function ReportCenterPage() {
  const { i18n } = useTranslation();
  const isAr = i18n.language.startsWith("ar");
  const { hasPermission, userRole, isLoading: permLoading } = usePermissions();
  const canView = canViewReportCenter(hasPermission);
  const canManage = canManageReportCenter(hasPermission);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [formatFilter, setFormatFilter] = useState("all");
  const [mineOnly, setMineOnly] = useState(false);

  const defsQ = useReportDefinitions(canView);
  const genQ = useGeneratedReports(mineOnly, canView);
  const jobsQ = useExportJobs(canView);
  const schedQ = useScheduledReports(canManage);
  const brandingQ = useReportBranding(canView);

  const createExport = useCreateExportJob();
  const downloadReport = useDownloadGeneratedReport();
  const createSchedule = useCreateSchedule();
  const toggleSchedule = useToggleSchedule();
  const updateBranding = useUpdateBranding();

  const [createKey, setCreateKey] = useState("hr.employees.roster");
  const [createFormat, setCreateFormat] = useState("pdf");
  const [createDateFrom, setCreateDateFrom] = useState("");
  const [createDateTo, setCreateDateTo] = useState("");
  const [createYear, setCreateYear] = useState("");
  const [activeJobId, setActiveJobId] = useState<number | null>(null);

  const [schedKey, setSchedKey] = useState("hr.employees.roster");
  const [schedFormat, setSchedFormat] = useState("pdf");
  const [schedCron, setSchedCron] = useState("0 8 * * *");
  const [schedTz, setSchedTz] = useState("UTC");
  const [schedEmail, setSchedEmail] = useState("");

  const [brandName, setBrandName] = useState("");
  const [brandLogo, setBrandLogo] = useState("");
  const [brandColor, setBrandColor] = useState("#1e40af");
  const [brandFooter, setBrandFooter] = useState("");

  const selectedDef = defsQ.data?.find((d) => d.key === createKey);
  const formats = selectedDef?.supportedFormats ?? ["pdf", "xlsx", "csv"];

  const filteredReports = useMemo(() => {
    let rows = genQ.data ?? [];
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (r) =>
          r.reportDefinitionKey.toLowerCase().includes(q) ||
          (r.fileName ?? "").toLowerCase().includes(q),
      );
    }
    if (statusFilter !== "all") rows = rows.filter((r) => r.status === statusFilter);
    if (formatFilter !== "all") rows = rows.filter((r) => r.format === formatFilter);
    return rows;
  }, [genQ.data, search, statusFilter, formatFilter]);

  const filteredJobs = useMemo(() => {
    let rows = jobsQ.data ?? [];
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (j) => (j.reportDefinitionKey ?? "").toLowerCase().includes(q) || String(j.id).includes(q),
      );
    }
    if (statusFilter !== "all") rows = rows.filter((j) => j.status === statusFilter);
    return rows;
  }, [jobsQ.data, search, statusFilter]);

  if (permLoading) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <Skeleton className="h-10 w-64 mb-4" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!userRole || !canView) return <AccessDenied isAr={isAr} />;

  const handleCreateExport = async () => {
    const parameters: Record<string, string> = {};
    if (createKey === "hr.attendance.period") {
      if (createDateFrom) parameters.dateFrom = createDateFrom;
      if (createDateTo) parameters.dateTo = createDateTo;
    }
    if (createKey === "hr.leave.balances" && createYear) parameters.year = createYear;

    try {
      const res = await createExport.mutateAsync({
        reportDefinitionKey: createKey,
        format: createFormat,
        parameters,
      });
      setActiveJobId(res.job.id);
    } catch {
      /* mutation error surfaced in UI */
    }
  };

  const handleRetryJob = async (job: {
    reportDefinitionKey: string | null;
    format: string | null;
    lastError: string | null;
  }) => {
    if (!job.reportDefinitionKey || !job.format) return;
    await createExport.mutateAsync({
      reportDefinitionKey: job.reportDefinitionKey,
      format: job.format,
      parameters: {},
    });
  };

  const handleSaveBranding = () => {
    updateBranding.mutate({
      displayName: brandName || undefined,
      logoUrl: brandLogo || undefined,
      primaryColor: brandColor,
      footerText: brandFooter || undefined,
    });
  };

  useEffect(() => {
    if (!brandingQ.data) return;
    setBrandName(brandingQ.data.displayName);
    setBrandLogo(brandingQ.data.logoUrl ?? "");
    setBrandColor(brandingQ.data.primaryColor);
    setBrandFooter(brandingQ.data.footerText ?? "");
  }, [brandingQ.data]);

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto w-full" data-testid="report-center-page">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <FileText className="w-7 h-7 text-primary" />
          {isAr ? "مركز التقارير" : "Report Center"}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {isAr
            ? "التقارير المُنشأة، مهام التصدير، الجداول، والمستندات"
            : "Generated reports, export jobs, schedules, and documents"}
        </p>
      </div>

      <Card className="mb-4">
        <CardContent className="pt-4 flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder={isAr ? "بحث..." : "Search reports..."}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="report-center-search"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[140px]" data-testid="report-center-status-filter">
              <SelectValue placeholder={isAr ? "الحالة" : "Status"} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{isAr ? "كل الحالات" : "All statuses"}</SelectItem>
              <SelectItem value="pending">pending</SelectItem>
              <SelectItem value="processing">processing</SelectItem>
              <SelectItem value="completed">completed</SelectItem>
              <SelectItem value="failed">failed</SelectItem>
            </SelectContent>
          </Select>
          <Select value={formatFilter} onValueChange={setFormatFilter}>
            <SelectTrigger className="w-[120px]">
              <SelectValue placeholder={isAr ? "الصيغة" : "Format"} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{isAr ? "الكل" : "All"}</SelectItem>
              <SelectItem value="pdf">PDF</SelectItem>
              <SelectItem value="xlsx">Excel</SelectItem>
              <SelectItem value="csv">CSV</SelectItem>
            </SelectContent>
          </Select>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={mineOnly} onCheckedChange={setMineOnly} />
            {isAr ? "تقاريري فقط" : "My reports only"}
          </label>
        </CardContent>
      </Card>

      <Tabs defaultValue="reports" className="space-y-4">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="reports" data-testid="tab-reports">
            {isAr ? "التقارير" : "Reports"}
          </TabsTrigger>
          <TabsTrigger value="jobs" data-testid="tab-jobs">
            {isAr ? "مهام التصدير" : "Export jobs"}
          </TabsTrigger>
          {canManage && (
            <TabsTrigger value="create" data-testid="tab-create">
              {isAr ? "إنشاء" : "Create"}
            </TabsTrigger>
          )}
          {canManage && (
            <TabsTrigger value="schedules" data-testid="tab-schedules">
              {isAr ? "جدولة" : "Schedules"}
            </TabsTrigger>
          )}
          {canManage && (
            <TabsTrigger value="branding" data-testid="tab-branding">
              {isAr ? "الهوية" : "Branding"}
            </TabsTrigger>
          )}
          <TabsTrigger value="documents" data-testid="tab-documents">
            {isAr ? "مستندات" : "Documents"}
          </TabsTrigger>
          <TabsTrigger value="definitions" data-testid="tab-definitions">
            {isAr ? "التعريفات" : "Definitions"}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="reports">
          <Card>
            <CardHeader>
              <CardTitle>{isAr ? "التقارير المُنشأة" : "Generated reports"}</CardTitle>
            </CardHeader>
            <CardContent>
              {genQ.isLoading && <Skeleton className="h-40 w-full" />}
              {genQ.isError && (
                <ErrorPanel
                  message={
                    genQ.error instanceof Error
                      ? genQ.error.message
                      : isAr
                        ? "تعذر تحميل التقارير"
                        : "Failed to load reports"
                  }
                />
              )}
              {!genQ.isLoading && !genQ.isError && filteredReports.length === 0 && (
                <EmptyState
                  message={
                    isAr ? "لا توجد تقارير بعد. أنشئ تصديراً جديداً." : "No reports yet. Create a new export."
                  }
                />
              )}
              <ul className="space-y-2">
                {filteredReports.map((r) => (
                  <li
                    key={r.id}
                    className="flex flex-wrap items-center justify-between gap-2 border rounded-lg p-3"
                    data-testid={`generated-report-row-${r.id}`}
                  >
                    <div>
                      <p className="font-medium text-sm">{defLabel(r.reportDefinitionKey, isAr)}</p>
                      <p className="text-xs text-muted-foreground">
                        #{r.id} · {r.fileName ?? "—"}
                      </p>
                      <div className="flex gap-1 mt-1">
                        <ReportStatusBadge status={r.status} isAr={isAr} />
                        <FormatBadge format={r.format} />
                      </div>
                    </div>
                    {r.status === "completed" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={downloadReport.isPending}
                        data-testid={`report-download-${r.id}`}
                        onClick={() =>
                          downloadReport.mutate({
                            reportId: r.id,
                            fileName: r.fileName ?? `report_${r.id}.${r.format}`,
                          })
                        }
                      >
                        <Download className="w-4 h-4 mr-1" />
                        {isAr ? "تحميل" : "Download"}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="jobs">
          <Card>
            <CardHeader>
              <CardTitle>{isAr ? "مهام التصدير" : "Export jobs"}</CardTitle>
              <CardDescription>
                {isAr
                  ? "يتم تحديث المهام النشطة تلقائياً"
                  : "Active jobs refresh automatically"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {jobsQ.isLoading && <Skeleton className="h-40 w-full" />}
              {jobsQ.isError && <ErrorPanel message={jobsQ.error?.message ?? "Error"} />}
              {!jobsQ.isLoading && filteredJobs.length === 0 && (
                <EmptyState message={isAr ? "لا توجد مهام." : "No export jobs."} />
              )}
              <ul className="space-y-2">
                {filteredJobs.map((j) => (
                  <li
                    key={j.id}
                    className="border rounded-lg p-3"
                    data-testid={`export-job-row-${j.id}`}
                  >
                    <div className="flex flex-wrap justify-between gap-2">
                      <div>
                        <p className="font-medium text-sm">
                          {j.reportDefinitionKey ? defLabel(j.reportDefinitionKey, isAr) : j.id}
                        </p>
                        <div className="flex gap-1 mt-1">
                          <ReportStatusBadge status={j.status} isAr={isAr} />
                          {j.format && <FormatBadge format={j.format} />}
                          <Badge variant="outline">{j.progressPercent}%</Badge>
                        </div>
                        {j.lastError && (
                          <p className="text-xs text-destructive mt-1">{j.lastError}</p>
                        )}
                      </div>
                      <div className="flex gap-2">
                        {j.status === "failed" && canManage && j.reportDefinitionKey && (
                          <Button
                            size="sm"
                            variant="secondary"
                            data-testid={`export-job-retry-${j.id}`}
                            onClick={() => handleRetryJob(j)}
                          >
                            <RefreshCw className="w-4 h-4 mr-1" />
                            {isAr ? "إعادة" : "Retry"}
                          </Button>
                        )}
                        {j.status === "completed" && j.generatedReportId && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              downloadReport.mutate({
                                reportId: j.generatedReportId!,
                                fileName: `report_${j.generatedReportId}.${j.format ?? "pdf"}`,
                              })
                            }
                          >
                            <Download className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </TabsContent>

        {canManage && (
          <TabsContent value="create">
            <Card data-testid="report-create-form">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <PlusCircle className="w-5 h-5" />
                  {isAr ? "إنشاء تقرير" : "Create report"}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 max-w-lg">
                <div className="space-y-1">
                  <Label>{isAr ? "التقرير" : "Report"}</Label>
                  <Select value={createKey} onValueChange={setCreateKey}>
                    <SelectTrigger data-testid="create-report-definition">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(defsQ.data ?? []).map((d) => (
                        <SelectItem key={d.key} value={d.key}>
                          {defLabel(d.key, isAr)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>{isAr ? "الصيغة" : "Format"}</Label>
                  <Select value={createFormat} onValueChange={setCreateFormat}>
                    <SelectTrigger data-testid="create-report-format">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {formats.map((f) => (
                        <SelectItem key={f} value={f}>
                          {f.toUpperCase()}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {createKey === "hr.attendance.period" && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label>{isAr ? "من" : "From"}</Label>
                      <Input type="date" value={createDateFrom} onChange={(e) => setCreateDateFrom(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label>{isAr ? "إلى" : "To"}</Label>
                      <Input type="date" value={createDateTo} onChange={(e) => setCreateDateTo(e.target.value)} />
                    </div>
                  </div>
                )}
                {createKey === "hr.leave.balances" && (
                  <div className="space-y-1">
                    <Label>{isAr ? "السنة" : "Year"}</Label>
                    <Input value={createYear} onChange={(e) => setCreateYear(e.target.value)} placeholder="2026" />
                  </div>
                )}
                <Button
                  onClick={handleCreateExport}
                  disabled={createExport.isPending}
                  data-testid="create-export-submit"
                >
                  {createExport.isPending
                    ? isAr
                      ? "جاري الإرسال..."
                      : "Submitting..."
                    : isAr
                      ? "بدء التصدير"
                      : "Start export"}
                </Button>
                {createExport.isError && (
                  <ErrorPanel
                    message={
                      createExport.error instanceof Error
                        ? createExport.error.message
                        : "Failed"
                    }
                  />
                )}
                {activeJobId && (
                  <p className="text-sm text-muted-foreground">
                    {isAr ? "معرّف المهمة:" : "Job ID:"} {activeJobId} —{" "}
                    {isAr ? "راجع تبويب مهام التصدير للحالة." : "see Export jobs tab for status."}
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {canManage && (
          <TabsContent value="schedules">
            <Card className="mb-4">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CalendarClock className="w-5 h-5" />
                  {isAr ? "جدولة تقرير" : "Schedule report"}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 max-w-lg">
                <Select value={schedKey} onValueChange={setSchedKey}>
                  <SelectTrigger data-testid="schedule-report-definition">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(defsQ.data ?? []).map((d) => (
                      <SelectItem key={d.key} value={d.key}>
                        {defLabel(d.key, isAr)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={schedFormat} onValueChange={setSchedFormat}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pdf">PDF</SelectItem>
                    <SelectItem value="xlsx">Excel</SelectItem>
                    <SelectItem value="csv">CSV</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  value={schedCron}
                  onChange={(e) => setSchedCron(e.target.value)}
                  placeholder="0 8 * * *"
                  data-testid="schedule-cron"
                />
                <Input value={schedTz} onChange={(e) => setSchedTz(e.target.value)} placeholder="UTC" />
                <Input
                  value={schedEmail}
                  onChange={(e) => setSchedEmail(e.target.value)}
                  placeholder={isAr ? "بريد المستلم" : "Recipient email"}
                  data-testid="schedule-recipient-email"
                />
                <Button
                  data-testid="schedule-create-submit"
                  disabled={createSchedule.isPending}
                  onClick={() =>
                    createSchedule.mutate({
                      reportDefinitionKey: schedKey,
                      format: schedFormat,
                      scheduleCron: schedCron,
                      scheduleTimezone: schedTz,
                      recipients: schedEmail ? [{ email: schedEmail }] : [],
                    })
                  }
                >
                  {isAr ? "إنشاء جدولة" : "Create schedule"}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{isAr ? "الجداول النشطة" : "Active schedules"}</CardTitle>
              </CardHeader>
              <CardContent>
                {schedQ.isLoading && <Skeleton className="h-24 w-full" />}
                {(schedQ.data ?? []).map((s) => (
                  <div
                    key={s.id}
                    className="flex justify-between items-center border rounded p-3 mb-2"
                    data-testid={`schedule-row-${s.id}`}
                  >
                    <div>
                      <p className="text-sm font-medium">{defLabel(s.reportDefinitionKey, isAr)}</p>
                      <p className="text-xs text-muted-foreground">
                        {s.scheduleCron} ({s.scheduleTimezone}) · {s.format}
                      </p>
                    </div>
                    <Switch
                      checked={s.enabled}
                      data-testid={`schedule-toggle-${s.id}`}
                      onCheckedChange={(enabled) => toggleSchedule.mutate({ id: s.id, enabled })}
                    />
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {canManage && (
          <TabsContent value="branding">
            <Card data-testid="report-branding-form">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Palette className="w-5 h-5" />
                  {isAr ? "هوية التقارير" : "Report branding"}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 max-w-lg">
                {brandingQ.isLoading && <Skeleton className="h-8 w-full" />}
                <div className="space-y-1">
                  <Label>{isAr ? "اسم العرض" : "Display name"}</Label>
                  <Input value={brandName} onChange={(e) => setBrandName(e.target.value)} data-testid="branding-display-name" />
                </div>
                <div className="space-y-1">
                  <Label>{isAr ? "رابط الشعار" : "Logo URL"}</Label>
                  <Input value={brandLogo} onChange={(e) => setBrandLogo(e.target.value)} data-testid="branding-logo-url" />
                </div>
                <div className="space-y-1">
                  <Label>{isAr ? "اللون الأساسي" : "Primary color"}</Label>
                  <Input type="color" value={brandColor} onChange={(e) => setBrandColor(e.target.value)} data-testid="branding-primary-color" />
                </div>
                <div className="space-y-1">
                  <Label>{isAr ? "نص التذييل" : "Footer text"}</Label>
                  <Input value={brandFooter} onChange={(e) => setBrandFooter(e.target.value)} data-testid="branding-footer-text" />
                </div>
                <Button onClick={handleSaveBranding} disabled={updateBranding.isPending} data-testid="branding-save">
                  {isAr ? "حفظ" : "Save"}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        <TabsContent value="documents">
          <EntityDocumentsPanel isAr={isAr} />
        </TabsContent>

        <TabsContent value="definitions">
          <Card>
            <CardHeader>
              <CardTitle>{isAr ? "تعريفات التقارير" : "Report definitions"}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {(defsQ.data ?? []).map((d) => (
                  <li key={d.key} className="border rounded p-3 text-sm" data-testid={`definition-${d.key}`}>
                    <p className="font-medium">{defLabel(d.key, isAr)}</p>
                    <p className="text-muted-foreground text-xs">{d.key}</p>
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {d.supportedFormats.map((f) => (
                        <FormatBadge key={f} format={f} />
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Card className="mt-6 border-dashed">
        <CardContent className="pt-4 text-sm text-muted-foreground flex items-start gap-2">
          <FolderOpen className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            {isAr
              ? "إشعارات التصدير الجاهز/الفاشل تظهر في مركز الإشعارات مع رابط للتحميل الآمن."
              : "Export ready/failed notifications appear in Notifications with a secure download link."}
          </span>
        </CardContent>
      </Card>
    </div>
  );
}
