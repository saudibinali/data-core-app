import { useParams } from "wouter";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { ArrowLeft, Users, DollarSign, TrendingDown, CheckCircle2, Wallet, ChevronRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const MONTH_NAMES    = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const MONTH_NAMES_AR = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];

const RUN_STATUS_CONFIG: Record<string, { label: string; labelAr: string; color: string }> = {
  draft:      { label: "Draft",      labelAr: "مسودة",  color: "bg-zinc-100 text-zinc-700" },
  processing: { label: "Processing", labelAr: "جاري",   color: "bg-blue-100 text-blue-700" },
  approved:   { label: "Approved",   labelAr: "معتمد",  color: "bg-emerald-100 text-emerald-700" },
  paid:       { label: "Paid",       labelAr: "مدفوع",  color: "bg-violet-100 text-violet-700" },
  cancelled:  { label: "Cancelled",  labelAr: "ملغى",   color: "bg-red-100 text-red-700" },
};

function fmtCurrency(val: string | number | null, currency = "SAR") {
  const n = parseFloat(String(val ?? 0)) || 0;
  return `${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

export default function HrPayrollRunPage() {
  const { id } = useParams<{ id: string }>();
  const { i18n } = useTranslation();
  const isAr = i18n.language.startsWith("ar");
  const { toast } = useToast();
  const qc = useQueryClient();

  const runQ = useQuery({
    queryKey: ["/hr/payroll/runs", id],
    queryFn: () => apiClient.get(`/api/hr/payroll/runs/${id}`).then((r) => r.data),
    enabled: !!id,
  });

  const payslipsQ = useQuery({
    queryKey: ["/hr/payroll/runs", id, "payslips"],
    queryFn: () => apiClient.get(`/api/hr/payroll/runs/${id}/payslips`).then((r) => r.data),
    enabled: !!id,
  });

  const processRun = useMutation({
    mutationFn: () => apiClient.post(`/api/hr/payroll/runs/${id}/process`, {}).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/hr/payroll/runs", id] });
      qc.invalidateQueries({ queryKey: ["/hr/payroll/runs", id, "payslips"] });
      toast({ title: isAr ? "تمت المعالجة بنجاح" : "Processed successfully" });
    },
    onError: () => toast({ title: isAr ? "خطأ في المعالجة" : "Processing error", variant: "destructive" }),
  });

  const updateStatus = useMutation({
    mutationFn: (status: string) => apiClient.patch(`/api/hr/payroll/runs/${id}`, { status }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/hr/payroll/runs", id] });
      qc.invalidateQueries({ queryKey: ["/hr/payroll/runs"] });
      toast({ title: isAr ? "تم التحديث" : "Updated" });
    },
  });

  const run      = runQ.data as Record<string, unknown> | undefined;
  const payslips = (payslipsQ.data ?? []) as Record<string, unknown>[];

  if (runQ.isLoading) {
    return (
      <div className="p-6 space-y-4">
        <div className="h-8 w-48 bg-muted animate-pulse rounded" />
        <div className="h-32 bg-muted animate-pulse rounded-lg" />
      </div>
    );
  }

  if (!run) {
    return (
      <div className="p-6 text-center">
        <p className="text-muted-foreground">{isAr ? "لم يتم العثور على المسيرة" : "Payroll run not found"}</p>
        <Link href={`${BASE}/admin/hr/payroll`}><Button className="mt-4" variant="outline">{isAr ? "عودة" : "Back"}</Button></Link>
      </div>
    );
  }

  const statusCfg   = RUN_STATUS_CONFIG[String(run.status)] ?? RUN_STATUS_CONFIG.draft;
  const monthIdx    = Number(run.periodMonth) - 1;
  const monthName   = isAr ? MONTH_NAMES_AR[monthIdx] : MONTH_NAMES[monthIdx];
  const currency    = String(run.currencyCode ?? "SAR");

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6" dir={isAr ? "rtl" : "ltr"}>
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href={`${BASE}/admin/hr/payroll`} className="hover:text-foreground flex items-center gap-1">
          <ArrowLeft className="w-4 h-4" />{isAr ? "الرواتب" : "Payroll"}
        </Link>
        <span>/</span>
        <span className="text-foreground font-medium">{monthName} {String(run.periodYear)}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold">{monthName} {String(run.periodYear)}</h1>
            <Badge className={`text-sm ${statusCfg.color}`}>{isAr ? statusCfg.labelAr : statusCfg.label}</Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">{String(run.code)}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {run.status === "draft" && (
            <Button onClick={() => processRun.mutate()} disabled={processRun.isPending}>
              {processRun.isPending ? (isAr ? "جاري المعالجة..." : "Processing...") : (isAr ? "معالجة المسيرة" : "Process Payroll")}
            </Button>
          )}
          {run.status === "approved" && (
            <Button variant="outline" onClick={() => updateStatus.mutate("paid")}>
              <CheckCircle2 className="w-4 h-4 me-1" />{isAr ? "تأكيد الدفع" : "Mark as Paid"}
            </Button>
          )}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { icon: Users,        label: isAr ? "عدد الموظفين" : "Employees",   value: String(run.employeeCount ?? 0),                                color: "bg-blue-50 text-blue-600 dark:bg-blue-950" },
          { icon: DollarSign,   label: isAr ? "إجمالي الأساسي" : "Total Basic",  value: fmtCurrency(String(run.totalBasic ?? 0), currency),    color: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950" },
          { icon: TrendingDown, label: isAr ? "إجمالي الخصومات" : "Deductions", value: fmtCurrency(String(run.totalDeductions ?? 0), currency), color: "bg-red-50 text-red-600 dark:bg-red-950" },
          { icon: Wallet,       label: isAr ? "صافي الرواتب" : "Net Payroll",  value: fmtCurrency(String(run.totalNet ?? 0), currency),         color: "bg-violet-50 text-violet-600 dark:bg-violet-950" },
        ].map(({ icon: Icon, label, value, color }) => (
          <Card key={label}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${color}`}>
                <Icon className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground truncate">{label}</p>
                <p className="font-bold text-sm">{value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Payslips */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{isAr ? "كشوف الرواتب" : "Payslips"} <span className="text-muted-foreground font-normal text-sm">({payslips.length})</span></CardTitle>
        </CardHeader>
        <CardContent>
          {payslipsQ.isLoading ? (
            <div className="space-y-2">{[1,2,3].map((i) => <div key={i} className="h-14 bg-muted animate-pulse rounded" />)}</div>
          ) : payslips.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <DollarSign className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p>{isAr ? "لا توجد كشوف بعد. قم بمعالجة المسيرة أولاً." : "No payslips yet. Process the run first."}</p>
            </div>
          ) : (
            <div className="divide-y">
              {payslips.map((p) => (
                <div key={String(p.id)} className="flex items-center gap-4 py-3">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-sm shrink-0">
                    {String(p.employeeName ?? "?")[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{String(p.employeeName ?? "-")}</p>
                    <p className="text-xs text-muted-foreground">{String(p.employeeNumber ?? "")}</p>
                  </div>
                  <div className="text-right shrink-0 hidden sm:block">
                    <p className="text-xs text-muted-foreground">{isAr ? "أساسي" : "Basic"}</p>
                    <p className="text-sm font-medium">{fmtCurrency(String(p.basicSalary), currency)}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-muted-foreground">{isAr ? "الصافي" : "Net"}</p>
                    <p className="text-sm font-bold">{fmtCurrency(String(p.netSalary), currency)}</p>
                  </div>
                  <Link href={`${BASE}/admin/hr/payroll/runs/${id}/payslips/${p.id}`}>
                    <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0"><ChevronRight className="w-4 h-4" /></Button>
                  </Link>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
