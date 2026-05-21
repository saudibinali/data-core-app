import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { DollarSign, ChevronRight, ArrowLeft, Wallet, TrendingDown, TrendingUp } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const MONTH_NAMES    = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const MONTH_NAMES_AR = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];

function fmtCurrency(val: string | number | null, currency = "SAR") {
  const n = parseFloat(String(val ?? 0)) || 0;
  return `${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

const COMP_TYPE_COLORS: Record<string, string> = {
  base:      "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  allowance: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  deduction: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
  bonus:     "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  overtime:  "bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
};

function PayslipDetail({ id, isAr }: { id: string; isAr: boolean }) {
  const q = useQuery({
    queryKey: ["/hr/me/payslips", id],
    queryFn:  () => apiClient.get(`/api/hr/me/payslips/${id}`).then((r) => r.data),
  });

  if (q.isLoading) return <div className="space-y-3">{[1,2,3].map((i) => <div key={i} className="h-12 bg-muted animate-pulse rounded" />)}</div>;
  if (!q.data) return <p className="text-muted-foreground text-center py-8">{isAr ? "لم يتم العثور على الكشف" : "Payslip not found"}</p>;

  const p    = q.data as Record<string, unknown>;
  const lines = (p.lines ?? []) as Record<string, unknown>[];
  const run   = p.run as Record<string, unknown> | undefined;
  const cur   = String(p.currencyCode ?? "SAR");
  const monthIdx = run ? Number(run.periodMonth) - 1 : 0;
  const monthName = run ? (isAr ? MONTH_NAMES_AR[monthIdx] : MONTH_NAMES[monthIdx]) : "";

  const earnings  = lines.filter((l) => ["base","allowance","bonus","overtime"].includes(String(l.componentType)));
  const deductions = lines.filter((l) => l.componentType === "deduction");

  return (
    <div className="space-y-5">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { icon: DollarSign,   label: isAr ? "الأساسي"    : "Basic",       value: fmtCurrency(String(p.basicSalary), cur),     color: "bg-blue-50 text-blue-600 dark:bg-blue-950" },
          { icon: TrendingUp,   label: isAr ? "الإجمالي"   : "Gross",       value: fmtCurrency(String(p.grossSalary), cur),     color: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950" },
          { icon: Wallet,       label: isAr ? "الصافي"     : "Net Pay",     value: fmtCurrency(String(p.netSalary), cur),       color: "bg-violet-50 text-violet-600 dark:bg-violet-950" },
        ].map(({ icon: Icon, label, value, color }) => (
          <Card key={label}>
            <CardContent className="p-3 flex flex-col items-center text-center gap-1">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${color}`}><Icon className="w-4 h-4" /></div>
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="font-bold text-sm">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Earnings */}
      {earnings.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <h3 className="font-semibold text-sm mb-3">{isAr ? "المكاسب" : "Earnings"}</h3>
            <div className="divide-y">
              {earnings.map((l, i) => (
                <div key={i} className="flex items-center justify-between py-2 text-sm">
                  <div className="flex items-center gap-2">
                    <Badge className={`text-xs ${COMP_TYPE_COLORS[String(l.componentType)] ?? ""}`}>
                      {String(l.componentType)}
                    </Badge>
                    <span>{isAr && l.componentNameAr ? String(l.componentNameAr) : String(l.componentName)}</span>
                  </div>
                  <span className="font-medium">{fmtCurrency(String(l.amount), cur)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Deductions */}
      {deductions.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <h3 className="font-semibold text-sm mb-3 text-red-600">{isAr ? "الخصومات" : "Deductions"}</h3>
            <div className="divide-y">
              {deductions.map((l, i) => (
                <div key={i} className="flex items-center justify-between py-2 text-sm">
                  <span>{isAr && l.componentNameAr ? String(l.componentNameAr) : String(l.componentName)}</span>
                  <span className="font-medium text-red-600">- {fmtCurrency(String(l.amount), cur)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Net */}
      <div className="rounded-lg border-2 border-primary/30 bg-primary/5 p-4 flex items-center justify-between">
        <span className="font-semibold">{isAr ? "صافي الراتب" : "Net Pay"}</span>
        <span className="text-xl font-bold text-primary">{fmtCurrency(String(p.netSalary), cur)}</span>
      </div>
    </div>
  );
}

export default function HrMePayslipsPage() {
  const { i18n } = useTranslation();
  const isAr = i18n.language.startsWith("ar");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const payslipsQ = useQuery({
    queryKey: ["/hr/me/payslips"],
    queryFn:  () => apiClient.get("/api/hr/me/payslips").then((r) => r.data),
  });

  const payslips = (payslipsQ.data ?? []) as Record<string, unknown>[];

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6" dir={isAr ? "rtl" : "ltr"}>
      {selectedId ? (
        <>
          <div className="flex items-center gap-2">
            <button onClick={() => setSelectedId(null)} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
              <ArrowLeft className="w-4 h-4" />{isAr ? "الكشوف" : "Payslips"}
            </button>
          </div>
          <PayslipDetail id={selectedId} isAr={isAr} />
        </>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">{isAr ? "كشوف راتبي" : "My Payslips"}</h1>
              <p className="text-sm text-muted-foreground">{isAr ? "سجل رواتبك الشهرية" : "Your monthly salary history"}</p>
            </div>
            <Link href={`${BASE}/self-service`}><Button variant="outline" size="sm">{isAr ? "الخدمات الذاتية" : "Self-Service"}</Button></Link>
          </div>

          {payslipsQ.isLoading ? (
            <div className="space-y-2">{[1,2,3].map((i) => <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />)}</div>
          ) : payslips.length === 0 ? (
            <Card>
              <CardContent className="p-12 text-center text-muted-foreground">
                <DollarSign className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p className="font-medium">{isAr ? "لا توجد كشوف راتب بعد" : "No payslips yet"}</p>
                <p className="text-sm mt-1">{isAr ? "ستظهر كشوف الراتب هنا بعد معالجة مسيرة الرواتب" : "Payslips will appear here after payroll is processed"}</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {payslips.map((p) => {
                const monthIdx  = Number(p.periodMonth) - 1;
                const monthName = isAr ? MONTH_NAMES_AR[monthIdx] : MONTH_NAMES[monthIdx];
                const cur       = String(p.currencyCode ?? "SAR");
                return (
                  <button
                    key={String(p.id)}
                    className="w-full text-start"
                    onClick={() => setSelectedId(String(p.id))}
                  >
                    <Card className="hover:shadow-md transition-shadow cursor-pointer">
                      <CardContent className="p-4 flex items-center gap-4">
                        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary shrink-0">
                          <DollarSign className="w-5 h-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold">{monthName} {String(p.periodYear)}</p>
                          <p className="text-xs text-muted-foreground">{String(p.runName ?? "")}</p>
                        </div>
                        <div className={`text-right shrink-0`}>
                          <p className="text-xs text-muted-foreground">{isAr ? "الصافي" : "Net Pay"}</p>
                          <p className="font-bold">{fmtCurrency(String(p.netSalary), cur)}</p>
                        </div>
                        <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                      </CardContent>
                    </Card>
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
