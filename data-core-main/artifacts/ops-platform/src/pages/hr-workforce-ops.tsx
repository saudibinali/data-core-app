/**
 * P20-F — Workforce Operations Center & Attendance Control Tower
 */
import { useState } from "react";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Activity,
  AlertTriangle,
  RefreshCw,
  Plug,
  Users,
  FileWarning,
  RotateCcw,
  Ban,
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

const POLL_MS = 30_000;

type Overview = {
  rawEventHealth: { failed: number; received: number; duplicate: number; normalized: number };
  syncMetrics: { deadLetter: number; pending: number; last7Days: { successRate: number } };
  unresolvedEmployeeMappings: number;
  importIssuesCount: number;
  integrations: IntegrationHealth[];
  alerts: Array<{ code: string; severity: string; title: string; message: string }>;
};

type IntegrationHealth = {
  id: number;
  name: string;
  connectorKey: string;
  isEnabled: boolean;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  stale: boolean;
  syncSuccessRate7d: number | null;
  failedSyncCount7d: number;
  unresolvedMappings: number;
};

const STATUS_BADGE: Record<string, string> = {
  failed: "destructive",
  dead_letter: "destructive",
  pending: "secondary",
  retry: "outline",
  completed: "default",
  normalized: "default",
  received: "secondary",
  duplicate: "outline",
  ignored: "outline",
  unresolved: "destructive",
};

function severityClass(s: string) {
  if (s === "critical") return "border-red-500/50 bg-red-500/5";
  if (s === "warning") return "border-amber-500/50 bg-amber-500/5";
  return "border-border";
}

export default function HrWorkforceOpsPage() {
  const { i18n } = useTranslation();
  const isAr = i18n.language.startsWith("ar");
  const { toast } = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState("overview");
  const [rawStatus, setRawStatus] = useState("failed");
  const [selectedRawId, setSelectedRawId] = useState<number | null>(null);

  const overviewQ = useQuery({
    queryKey: ["/hr/workforce/ops/overview"],
    queryFn: () => apiClient.get<Overview>("/api/hr/workforce/ops/overview").then((r) => r.data),
    refetchInterval: POLL_MS,
  });

  const rawQ = useQuery({
    queryKey: ["/hr/workforce/ops/raw-events", rawStatus],
    queryFn: () =>
      apiClient
        .get<Record<string, unknown>[]>(`/api/hr/workforce/ops/raw-events?status=${rawStatus}&limit=50`)
        .then((r) => r.data),
    enabled: tab === "raw-events",
    refetchInterval: POLL_MS,
  });

  const syncQ = useQuery({
    queryKey: ["/hr/workforce/ops/sync-jobs"],
    queryFn: () =>
      apiClient.get<Record<string, unknown>[]>("/api/hr/workforce/ops/sync-jobs?limit=50").then((r) => r.data),
    enabled: tab === "sync-jobs",
    refetchInterval: POLL_MS,
  });

  const mapQ = useQuery({
    queryKey: ["/hr/workforce/ops/mappings"],
    queryFn: () =>
      apiClient
        .get<Record<string, unknown>[]>("/api/hr/workforce/ops/employee-mappings/unresolved")
        .then((r) => r.data),
    enabled: tab === "mappings",
    refetchInterval: POLL_MS,
  });

  const importQ = useQuery({
    queryKey: ["/hr/workforce/ops/import-issues"],
    queryFn: () =>
      apiClient.get<Record<string, unknown>[]>("/api/hr/workforce/ops/import-issues").then((r) => r.data),
    enabled: tab === "imports",
  });

  const rawDetailQ = useQuery({
    queryKey: ["/hr/workforce/ops/raw-events", selectedRawId],
    queryFn: () =>
      apiClient
        .get<Record<string, unknown>>(`/api/hr/workforce/ops/raw-events/${selectedRawId}`)
        .then((r) => r.data),
    enabled: selectedRawId != null,
  });

  const empsQ = useQuery({
    queryKey: ["/hr/employees/list"],
    queryFn: () =>
      apiClient
        .get<{ employees: { id: number; fullName: string }[] }>("/api/hr/employees?status=active")
        .then((r) => r.data.employees ?? []),
    enabled: tab === "mappings",
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["/hr/workforce/ops"] });
  };

  const replayMut = useMutation({
    mutationFn: (id: number) =>
      apiClient.post(`/api/hr/workforce/ops/raw-events/${id}/replay`).then((r) => r.data),
    onSuccess: () => {
      toast({ title: isAr ? "تمت إعادة المعالجة" : "Replay completed" });
      invalidate();
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const ignoreMut = useMutation({
    mutationFn: (id: number) =>
      apiClient.post(`/api/hr/workforce/ops/raw-events/${id}/ignore`).then((r) => r.data),
    onSuccess: invalidate,
  });

  const retryJobMut = useMutation({
    mutationFn: (id: number) =>
      apiClient.post(`/api/hr/workforce/ops/sync-jobs/${id}/retry`).then((r) => r.data),
    onSuccess: invalidate,
  });

  const ov = overviewQ.data;

  return (
    <motion.div className="space-y-6">
      <motion.div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Activity className="w-6 h-6 text-primary" />
            {isAr ? "مركز عمليات القوى العاملة" : "Workforce Operations Center"}
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {isAr
              ? "مراقبة التكاملات والمزامنة وأحداث الحضور"
              : "Integration health, sync jobs, raw events, and mappings"}
          </p>
        </div>
        <motion.div className="flex gap-2">
          <Link href="/admin/hr/attendance">
            <Button variant="outline" size="sm">
              {isAr ? "الحضور" : "Attendance"}
              <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </Link>
          <Button variant="outline" size="sm" onClick={() => overviewQ.refetch()}>
            <RefreshCw className={cn("w-4 h-4", overviewQ.isFetching && "animate-spin")} />
          </Button>
        </motion.div>
      </motion.div>

      {overviewQ.isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : ov ? (
        <motion.div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label={isAr ? "أحداث فاشلة" : "Failed events"} value={ov.rawEventHealth.failed} warn />
          <Stat label={isAr ? "مزامنة معلقة" : "Pending sync"} value={ov.syncMetrics.pending} />
          <Stat label={isAr ? "تعيينات غير محلولة" : "Unresolved maps"} value={ov.unresolvedEmployeeMappings} warn />
          <Stat label={isAr ? "Dead letter" : "Dead letter jobs"} value={ov.syncMetrics.deadLetter} warn />
        </motion.div>
      ) : null}

      {ov?.alerts && ov.alerts.length > 0 && (
        <motion.div className="space-y-2">
          {ov.alerts.slice(0, 6).map((a) => (
            <div
              key={a.code + a.title}
              className={cn("flex gap-3 p-3 rounded-lg border text-sm", severityClass(a.severity))}
            >
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <motion.div>
                <p className="font-medium">{a.title}</p>
                <p className="text-muted-foreground">{a.message}</p>
              </motion.div>
            </div>
          ))}
        </motion.div>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="overview">{isAr ? "نظرة عامة" : "Overview"}</TabsTrigger>
          <TabsTrigger value="integrations">{isAr ? "التكاملات" : "Integrations"}</TabsTrigger>
          <TabsTrigger value="raw-events">{isAr ? "الأحداث الخام" : "Raw events"}</TabsTrigger>
          <TabsTrigger value="sync-jobs">{isAr ? "مهام المزامنة" : "Sync jobs"}</TabsTrigger>
          <TabsTrigger value="mappings">{isAr ? "التعيينات" : "Mappings"}</TabsTrigger>
          <TabsTrigger value="imports">{isAr ? "الاستيراد" : "Import issues"}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>{isAr ? "صحة التكاملات" : "Integration health"}</CardTitle>
            </CardHeader>
            <CardContent>
              <IntegrationTable integrations={ov?.integrations ?? []} isAr={isAr} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="integrations" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Plug className="w-5 h-5" />
                {isAr ? "لوحة التكاملات" : "Integration dashboard"}
              </CardTitle>
              <CardDescription>
                <Link href="/admin/hr/attendance" className="text-primary underline">
                  {isAr ? "إدارة التكاملات من مركز الحضور قريباً" : "Configure via API / attendance hub"}
                </Link>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <IntegrationTable integrations={ov?.integrations ?? []} isAr={isAr} detailed />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="raw-events" className="mt-4 space-y-3">
          <div className="flex gap-2 flex-wrap">
            {["failed", "received", "duplicate", "normalized", "ignored"].map((s) => (
              <Button
                key={s}
                size="sm"
                variant={rawStatus === s ? "default" : "outline"}
                onClick={() => setRawStatus(s)}
              >
                {s}
              </Button>
            ))}
          </div>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>{isAr ? "موظف" : "Employee"}</TableHead>
                    <TableHead>{isAr ? "مصدر" : "Source"}</TableHead>
                    <TableHead>{isAr ? "حالة" : "Status"}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(rawQ.data ?? []).map((row) => (
                    <TableRow key={Number(row.id)}>
                      <TableCell>{String(row.id)}</TableCell>
                      <TableCell>{String(row.employeeName ?? row.employeeId ?? "—")}</TableCell>
                      <TableCell>{String(row.sourceCode ?? "")}</TableCell>
                      <TableCell>
                        <Badge variant={(STATUS_BADGE[String(row.processingStatus)] ?? "outline") as "default"}>
                          {String(row.processingStatus)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right space-x-1">
                        <Button size="sm" variant="ghost" onClick={() => setSelectedRawId(Number(row.id))}>
                          {isAr ? "عرض" : "View"}
                        </Button>
                        {row.processingStatus === "failed" && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => replayMut.mutate(Number(row.id))}
                            >
                              <RotateCcw className="w-3 h-3" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => ignoreMut.mutate(Number(row.id))}
                            >
                              <Ban className="w-3 h-3" />
                            </Button>
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sync-jobs" className="mt-4">
          <Card>
            <CardContent className="p-0 pt-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>{isAr ? "تكامل" : "Integration"}</TableHead>
                    <TableHead>{isAr ? "حالة" : "Status"}</TableHead>
                    <TableHead>{isAr ? "محاولات" : "Attempts"}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(syncQ.data ?? []).map((job) => (
                    <TableRow key={Number(job.id)}>
                      <TableCell>{String(job.id)}</TableCell>
                      <TableCell>{String(job.integrationName ?? "—")}</TableCell>
                      <TableCell>
                        <Badge variant={(STATUS_BADGE[String(job.status)] ?? "outline") as "default"}>
                          {String(job.status)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {String(job.attempts)}/{String(job.maxAttempts)}
                      </TableCell>
                      <TableCell>
                        {["dead_letter", "retry", "failed", "completed"].includes(String(job.status)) && (
                          <Button size="sm" variant="outline" onClick={() => retryJobMut.mutate(Number(job.id))}>
                            {isAr ? "إعادة" : "Retry"}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="mappings" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="w-5 h-5" />
                {isAr ? "تعيينات غير محلولة" : "Unresolved mappings"}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{isAr ? "خارجي" : "External ID"}</TableHead>
                    <TableHead>{isAr ? "تكامل" : "Integration"}</TableHead>
                    <TableHead>{isAr ? "ربط بموظف" : "Map to employee"}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(mapQ.data ?? []).map((m) => (
                    <MappingRow
                      key={Number(m.id)}
                      row={m}
                      employees={empsQ.data ?? []}
                      isAr={isAr}
                      onResolved={invalidate}
                    />
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="imports" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileWarning className="w-5 h-5" />
                {isAr ? "مشاكل الاستيراد" : "Import issues"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {(importQ.data ?? []).length === 0 ? (
                <p className="text-muted-foreground text-sm">{isAr ? "لا مشاكل" : "No open import issues"}</p>
              ) : (
                <ul className="space-y-2">
                  {(importQ.data ?? []).map((b) => (
                    <li key={Number(b.batchId)} className="text-sm border rounded p-2">
                      Batch #{String(b.batchId)} — {String(b.status)} — {String(b.errorRowCount)} errors
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={selectedRawId != null} onOpenChange={() => setSelectedRawId(null)}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>Raw event #{selectedRawId}</DialogTitle>
          </DialogHeader>
          {rawDetailQ.isLoading ? (
            <Skeleton className="h-40" />
          ) : (
            <pre className="text-xs bg-muted p-3 rounded overflow-auto">
              {JSON.stringify(rawDetailQ.data?.payload ?? rawDetailQ.data, null, 2)}
            </pre>
          )}
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <Card className={warn && value > 0 ? "border-amber-500/40" : ""}>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={cn("text-2xl font-bold", warn && value > 0 && "text-amber-600")}>{value}</p>
      </CardContent>
    </Card>
  );
}

function IntegrationTable({
  integrations,
  isAr,
  detailed,
}: {
  integrations: IntegrationHealth[];
  isAr: boolean;
  detailed?: boolean;
}) {
  if (!integrations.length) {
    return <p className="text-sm text-muted-foreground">{isAr ? "لا تكاملات" : "No integrations configured"}</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{isAr ? "الاسم" : "Name"}</TableHead>
          <TableHead>{isAr ? "موصل" : "Connector"}</TableHead>
          <TableHead>{isAr ? "آخر مزامنة" : "Last sync"}</TableHead>
          {detailed && <TableHead>{isAr ? "نجاح %" : "Success %"}</TableHead>}
          <TableHead>{isAr ? "حالة" : "Status"}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {integrations.map((i) => (
          <TableRow key={i.id}>
            <TableCell className="font-medium">{i.name}</TableCell>
            <TableCell>
              <code className="text-xs">{i.connectorKey}</code>
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {i.lastSyncAt ? new Date(i.lastSyncAt).toLocaleString() : "—"}
            </TableCell>
            {detailed && (
              <TableCell>{i.syncSuccessRate7d != null ? `${i.syncSuccessRate7d}%` : "—"}</TableCell>
            )}
            <TableCell>
              {!i.isEnabled ? (
                <Badge variant="outline">{isAr ? "معطل" : "Disabled"}</Badge>
              ) : i.stale ? (
                <Badge variant="destructive">{isAr ? "قديم" : "Stale"}</Badge>
              ) : (
                <Badge>{i.lastSyncStatus ?? "ok"}</Badge>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function MappingRow({
  row,
  employees,
  isAr,
  onResolved,
}: {
  row: Record<string, unknown>;
  employees: { id: number; fullName: string }[];
  isAr: boolean;
  onResolved: () => void;
}) {
  const [empId, setEmpId] = useState("");
  const resolve = useMutation({
    mutationFn: () =>
      apiClient
        .post("/api/hr/workforce/ops/employee-mappings/bulk-resolve", {
          items: [
            {
              integrationId: Number(row.integrationId),
              externalEmployeeId: String(row.externalEmployeeId),
              employeeId: Number(empId),
            },
          ],
        })
        .then((r) => r.data),
    onSuccess: onResolved,
  });
  return (
    <TableRow>
      <TableCell>
        <code className="text-xs">{String(row.externalEmployeeId)}</code>
      </TableCell>
      <TableCell>{String(row.integrationName ?? row.integrationId)}</TableCell>
      <TableCell>
        <div className="flex gap-2">
          <select
            className="text-sm border rounded px-2 py-1"
            value={empId}
            onChange={(e) => setEmpId(e.target.value)}
          >
            <option value="">{isAr ? "اختر موظف" : "Select employee"}</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.fullName}
              </option>
            ))}
          </select>
          <Button size="sm" disabled={!empId} onClick={() => resolve.mutate()}>
            {isAr ? "ربط" : "Map"}
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
