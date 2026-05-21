/**
 * P21-D — Payroll Operations Center
 */
import { useState } from "react";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Activity,
  AlertTriangle,
  DollarSign,
  FileWarning,
  Lock,
  RefreshCw,
  Download,
  ChevronRight,
} from "lucide-react";
import { apiClient } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

const POLL_MS = 30_000;

type Overview = {
  runMetrics: { total: number; byStatus: Record<string, number>; excludedEmployees: number };
  reviewQueue: Array<{
    run: { id: number; status: string; runType: string };
    periodLabel: string;
    warningCount: number;
    excludedCount: number;
  }>;
  lockedPeriods: unknown[];
  correctionRuns: unknown[];
  exportReadiness: {
    glMappingComplete: boolean;
    componentsMissingGl: number;
    bankExportReady: boolean;
    message: string;
  };
  openExceptions: number;
  alerts: Array<{ code: string; severity: string; title: string; message: string }>;
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "secondary",
  calculating: "outline",
  review: "default",
  approved: "default",
  locked: "default",
  open: "destructive",
  acknowledged: "outline",
  resolved: "secondary",
};

function severityClass(s: string) {
  if (s === "critical") return "border-red-500/50 bg-red-500/5";
  if (s === "warning") return "border-amber-500/50 bg-amber-500/5";
  return "border-border";
}

export default function HrPayrollOpsPage() {
  const { i18n } = useTranslation();
  const isAr = i18n.language.startsWith("ar");
  const { toast } = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState("overview");
  const [runStatusFilter, setRunStatusFilter] = useState("");

  const overviewQ = useQuery({
    queryKey: ["/hr/payroll/ops/overview"],
    queryFn: () => apiClient.get<Overview>("/api/hr/payroll/ops/overview").then((r) => r.data),
    refetchInterval: POLL_MS,
  });

  const runsQ = useQuery({
    queryKey: ["/hr/payroll/ops/runs", runStatusFilter],
    queryFn: () =>
      apiClient
        .get<Array<{ run: { id: number; status: string; runType: string }; periodLabel: string }>>(
          `/api/hr/payroll/ops/runs${runStatusFilter ? `?status=${runStatusFilter}` : ""}`,
        )
        .then((r) => r.data),
    enabled: tab === "runs",
    refetchInterval: POLL_MS,
  });

  const exceptionsQ = useQuery({
    queryKey: ["/hr/payroll/ops/exceptions"],
    queryFn: () =>
      apiClient
        .get<Array<{ ex: { id: number; exceptionCode: string; severity: string; status: string; message: string; runId: number | null }; employeeName: string | null }>>(
          "/api/hr/payroll/ops/exceptions?status=open",
        )
        .then((r) => r.data),
    enabled: tab === "exceptions",
    refetchInterval: POLL_MS,
  });

  const auditQ = useQuery({
    queryKey: ["/hr/payroll/ops/audit/logs"],
    queryFn: () =>
      apiClient.get<Record<string, unknown>[]>("/api/hr/payroll/ops/audit/logs?limit=100").then((r) => r.data),
    enabled: tab === "audit",
  });

  const payslipsQ = useQuery({
    queryKey: ["/hr/payroll/ops/audit/payslips"],
    queryFn: () =>
      apiClient.get<Record<string, unknown>[]>("/api/hr/payroll/ops/audit/payslips").then((r) => r.data),
    enabled: tab === "payslips",
  });

  const resolveEx = useMutation({
    mutationFn: (id: number) =>
      apiClient.post(`/api/hr/payroll/ops/exceptions/${id}/resolve`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/hr/payroll/ops/exceptions"] });
      qc.invalidateQueries({ queryKey: ["/hr/payroll/ops/overview"] });
      toast({ title: isAr ? "تم الحل" : "Resolved" });
    },
  });

  const ov = overviewQ.data;

  return (
    <motion.div className="space-y-6 p-4 md:p-6 max-w-7xl mx-auto">
      <motion.div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <motion.div>
          <h1 className="text-2xl font-bold tracking-tight">
            {isAr ? "مركز عمليات الرواتب" : "Payroll Operations Center"}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {isAr
              ? "حوكمة الرواتب، المراجعة، الاستثناءات، وجاهزية التصدير المالي"
              : "Governance, review queues, exceptions, and financial export readiness"}
          </p>
        </motion.div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => overviewQ.refetch()}>
            <RefreshCw className="w-4 h-4 mr-2" />
            {isAr ? "تحديث" : "Refresh"}
          </Button>
          <Link href="/admin/hr/payroll">
            <Button variant="secondary" size="sm">
              <DollarSign className="w-4 h-4 mr-2" />
              {isAr ? "الرواتب" : "Payroll"}
            </Button>
          </Link>
        </div>
      </motion.div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="overview">{isAr ? "نظرة عامة" : "Overview"}</TabsTrigger>
          <TabsTrigger value="runs">{isAr ? "التشغيلات" : "Runs"}</TabsTrigger>
          <TabsTrigger value="exceptions">{isAr ? "الاستثناءات" : "Exceptions"}</TabsTrigger>
          <TabsTrigger value="export">{isAr ? "التصدير" : "Export"}</TabsTrigger>
          <TabsTrigger value="audit">{isAr ? "التدقيق" : "Audit"}</TabsTrigger>
          <TabsTrigger value="payslips">{isAr ? "كشوف الرواتب" : "Payslips"}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4 mt-4">
          {overviewQ.isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : ov ? (
            <>
              <motion.div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>{isAr ? "إجمالي التشغيلات" : "Total runs"}</CardDescription>
                    <CardTitle className="text-2xl">{ov.runMetrics.total}</CardTitle>
                  </CardHeader>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>{isAr ? "في المراجعة" : "In review"}</CardDescription>
                    <CardTitle className="text-2xl">{ov.runMetrics.byStatus.review ?? 0}</CardTitle>
                  </CardHeader>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>{isAr ? "استثناءات مفتوحة" : "Open exceptions"}</CardDescription>
                    <CardTitle className="text-2xl text-amber-600">{ov.openExceptions}</CardTitle>
                  </CardHeader>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>{isAr ? "تعيين GL" : "GL mapping"}</CardDescription>
                    <CardTitle className="text-lg">
                      {ov.exportReadiness.glMappingComplete
                        ? isAr
                          ? "مكتمل"
                          : "Complete"
                        : `${ov.exportReadiness.componentsMissingGl} ${isAr ? "ناقص" : "missing"}`}
                    </CardTitle>
                  </CardHeader>
                </Card>
              </motion.div>

              {ov.alerts.length > 0 && (
                <div className="space-y-2">
                  {ov.alerts.map((a) => (
                    <div
                      key={a.code}
                      className={cn("rounded-lg border p-3 flex gap-3", severityClass(a.severity))}
                    >
                      <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-medium text-sm">{a.title}</p>
                        <p className="text-sm text-muted-foreground">{a.message}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Activity className="w-4 h-4" />
                    {isAr ? "قائمة المراجعة" : "Review queue"}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {ov.reviewQueue.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {isAr ? "لا توجد تشغيلات قيد المراجعة" : "No runs in review"}
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{isAr ? "الفترة" : "Period"}</TableHead>
                          <TableHead>{isAr ? "الحالة" : "Status"}</TableHead>
                          <TableHead>{isAr ? "تحذيرات" : "Warnings"}</TableHead>
                          <TableHead />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {ov.reviewQueue.map((r) => (
                          <TableRow key={r.run.id}>
                            <TableCell>{r.periodLabel}</TableCell>
                            <TableCell>
                              <Badge variant={STATUS_VARIANT[r.run.status] ?? "outline"}>
                                {r.run.status}
                              </Badge>
                            </TableCell>
                            <TableCell>{r.warningCount}</TableCell>
                            <TableCell>
                              <Link href={`/admin/hr/payroll/runs/${r.run.id}`}>
                                <Button variant="ghost" size="sm">
                                  <ChevronRight className="w-4 h-4" />
                                </Button>
                              </Link>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Lock className="w-4 h-4" />
                    {isAr ? "فترات مقفلة" : "Locked periods"}
                  </CardTitle>
                  <CardDescription>{ov.exportReadiness.message}</CardDescription>
                </CardHeader>
              </Card>
            </>
          ) : null}
        </TabsContent>

        <TabsContent value="runs" className="mt-4">
          <div className="flex gap-2 mb-3">
            {["", "review", "approved", "locked"].map((s) => (
              <Button
                key={s || "all"}
                size="sm"
                variant={runStatusFilter === s ? "default" : "outline"}
                onClick={() => setRunStatusFilter(s)}
              >
                {s || (isAr ? "الكل" : "All")}
              </Button>
            ))}
          </div>
          {runsQ.isLoading ? (
            <Skeleton className="h-40" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>{isAr ? "الفترة" : "Period"}</TableHead>
                  <TableHead>{isAr ? "النوع" : "Type"}</TableHead>
                  <TableHead>{isAr ? "الحالة" : "Status"}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(runsQ.data ?? []).map((r) => (
                  <TableRow key={r.run.id}>
                    <TableCell>{r.run.id}</TableCell>
                    <TableCell>{r.periodLabel}</TableCell>
                    <TableCell>{r.run.runType}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[r.run.status] ?? "outline"}>{r.run.status}</Badge>
                    </TableCell>
                    <TableCell>
                      <Link href={`/admin/hr/payroll/runs/${r.run.id}`}>
                        <Button variant="ghost" size="sm">
                          <ChevronRight className="w-4 h-4" />
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>

        <TabsContent value="exceptions" className="mt-4">
          {exceptionsQ.isLoading ? (
            <Skeleton className="h-40" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{isAr ? "الرمز" : "Code"}</TableHead>
                  <TableHead>{isAr ? "الخطورة" : "Severity"}</TableHead>
                  <TableHead>{isAr ? "الرسالة" : "Message"}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(exceptionsQ.data ?? []).map((row) => (
                  <TableRow key={row.ex.id}>
                    <TableCell className="font-mono text-xs">{row.ex.exceptionCode}</TableCell>
                    <TableCell>
                      <Badge variant={row.ex.severity === "critical" ? "destructive" : "outline"}>
                        {row.ex.severity}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-md truncate">{row.ex.message}</TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={resolveEx.isPending}
                        onClick={() => resolveEx.mutate(row.ex.id)}
                      >
                        {isAr ? "حل" : "Resolve"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>

        <TabsContent value="export" className="mt-4 space-y-4">
          {ov && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Download className="w-4 h-4" />
                  {isAr ? "جاهزية التصدير المالي" : "Financial export readiness"}
                </CardTitle>
                <CardDescription>{ov.exportReadiness.message}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>
                  GL:{" "}
                  {ov.exportReadiness.glMappingComplete
                    ? isAr
                      ? "جاهز"
                      : "Ready"
                    : isAr
                      ? "يحتاج تعيين حسابات"
                      : "Needs account mapping"}
                </p>
                <p className="text-muted-foreground">
                  {isAr
                    ? "لا تكامل بنكي ولا ترحيل محاسبي — تجهيز بيانات فقط"
                    : "No bank integration or GL posting — metadata preparation only"}
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="audit" className="mt-4">
          {auditQ.isLoading ? (
            <Skeleton className="h-40" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{isAr ? "الإجراء" : "Action"}</TableHead>
                  <TableHead>{isAr ? "المورد" : "Resource"}</TableHead>
                  <TableHead>{isAr ? "التاريخ" : "Date"}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(auditQ.data ?? []).map((log) => (
                  <TableRow key={String(log.id)}>
                    <TableCell className="font-mono text-xs">{String(log.action)}</TableCell>
                    <TableCell>
                      {String(log.resourceType)}
                      {log.resourceId != null ? ` #${log.resourceId}` : ""}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {log.createdAt ? new Date(String(log.createdAt)).toLocaleString() : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>

        <TabsContent value="payslips" className="mt-4">
          {payslipsQ.isLoading ? (
            <Skeleton className="h-40" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>{isAr ? "الموظف" : "Employee"}</TableHead>
                  <TableHead>{isAr ? "الحالة" : "Status"}</TableHead>
                  <TableHead>{isAr ? "التشغيل" : "Run"}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(payslipsQ.data ?? []).map((row) => {
                  const slip = (row.payslip ?? row) as Record<string, unknown>;
                  return (
                    <TableRow key={String(slip.id)}>
                      <TableCell>{String(slip.payslipNumber ?? slip.id)}</TableCell>
                      <TableCell>{String(row.employeeName ?? "—")}</TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[String(slip.status)] ?? "outline"}>
                          {String(slip.status)}
                        </Badge>
                      </TableCell>
                      <TableCell>{String(slip.runId ?? row.runId ?? "—")}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </TabsContent>
      </Tabs>
    </motion.div>
  );
}
