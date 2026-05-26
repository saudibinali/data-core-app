import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { CalendarCheck, Plus } from "lucide-react";
import { fetchLeaveListBridge, fetchMeLeavePolicies, LEAVE_STATUS_UI, submitLeaveViaBridge } from "@/lib/leave-bridge";
import { useLeaveCutover } from "@/lib/leave-cutover-flags";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const LEAVE_STATUS = LEAVE_STATUS_UI;

const LEAVE_TYPE_LABELS: Record<string, { en: string; ar: string }> = {
  annual:    { en: "Annual Leave",    ar: "إجازة سنوية" },
  sick:      { en: "Sick Leave",      ar: "إجازة مرضية" },
  emergency: { en: "Emergency Leave", ar: "إجازة طارئة" },
  maternity: { en: "Maternity Leave", ar: "إجازة أمومة" },
  paternity: { en: "Paternity Leave", ar: "إجازة أبوة" },
  unpaid:    { en: "Unpaid Leave",    ar: "إجازة بدون راتب" },
  other:     { en: "Other",           ar: "أخرى" },
};

export default function HrMeLeavePage() {
  const { i18n } = useTranslation();
  const isAr = i18n.language.startsWith("ar");
  const { toast } = useToast();
  const qc = useQueryClient();
  const leaveCutover = useLeaveCutover();

  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [newLeaveOpen, setNewLeaveOpen] = useState(false);
  const [leaveForm, setLeaveForm] = useState({
    leaveType: "annual", startDate: "", endDate: "", reason: "", leavePolicyId: "__none__",
  });

  const balancesQ  = useQuery({ queryKey: ["/hr/me/leave-balances", year], queryFn: () => apiClient.get(`/api/hr/me/leave-balances?year=${year}`).then((r) => r.data) });
  const myLeavesQ  = useQuery({
    queryKey: ["/hr/leave-requests", "me", leaveCutover.status?.legacyFreeze],
    queryFn: () => fetchLeaveListBridge(apiClient, {
      cutover: {
        legacyFreeze: leaveCutover.status?.legacyFreeze,
        canonicalRead: leaveCutover.status?.canonicalRead,
      },
    }),
  });
  const policiesQ  = useQuery({
    queryKey: ["/hr/me/leave-policies"],
    queryFn: () => fetchMeLeavePolicies(apiClient),
  });

  const requestLeave = useMutation({
    mutationFn: (body: Record<string, unknown>) => submitLeaveViaBridge(
      apiClient,
      {
        leaveType: String(body.leaveType),
        startDate: String(body.startDate),
        endDate: String(body.endDate),
        reason: body.reason != null ? String(body.reason) : undefined,
        leavePolicyId: body.leavePolicyId as string | number | null | undefined,
        daysCount: body.daysCount != null ? Number(body.daysCount) : undefined,
      },
      { canonicalSubmit: leaveCutover.useCanonicalSubmit },
    ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/hr/leave-requests", "me"] });
      qc.invalidateQueries({ queryKey: ["/hr/me/leave-balances"] });
      setNewLeaveOpen(false);
      toast({ title: isAr ? "تم إرسال الطلب" : "Leave request submitted" });
    },
    onError: () => toast({ title: isAr ? "حدث خطأ" : "Error", variant: "destructive" }),
  });

  const balances = (balancesQ.data ?? []) as Record<string, unknown>[];
  const leaves   = myLeavesQ.data ?? [];
  const policies = (policiesQ.data ?? []) as Record<string, unknown>[];

  const daysCount = leaveForm.startDate && leaveForm.endDate
    ? Math.max(1, Math.round((new Date(leaveForm.endDate).getTime() - new Date(leaveForm.startDate).getTime()) / 86400000) + 1)
    : 0;

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6" dir={isAr ? "rtl" : "ltr"}>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{isAr ? "إجازاتي" : "My Leave"}</h1>
          <p className="text-sm text-muted-foreground">{isAr ? "رصيدك ومتابعة طلبات الإجازة" : "Your leave balance and requests"}</p>
        </div>
        <div className="flex gap-2">
          <Link href={`${BASE}/self-service`}><Button variant="outline" size="sm">{isAr ? "الخدمات الذاتية" : "Self-Service"}</Button></Link>
          <Button size="sm" onClick={() => setNewLeaveOpen(true)}><Plus className="w-4 h-4 me-1" />{isAr ? "طلب إجازة" : "Request Leave"}</Button>
        </div>
      </div>

      {/* Year Selector */}
      {leaveCutover.useCanonicalSubmit && (
        <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          {isAr ? "إرسال الطلبات عبر نظام الإجازات الموحّد (تجريبي)." : "Submitting leave via the canonical system (pilot)."}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Label className="text-sm">{isAr ? "السنة:" : "Year:"}</Label>
        <Input type="number" className="h-8 w-24 text-sm" value={year} onChange={(e) => setYear(e.target.value)} />
      </div>

      {/* Leave Balances */}
      <div>
        <h2 className="font-semibold mb-3">{isAr ? "أرصدة الإجازات" : "Leave Balances"} {year}</h2>
        {balancesQ.isLoading ? (
          <div className="grid sm:grid-cols-2 gap-3">{[1,2].map((i) => <div key={i} className="h-24 bg-muted animate-pulse rounded-lg" />)}</div>
        ) : balances.length === 0 ? (
          <Card><CardContent className="p-6 text-center text-muted-foreground text-sm">{isAr ? "لا توجد أرصدة لهذه السنة" : "No balances for this year"}</CardContent></Card>
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">
            {balances.map((b) => {
              const entitled  = parseFloat(String(b.entitled))  || 0;
              const used      = parseFloat(String(b.used))      || 0;
              const pending   = parseFloat(String(b.pending))   || 0;
              const carried   = parseFloat(String(b.carriedForward)) || 0;
              const adj       = parseFloat(String(b.manualAdjustment)) || 0;
              const remaining = entitled + carried + adj - used - pending;
              const pct       = entitled > 0 ? Math.min(100, (used / entitled) * 100) : 0;
              const typeKey   = String(b.leaveType);
              const typeLabel = LEAVE_TYPE_LABELS[typeKey] ?? { en: typeKey, ar: typeKey };
              return (
                <Card key={String(b.id)} className="overflow-hidden">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <div>
                        <p className="font-semibold text-sm">{isAr && b.policyNameAr ? String(b.policyNameAr) : String(b.policyName ?? (isAr ? typeLabel.ar : typeLabel.en))}</p>
                        <p className="text-xs text-muted-foreground">{isAr ? typeLabel.ar : typeLabel.en}</p>
                      </div>
                      <span className="text-2xl font-bold">{remaining}</span>
                    </div>
                    {/* Progress bar */}
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden mb-2">
                      <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>{isAr ? `مستخدم: ${used}` : `Used: ${used}`}</span>
                      <span>{isAr ? `متاح: ${remaining}` : `Available: ${remaining}`}</span>
                      <span>{isAr ? `المستحق: ${entitled}` : `Entitled: ${entitled}`}</span>
                    </div>
                    {pending > 0 && (
                      <p className="text-xs text-amber-600 mt-1">{isAr ? `${pending} يوم قيد الانتظار` : `${pending} days pending`}</p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Leave Requests */}
      <div>
        <h2 className="font-semibold mb-3">{isAr ? "طلباتي" : "My Requests"}</h2>
        {myLeavesQ.isLoading ? (
          <div className="space-y-2">{[1,2].map((i) => <div key={i} className="h-16 bg-muted animate-pulse rounded" />)}</div>
        ) : leaves.length === 0 ? (
          <Card><CardContent className="p-6 text-center text-muted-foreground text-sm"><CalendarCheck className="w-8 h-8 mx-auto mb-2 opacity-30" />{isAr ? "لا توجد طلبات إجازة" : "No leave requests"}</CardContent></Card>
        ) : (
          <div className="space-y-2">
            {leaves.slice(0, 10).map((l) => {
              const sc = LEAVE_STATUS[l.status] ?? LEAVE_STATUS.pending;
              const typeKey = l.leaveType;
              const typeLabel = LEAVE_TYPE_LABELS[typeKey] ?? { en: typeKey, ar: typeKey };
              return (
                <Card key={`${l.source}-${l.id}`}>
                  <CardContent className="p-3 flex items-center gap-3">
                    <div className={`w-2 h-8 rounded-full shrink-0 ${sc.color.split(" ")[0]}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-sm">{isAr ? typeLabel.ar : typeLabel.en}</p>
                        <Badge className={`text-xs ${sc.color}`}>{isAr ? sc.labelAr : sc.label}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {l.startDate} → {l.endDate}
                        {l.daysCount != null ? ` · ${l.daysCount} ${isAr ? "يوم" : "days"}` : ""}
                        {l.requestNumber ? ` · ${l.requestNumber}` : ""}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* New Leave Dialog */}
      <Dialog open={newLeaveOpen} onOpenChange={setNewLeaveOpen}>
        <DialogContent dir={isAr ? "rtl" : "ltr"}>
          <DialogHeader><DialogTitle>{isAr ? "طلب إجازة" : "Request Leave"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>{isAr ? "نوع الإجازة" : "Leave Type"}</Label>
              <Select value={leaveForm.leaveType} onValueChange={(v) => setLeaveForm((f) => ({ ...f, leaveType: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(LEAVE_TYPE_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{isAr ? v.ar : v.en}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {policies.length > 0 && (
              <div className="space-y-1.5">
                <Label>{isAr ? "السياسة" : "Leave Policy"}</Label>
                <Select value={leaveForm.leavePolicyId} onValueChange={(v) => setLeaveForm((f) => ({ ...f, leavePolicyId: v }))}>
                  <SelectTrigger><SelectValue placeholder={isAr ? "اختر السياسة" : "Select policy"} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">{isAr ? "- بدون سياسة -" : "- No policy -"}</SelectItem>
                    {policies.map((p: Record<string, unknown>) => (
                      <SelectItem key={String(p.id)} value={String(p.id)}>
                        {isAr && p.nameAr ? String(p.nameAr) : String(p.name)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{isAr ? "تاريخ البداية" : "Start Date"}</Label>
                <Input type="date" value={leaveForm.startDate} onChange={(e) => setLeaveForm((f) => ({ ...f, startDate: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>{isAr ? "تاريخ النهاية" : "End Date"}</Label>
                <Input type="date" value={leaveForm.endDate} min={leaveForm.startDate} onChange={(e) => setLeaveForm((f) => ({ ...f, endDate: e.target.value }))} />
              </div>
            </div>
            {daysCount > 0 && (
              <p className="text-sm text-primary font-medium">
                {isAr ? `= ${daysCount} يوم` : `= ${daysCount} day${daysCount > 1 ? "s" : ""}`}
              </p>
            )}
            <div className="space-y-1.5">
              <Label>{isAr ? "السبب" : "Reason"}</Label>
              <Input value={leaveForm.reason} onChange={(e) => setLeaveForm((f) => ({ ...f, reason: e.target.value }))} placeholder={isAr ? "اختياري" : "Optional"} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewLeaveOpen(false)}>{isAr ? "إلغاء" : "Cancel"}</Button>
            <Button
              onClick={() => requestLeave.mutate({
                leaveType: leaveForm.leaveType,
                startDate: leaveForm.startDate,
                endDate: leaveForm.endDate,
                daysCount,
                reason: leaveForm.reason || null,
                leavePolicyId: leaveForm.leavePolicyId === "__none__" ? null : Number(leaveForm.leavePolicyId),
              })}
              disabled={requestLeave.isPending || !leaveForm.startDate || !leaveForm.endDate}
            >
              {isAr ? "إرسال الطلب" : "Submit Request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
