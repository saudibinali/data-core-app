/**
 * F5.3 — Admin leave management: queue, filters, reject reason required, team calendar (read-only).
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getListHrLeaveRequestsQueryKey,
  useApproveHrLeaveRequest,
  useListHrLeaveRequests,
  useRejectHrLeaveRequest,
  type HrLeaveRequestListItem,
} from "@workspace/api-client-react";
import { apiClient } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useLeaveCutover } from "@/lib/leave-cutover-flags";
import { LEAVE_STATUS_UI } from "@/lib/leave-bridge";
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

const LEAVE_TYPES = [
  { key: "annual", en: "Annual", ar: "سنوية" },
  { key: "sick", en: "Sick", ar: "مرضية" },
  { key: "emergency", en: "Emergency", ar: "طارئة" },
  { key: "maternity", en: "Maternity", ar: "أمومة" },
  { key: "paternity", en: "Paternity", ar: "أبوة" },
  { key: "unpaid", en: "Unpaid", ar: "بدون راتب" },
  { key: "other", en: "Other", ar: "أخرى" },
] as const;

const STATUS_FILTERS = [
  { value: "__all__", en: "All statuses", ar: "كل الحالات" },
  { value: "pending", en: "Pending approval", ar: "بانتظار الموافقة" },
  { value: "approved", en: "Approved", ar: "موافق عليها" },
  { value: "rejected", en: "Rejected", ar: "مرفوضة" },
  { value: "withdrawn", en: "Withdrawn", ar: "مسحوبة" },
  { value: "cancelled", en: "Cancelled", ar: "ملغاة" },
] as const;

type TeamCalendarEntry = {
  requestId: number;
  employeeId: number;
  employeeName: string;
  employeeNumber?: string | null;
  leaveType: string;
  startDate: string;
  endDate: string;
  status: string;
  businessDaysCount: number;
  requestNumber: string;
};

type TeamCalendarResponse = {
  month: string;
  scope: string;
  readOnly: boolean;
  entries: TeamCalendarEntry[];
};

function isActionable(status: string): boolean {
  return status === "pending" || status === "pending_approval";
}

function monthLabel(ym: string, isAr: boolean): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString(isAr ? "ar-SA" : "en-US", { month: "long", year: "numeric" });
}

function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function HrLeaveAdminPage() {
  const { i18n } = useTranslation();
  const isAr = i18n.language.startsWith("ar");
  const { toast } = useToast();
  const qc = useQueryClient();
  const leaveCutover = useLeaveCutover();

  const [tab, setTab] = useState("queue");
  const [statusFilter, setStatusFilter] = useState("pending");
  const [typeFilter, setTypeFilter] = useState("__all__");
  const [search, setSearch] = useState("");
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`;
  });

  const [rejectTarget, setRejectTarget] = useState<HrLeaveRequestListItem | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [approveTarget, setApproveTarget] = useState<HrLeaveRequestListItem | null>(null);
  const [approveNote, setApproveNote] = useState("");

  const listParams = useMemo(() => {
    const p: { status?: string; leaveType?: string } = {};
    if (statusFilter && statusFilter !== "__all__") p.status = statusFilter;
    if (typeFilter && typeFilter !== "__all__") p.leaveType = typeFilter;
    return p;
  }, [statusFilter, typeFilter]);

  const listQ = useListHrLeaveRequests(listParams, {
    query: { enabled: tab === "queue" },
  });

  const calendarQ = useQuery({
    queryKey: ["/hr/leave-requests/team-calendar", calendarMonth],
    queryFn: () =>
      apiClient
        .get<TeamCalendarResponse>(`/api/hr/leave-requests/team-calendar?month=${calendarMonth}`)
        .then((r) => r.data),
    enabled: tab === "calendar",
  });

  const approveM = useApproveHrLeaveRequest();
  const rejectM = useRejectHrLeaveRequest();

  const rows = useMemo(() => {
    const data = listQ.data ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return data;
    return data.filter((r) => {
      const name = (r.employeeName ?? "").toLowerCase();
      const num = (r.employeeNumber ?? "").toLowerCase();
      const req = (r.requestNumber ?? "").toLowerCase();
      return name.includes(q) || num.includes(q) || req.includes(q);
    });
  }, [listQ.data, search]);

  const pendingCount = useMemo(
    () => (listQ.data ?? []).filter((r) => isActionable(r.status)).length,
    [listQ.data],
  );

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: getListHrLeaveRequestsQueryKey() });
    void qc.invalidateQueries({ queryKey: ["/hr/leave-requests/team-calendar"] });
  };

  const handleApprove = async () => {
    if (!approveTarget) return;
    try {
      await approveM.mutateAsync({
        id: approveTarget.id,
        data: { comment: approveNote.trim() || undefined },
      });
      toast({ title: isAr ? "تمت الموافقة" : "Leave approved" });
      setApproveTarget(null);
      setApproveNote("");
      invalidate();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : (isAr ? "فشلت الموافقة" : "Approval failed");
      toast({ title: msg, variant: "destructive" });
    }
  };

  const handleReject = async () => {
    if (!rejectTarget) return;
    const reason = rejectReason.trim();
    if (!reason) {
      toast({
        title: isAr ? "سبب الرفض مطلوب" : "Rejection reason is required",
        variant: "destructive",
      });
      return;
    }
    try {
      await rejectM.mutateAsync({
        id: rejectTarget.id,
        data: { comment: reason },
      });
      toast({ title: isAr ? "تم الرفض" : "Leave rejected" });
      setRejectTarget(null);
      setRejectReason("");
      invalidate();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : (isAr ? "فشل الرفض" : "Rejection failed");
      toast({ title: msg, variant: "destructive" });
    }
  };

  const calendarEntries = calendarQ.data?.entries ?? [];
  const calendarByEmployee = useMemo(() => {
    const map = new Map<number, { name: string; entries: TeamCalendarEntry[] }>();
    for (const e of calendarEntries) {
      const cur = map.get(e.employeeId);
      if (cur) cur.entries.push(e);
      else map.set(e.employeeId, { name: e.employeeName, entries: [e] });
    }
    return [...map.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
  }, [calendarEntries]);

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6" dir={isAr ? "rtl" : "ltr"}>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {isAr ? "إدارة الإجازات" : "Leave Management"}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isAr
              ? "طابور الموافقات، الفلاتر، والتقويم التنظيمي (قراءة فقط)"
              : "Approval queue, filters, and team calendar (read-only)"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/hr/attendance">
            <Button variant="outline" size="sm">
              {isAr ? "الحضور" : "Attendance"}
            </Button>
          </Link>
          <Link href="/self-service/approvals">
            <Button variant="outline" size="sm">
              {isAr ? "صندوق الموافقات" : "Approval Inbox"}
            </Button>
          </Link>
          <Button variant="ghost" size="icon" onClick={() => invalidate()} aria-label="Refresh">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {leaveCutover.useCanonicalApprove && (
        <p className="text-sm rounded-md border border-primary/25 bg-primary/5 px-3 py-2 text-muted-foreground">
          {isAr
            ? "المسار الموحّد: leave_requests + leave_approval_steps"
            : "Canonical path: leave_requests + leave_approval_steps"}
        </p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">{isAr ? "قيد الموافقة" : "Pending"}</p>
            <p className="text-2xl font-bold">{pendingCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">{isAr ? "المعروض" : "Filtered"}</p>
            <p className="text-2xl font-bold">{rows.length}</p>
          </CardContent>
        </Card>
        <Card className="col-span-2">
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">{isAr ? "نطاق التقويم" : "Calendar scope"}</p>
            <p className="text-sm font-medium truncate">
              {calendarQ.data?.scope === "workspace"
                ? (isAr ? "كل مساحة العمل" : "Whole workspace")
                : (isAr ? "فريقي المباشر" : "My direct reports")}
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="queue">{isAr ? "الطابور" : "Queue"}</TabsTrigger>
          <TabsTrigger value="calendar">{isAr ? "تقويم الفريق" : "Team calendar"}</TabsTrigger>
        </TabsList>

        <TabsContent value="queue" className="space-y-4 mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{isAr ? "فلاتر" : "Filters"}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              <div className="space-y-1 min-w-[140px]">
                <Label className="text-xs">{isAr ? "الحالة" : "Status"}</Label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUS_FILTERS.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {isAr ? s.ar : s.en}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1 min-w-[140px]">
                <Label className="text-xs">{isAr ? "النوع" : "Type"}</Label>
                <Select value={typeFilter} onValueChange={setTypeFilter}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">{isAr ? "الكل" : "All types"}</SelectItem>
                    {LEAVE_TYPES.map((t) => (
                      <SelectItem key={t.key} value={t.key}>{isAr ? t.ar : t.en}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1 flex-1 min-w-[200px]">
                <Label className="text-xs">{isAr ? "بحث" : "Search"}</Label>
                <Input
                  className="h-9"
                  placeholder={isAr ? "اسم، رقم موظف، طلب…" : "Name, employee #, request…"}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{isAr ? "طابور الطلبات" : "Request queue"}</CardTitle>
              <CardDescription>
                {isAr ? "الرفض يتطلب سبباً موثقاً" : "Rejections require a documented reason"}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {listQ.isLoading ? (
                <div className="p-6 space-y-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : rows.length === 0 ? (
                <p className="p-8 text-center text-sm text-muted-foreground">
                  {isAr ? "لا توجد طلبات مطابقة" : "No matching requests"}
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{isAr ? "الموظف" : "Employee"}</TableHead>
                      <TableHead>{isAr ? "النوع" : "Type"}</TableHead>
                      <TableHead>{isAr ? "الفترة" : "Period"}</TableHead>
                      <TableHead>{isAr ? "الأيام" : "Days"}</TableHead>
                      <TableHead>{isAr ? "الحالة" : "Status"}</TableHead>
                      <TableHead className="text-end">{isAr ? "إجراء" : "Action"}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => {
                      const sc = LEAVE_STATUS_UI[row.status] ?? LEAVE_STATUS_UI.pending;
                      const typeDef = LEAVE_TYPES.find((t) => t.key === row.leaveType);
                      return (
                        <TableRow key={row.id}>
                          <TableCell>
                            <div className="font-medium text-sm">{row.employeeName ?? "—"}</div>
                            <div className="text-xs text-muted-foreground">
                              {row.employeeNumber ?? ""} {row.requestNumber ? `· ${row.requestNumber}` : ""}
                            </div>
                          </TableCell>
                          <TableCell className="text-sm">
                            {typeDef ? (isAr ? typeDef.ar : typeDef.en) : row.leaveType}
                          </TableCell>
                          <TableCell className="text-sm whitespace-nowrap">
                            {row.startDate} → {row.endDate}
                          </TableCell>
                          <TableCell>{row.businessDaysCount}</TableCell>
                          <TableCell>
                            <Badge className={cn("text-xs", sc.color)}>
                              {isAr ? sc.labelAr : sc.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-end">
                            {isActionable(row.status) ? (
                              <div className="flex gap-1 justify-end">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    setApproveTarget(row);
                                    setApproveNote("");
                                  }}
                                >
                                  <Check className="h-3.5 w-3.5 me-1" />
                                  {isAr ? "موافقة" : "Approve"}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-destructive"
                                  onClick={() => {
                                    setRejectTarget(row);
                                    setRejectReason("");
                                  }}
                                >
                                  <X className="h-3.5 w-3.5 me-1" />
                                  {isAr ? "رفض" : "Reject"}
                                </Button>
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="calendar" className="space-y-4 mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <CalendarDays className="h-4 w-4" />
                  {monthLabel(calendarMonth, isAr)}
                </CardTitle>
                <CardDescription>
                  {isAr ? "عرض للقراءة فقط — المرحلة 1" : "Read-only view — phase 1"}
                </CardDescription>
              </div>
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setCalendarMonth((m) => shiftMonth(m, -1))}
                >
                  {isAr ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setCalendarMonth((m) => shiftMonth(m, 1))}
                >
                  {isAr ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {calendarQ.isLoading ? (
                <Skeleton className="h-32 w-full" />
              ) : calendarByEmployee.length === 0 ? (
                <p className="text-sm text-center text-muted-foreground py-8">
                  {isAr ? "لا إجازات في هذا الشهر" : "No leave in this month"}
                </p>
              ) : (
                <div className="space-y-4">
                  {calendarByEmployee.map(([empId, { name, entries }]) => (
                    <div key={empId} className="border rounded-lg p-3">
                      <p className="font-medium text-sm mb-2">{name}</p>
                      <div className="flex flex-wrap gap-2">
                        {entries.map((e) => {
                          const sc = LEAVE_STATUS_UI[e.status] ?? LEAVE_STATUS_UI.pending;
                          return (
                            <div
                              key={e.requestId}
                              className={cn(
                                "text-xs rounded-md px-2 py-1 border",
                                sc.color.split(" ").slice(0, 2).join(" "),
                              )}
                              title={`${e.startDate} → ${e.endDate}`}
                            >
                              {e.leaveType} · {e.startDate.slice(5)}–{e.endDate.slice(5)}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!approveTarget} onOpenChange={(o) => !o && setApproveTarget(null)}>
        <DialogContent dir={isAr ? "rtl" : "ltr"}>
          <DialogHeader>
            <DialogTitle>{isAr ? "موافقة على الإجازة" : "Approve leave"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              {approveTarget?.employeeName} · {approveTarget?.startDate} → {approveTarget?.endDate}
            </p>
            <Label>{isAr ? "ملاحظة (اختياري)" : "Note (optional)"}</Label>
            <Textarea value={approveNote} onChange={(e) => setApproveNote(e.target.value)} rows={3} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveTarget(null)}>
              {isAr ? "إلغاء" : "Cancel"}
            </Button>
            <Button onClick={() => void handleApprove()} disabled={approveM.isPending}>
              {isAr ? "تأكيد الموافقة" : "Confirm approve"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!rejectTarget} onOpenChange={(o) => !o && setRejectTarget(null)}>
        <DialogContent dir={isAr ? "rtl" : "ltr"}>
          <DialogHeader>
            <DialogTitle>{isAr ? "رفض طلب الإجازة" : "Reject leave request"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              {rejectTarget?.employeeName} · {rejectTarget?.startDate} → {rejectTarget?.endDate}
            </p>
            <Label>
              {isAr ? "سبب الرفض" : "Rejection reason"}
              <span className="text-destructive"> *</span>
            </Label>
            <Textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={4}
              placeholder={isAr ? "مطلوب للتدقيق والامتثال" : "Required for audit and compliance"}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)}>
              {isAr ? "إلغاء" : "Cancel"}
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleReject()}
              disabled={rejectM.isPending || !rejectReason.trim()}
            >
              {isAr ? "تأكيد الرفض" : "Confirm reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
