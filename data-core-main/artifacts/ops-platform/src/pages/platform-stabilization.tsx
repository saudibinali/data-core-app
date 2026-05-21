import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ShieldCheck, RefreshCw, AlertTriangle, Plane, Banknote, Rocket, CheckCircle2, Circle } from "lucide-react";
import { toast } from "sonner";

type Snapshot = {
  schemaMigrationTag: string;
  risks: string[];
  recommendations: string[];
  counts: {
    leaveRequestsCanonical: number;
    leaveRequestsLegacy: number;
    payrollRunsCanonical: number;
    payrollRunsLegacy: number;
  };
  cutover: {
    legacyPayrollFrozen: boolean;
    legacyAttendanceFrozen: boolean;
    leave: { legacyFreeze: boolean; canonicalSubmit: boolean };
  };
  leaveMigration?: {
    legacyTotal: number;
    canonicalTotal: number;
    alreadyMigrated: number;
    pendingMigration: number;
    skippedNoLinkedUser: number;
    leaveRuntimeMode: string;
  };
  payrollMigration?: {
    legacyTotal: number;
    canonicalTotal: number;
    alreadyMigrated: number;
    pendingMigration: number;
  };
  modules: Array<{ key: string; enabled: boolean; dependencies: string[] }>;
};

export default function PlatformStabilizationPage() {
  const { i18n } = useTranslation();
  const isAr = i18n.language.startsWith("ar");

  const q = useQuery({
    queryKey: ["/workspace/stabilization"],
    queryFn: () => apiClient.get<Snapshot>("/api/workspace/stabilization").then((r) => r.data),
  });

  const goLiveQ = useQuery({
    queryKey: ["/workspace/go-live"],
    queryFn: () =>
      apiClient
        .get<{
          hcmGoLiveReady: boolean;
          blockers: string[];
          phases: Array<{ key: string; label: string; labelAr: string; status: string; detail?: string }>;
        }>("/api/workspace/go-live")
        .then((r) => r.data),
  });

  const data = q.data;
  const [leaveMigrating, setLeaveMigrating] = useState(false);
  const [payrollMigrating, setPayrollMigrating] = useState(false);

  async function runLeaveMigration(dryRun: boolean) {
    setLeaveMigrating(true);
    try {
      const res = await apiClient.post<{
        dryRun: boolean;
        migrated: number;
        skipped: number;
        errors: Array<{ legacyLeaveId: number; reason: string }>;
      }>("/api/hr/leave-migration/run", { dryRun, limit: 500 });
      const r = res.data;
      toast({
        title: dryRun
          ? (isAr ? "معاينة الترحيل" : "Migration preview")
          : (isAr ? "تم الترحيل" : "Migration complete"),
        description: `${r.migrated} migrated, ${r.skipped} skipped`,
      });
      await q.refetch();
    } catch {
      toast({ title: isAr ? "فشل الترحيل" : "Migration failed", variant: "destructive" });
    } finally {
      setLeaveMigrating(false);
    }
  }

  async function runPayrollMigration(dryRun: boolean) {
    setPayrollMigrating(true);
    try {
      const res = await apiClient.post<{
        migrated: number;
        skipped: number;
        payslipsLinked: number;
      }>("/api/hr/payroll-migration/run", { dryRun, limit: 200 });
      const r = res.data;
      toast({
        title: dryRun ? (isAr ? "معاينة الرواتب" : "Payroll preview") : (isAr ? "ترحيل الرواتب" : "Payroll migrated"),
        description: `${r.migrated} runs, ${r.payslipsLinked} employees`,
      });
      await q.refetch();
    } catch {
      toast({ title: isAr ? "فشل ترحيل الرواتب" : "Payroll migration failed", variant: "destructive" });
    } finally {
      setPayrollMigrating(false);
    }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex flex-wrap justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-primary" />
            {isAr ? "استقرار البنية التحتية" : "Platform Stabilization"}
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {isAr ? "نماذج legacy مقابل canonical — قرارات cutover" : "Legacy vs canonical models — cutover status"}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/hr"><Button variant="outline" size="sm">{isAr ? "العودة" : "Back"}</Button></Link>
          <Button variant="outline" size="sm" onClick={() => q.refetch()}><RefreshCw className="w-4 h-4 mr-2" />{isAr ? "تحديث" : "Refresh"}</Button>
        </div>
      </div>

      {q.isLoading ? <Skeleton className="h-40 w-full" /> : (
        <>
          {goLiveQ.data && (
            <Card className={goLiveQ.data.hcmGoLiveReady ? "border-emerald-500/40" : "border-amber-500/40"}>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Rocket className="w-4 h-4" />
                  {isAr ? "بوابة HCM Go-Live" : "HCM Go-Live Gate"}
                </CardTitle>
                <CardDescription>
                  {goLiveQ.data.hcmGoLiveReady
                    ? (isAr ? "جاهزية HCM كاملة — HR والإجازات والرواتب" : "HCM ready — HR, leave, and payroll cutover complete")
                    : (isAr ? "أكمل مراحل HCM أدناه" : "Complete HCM phases below")}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <ul className="space-y-1.5">
                  {goLiveQ.data.phases.map((p) => (
                    <li key={p.key} className="flex items-start gap-2">
                      {p.status === "complete" ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      ) : (
                        <Circle className="w-4 h-4 text-amber-600 shrink-0" />
                      )}
                      <span>
                        {isAr ? p.labelAr : p.label}
                        {p.detail && <span className="text-muted-foreground ml-1">({p.detail})</span>}
                      </span>
                    </li>
                  ))}
                </ul>
                {goLiveQ.data.hcmGoLiveReady && (
                  <Link href="/admin/hr/payroll-ops">
                    <Button size="sm" className="mt-2">{isAr ? "عمليات الرواتب" : "Payroll Operations"}</Button>
                  </Link>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{isAr ? "المخاطر" : "Risks"}</CardTitle>
              <CardDescription>Migration: {data?.schemaMigrationTag}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {(data?.risks ?? []).length === 0 ? (
                <Badge variant="secondary">{isAr ? "لا مخاطر حرجة" : "No critical flags"}</Badge>
              ) : (
                data!.risks.map((r) => (
                  <Badge key={r} variant="destructive" className="gap-1"><AlertTriangle className="w-3 h-3" />{r}</Badge>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">{isAr ? "الأرقام" : "Counts"}</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-2 text-sm">
              <div>Leave canonical: <strong>{data?.counts.leaveRequestsCanonical}</strong></div>
              <div>Leave legacy: <strong>{data?.counts.leaveRequestsLegacy}</strong></div>
              <div>Payroll canonical: <strong>{data?.counts.payrollRunsCanonical}</strong></div>
              <div>Payroll legacy: <strong>{data?.counts.payrollRunsLegacy}</strong></div>
              <div>Negative stock rows: <strong>{data?.counts.negativeStockRows}</strong></div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Cutover</CardTitle></CardHeader>
            <CardContent className="text-sm space-y-1">
              <div>Legacy leave frozen: {data?.cutover.leave.legacyFreeze ? "yes" : "no"}</div>
              <div>Legacy payroll frozen: {data?.cutover.legacyPayrollFrozen ? "yes" : "no"}</div>
              <div>Legacy attendance frozen: {data?.cutover.legacyAttendanceFrozen ? "yes" : "no"}</div>
              {data?.leaveMigration && (
                <div className="pt-2 text-muted-foreground">
                  Leave runtime: <strong>{data.leaveMigration.leaveRuntimeMode}</strong>
                </div>
              )}
            </CardContent>
          </Card>

          {data?.leaveMigration && data.leaveMigration.pendingMigration > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Plane className="w-4 h-4" />
                  {isAr ? "ترحيل الإجازات" : "Leave Migration (P-HCM3)"}
                </CardTitle>
                <CardDescription>
                  {isAr
                    ? `${data.leaveMigration.pendingMigration} سجل legacy بانتظار الترحيل`
                    : `${data.leaveMigration.pendingMigration} legacy rows pending`}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <div>Migrated: <strong>{data.leaveMigration.alreadyMigrated}</strong></div>
                  <div>Skip (no user): <strong>{data.leaveMigration.skippedNoLinkedUser}</strong></div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={leaveMigrating}
                    onClick={() => runLeaveMigration(true)}
                  >
                    {isAr ? "معاينة (dry-run)" : "Preview (dry-run)"}
                  </Button>
                  <Button
                    size="sm"
                    disabled={leaveMigrating}
                    onClick={() => runLeaveMigration(false)}
                  >
                    {isAr ? "تنفيذ الترحيل" : "Run migration"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {data?.payrollMigration && data.payrollMigration.pendingMigration > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Banknote className="w-4 h-4" />
                  {isAr ? "ترحيل الرواتب" : "Payroll Migration (P-PAY-MIG)"}
                </CardTitle>
                <CardDescription>
                  {isAr
                    ? `${data.payrollMigration.pendingMigration} دورة legacy بانتظار الترحيل`
                    : `${data.payrollMigration.pendingMigration} legacy payroll runs pending migration`}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div>Migrated: <strong>{data.payrollMigration.alreadyMigrated}</strong></div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" disabled={payrollMigrating} onClick={() => runPayrollMigration(true)}>
                    {isAr ? "معاينة" : "Preview"}
                  </Button>
                  <Button size="sm" disabled={payrollMigrating} onClick={() => runPayrollMigration(false)}>
                    {isAr ? "تنفيذ" : "Run"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle className="text-base">{isAr ? "توصيات" : "Recommendations"}</CardTitle></CardHeader>
            <CardContent>
              <ul className="list-disc pl-5 text-sm space-y-1">
                {(data?.recommendations ?? []).map((r) => <li key={r}>{r}</li>)}
              </ul>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
