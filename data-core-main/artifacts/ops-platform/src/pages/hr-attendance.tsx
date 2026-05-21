import { useState, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { apiClient, downloadWithAuth } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Clock, Plus, CalendarDays, Users, CheckCircle2, XCircle,
  AlertCircle, Pencil, Trash2, Calendar, CalendarCheck, Timer,
  ClipboardList, Upload, Download, FileSpreadsheet, AlertTriangle,
  ChevronRight, Activity, Zap, TrendingUp,
} from "lucide-react";
import { fetchLeaveListBridge, LEAVE_STATUS_UI } from "@/lib/leave-bridge";
import { useLeaveCutover, isCanonicalLeaveApprovalUiEnabled } from "@/lib/leave-cutover-flags";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const ATT_STATUS: Record<string, { label: string; labelAr: string; color: string }> = {
  present:  { label: "Present",  labelAr: "حاضر",     color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" },
  absent:   { label: "Absent",   labelAr: "غائب",     color: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" },
  late:     { label: "Late",     labelAr: "متأخر",    color: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300" },
  half_day: { label: "Half Day", labelAr: "نصف يوم",  color: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300" },
  on_leave: { label: "On Leave", labelAr: "إجازة",    color: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300" },
  holiday:  { label: "Holiday",  labelAr: "عطلة",     color: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" },
  remote:   { label: "Remote",   labelAr: "عن بُعد",  color: "bg-cyan-100 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300" },
};

const LEAVE_STATUS = LEAVE_STATUS_UI;

const OT_STATUS: Record<string, { label: string; labelAr: string; color: string }> = {
  draft:    { label: "Draft",    labelAr: "مسودة",         color: "bg-zinc-100 text-zinc-600" },
  pending:  { label: "Pending",  labelAr: "بانتظار الموافقة", color: "bg-amber-100 text-amber-700" },
  approved: { label: "Approved", labelAr: "معتمد",          color: "bg-emerald-100 text-emerald-700" },
  rejected: { label: "Rejected", labelAr: "مرفوض",         color: "bg-red-100 text-red-700" },
  paid:     { label: "Paid",     labelAr: "مدفوع",          color: "bg-blue-100 text-blue-700" },
};

interface ImportRow {
  rowNum: number;
  raw: Record<string, string>;
  employeeNumber?: string;
  employeeId?: number;
  employeeName?: string;
  date?: string;
  checkIn?: string;
  checkOut?: string;
  status?: string;
  overtimeMinutes?: number;
  notes?: string;
  errors: string[];
  warnings: string[];
  isNew: boolean;
}

interface ImportPreview {
  rows: ImportRow[];
  stats: { total: number; valid: number; invalid: number; newRecords: number; updateRecords: number };
}

export default function HrAttendancePage() {
  const { i18n } = useTranslation();
  const isAr = i18n.language.startsWith("ar");
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const leaveCutover = useLeaveCutover();
  const canonicalApprovalUi = isCanonicalLeaveApprovalUiEnabled(leaveCutover.status);

  // ── Main tabs
  const [activeTab, setActiveTab] = useState("attendance");

  // ── Attendance state
  const [attFilter, setAttFilter] = useState({ dateFrom: "", dateTo: "", status: "__all__" });
  const [newAttOpen, setNewAttOpen] = useState(false);
  const [attForm, setAttForm] = useState({ employeeId: "", date: new Date().toISOString().slice(0, 10), status: "present", checkIn: "", checkOut: "", shiftId: "__none__", notes: "" });

  // ── Bulk operations
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkStatus, setBulkStatus] = useState("present");

  // ── Import state
  const [importOpen, setImportOpen] = useState(false);
  const [importStep, setImportStep] = useState<"upload" | "preview" | "confirm">("upload");
  const [importLoading, setImportLoading] = useState(false);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importBatchId, setImportBatchId] = useState<number | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  // ── Shift state
  const [newShiftOpen, setNewShiftOpen] = useState(false);
  const [editingShift, setEditingShift] = useState<Record<string, unknown> | null>(null);
  const [shiftForm, setShiftForm] = useState({ name: "", nameAr: "", startTime: "08:00", endTime: "17:00", breakMinutes: "60", graceMinutes: "15", isFlexible: false });

  // ── Calendar state
  const [newCalendarOpen, setNewCalendarOpen] = useState(false);
  const [calForm, setCalForm] = useState({ name: "", nameAr: "", timezone: "Asia/Riyadh", isDefault: false, workDays: [1, 2, 3, 4, 5] as number[] });

  // ── Leave state
  const [leaveFilter, setLeaveFilter] = useState({ status: "__all__" });

  // ── Balance state
  const [balanceFilter, setBalanceFilter] = useState({ year: String(new Date().getFullYear()) });

  // ── Overtime state
  const [otTab, setOtTab] = useState("records");
  const [otFilter, setOtFilter] = useState({ dateFrom: "", dateTo: "", status: "__all__", employeeId: "" });
  const [otPolicyOpen, setOtPolicyOpen] = useState(false);
  const [editingOtPolicy, setEditingOtPolicy] = useState<Record<string, unknown> | null>(null);
  const [otPolicyForm, setOtPolicyForm] = useState({
    name: "", nameAr: "", dayType: "any", calculationType: "multiplier",
    rateMultiplier: "1.5", fixedRatePerHour: "", maxHoursPerDay: "",
    maxHoursPerMonth: "", minThresholdMinutes: "30",
    requiresApproval: true, autoCalculate: true, notes: "",
  });
  const [otRecordOpen, setOtRecordOpen] = useState(false);
  const [editingOtRecord, setEditingOtRecord] = useState<Record<string, unknown> | null>(null);
  const [otRecordForm, setOtRecordForm] = useState({
    employeeId: "", date: new Date().toISOString().slice(0, 10),
    policyId: "__none__", shiftId: "__none__",
    startTime: "", endTime: "", durationMinutes: "", notes: "",
  });

  const today = new Date().toISOString().slice(0, 10);

  // ── Queries
  const attParams = new URLSearchParams();
  if (attFilter.dateFrom) attParams.set("dateFrom", attFilter.dateFrom);
  if (attFilter.dateTo) attParams.set("dateTo", attFilter.dateTo);
  if (attFilter.status && attFilter.status !== "__all__") attParams.set("status", attFilter.status);

  const attQ      = useQuery({ queryKey: ["/hr/attendance", attFilter], queryFn: () => apiClient.get(`/api/hr/attendance?${attParams}`).then((r) => r.data) });
  const shiftsQ   = useQuery({ queryKey: ["/hr/attendance/shifts"],     queryFn: () => apiClient.get("/api/hr/attendance/shifts").then((r) => r.data) });
  const calsQ     = useQuery({ queryKey: ["/hr/attendance/calendars"],  queryFn: () => apiClient.get("/api/hr/attendance/calendars").then((r) => r.data) });
  const leavesQ   = useQuery({
    queryKey: ["/hr/leave-requests", "admin-bridge", leaveFilter, leaveCutover.legacyFrozen],
    queryFn: () => fetchLeaveListBridge(apiClient, {
      status: leaveFilter.status,
      includeLegacyAdmin: !leaveCutover.legacyFrozen,
    }),
  });
  const balancesQ  = useQuery({ queryKey: ["/hr/leave-balances", balanceFilter], queryFn: () => apiClient.get(`/api/hr/leave-balances?year=${balanceFilter.year}`).then((r) => r.data) });
  const empsQ      = useQuery({ queryKey: ["/hr/employees/list"],       queryFn: () => apiClient.get<{ employees: Record<string, unknown>[] }>("/api/hr/employees?status=active").then((r) => r.data.employees ?? []) });
  const policiesQ  = useQuery({ queryKey: ["/hr/foundation/leave-policies"], queryFn: () => apiClient.get("/api/hr/foundation/leave-policies").then((r) => r.data) });
  const otPoliciesQ = useQuery({ queryKey: ["/hr/overtime/policies"],   queryFn: () => apiClient.get("/api/hr/overtime/policies").then((r) => r.data) });

  const otRecordsParams = new URLSearchParams();
  if (otFilter.dateFrom) otRecordsParams.set("dateFrom", otFilter.dateFrom);
  if (otFilter.dateTo) otRecordsParams.set("dateTo", otFilter.dateTo);
  if (otFilter.status !== "__all__") otRecordsParams.set("status", otFilter.status);
  if (otFilter.employeeId) otRecordsParams.set("employeeId", otFilter.employeeId);
  const otRecordsQ = useQuery({ queryKey: ["/hr/overtime/records", otFilter], queryFn: () => apiClient.get(`/api/hr/overtime/records?${otRecordsParams}`).then((r) => r.data) });

  // ── Derived data
  const attendance  = (attQ.data     ?? []) as Record<string, unknown>[];
  const shifts      = (shiftsQ.data  ?? []) as Record<string, unknown>[];
  const cals        = (calsQ.data    ?? []) as Record<string, unknown>[];
  const leaves      = (leavesQ.data  ?? []) as Record<string, unknown>[];
  const balances    = (balancesQ.data ?? []) as Record<string, unknown>[];
  const emps        = (empsQ.data    ?? []) as Record<string, unknown>[];
  const policies    = (policiesQ.data ?? []) as Record<string, unknown>[];
  const otPolicies  = (otPoliciesQ.data ?? []) as Record<string, unknown>[];
  const otRecords   = (otRecordsQ.data ?? []) as Record<string, unknown>[];

  const shiftFormData = editingShift ?? shiftForm;
  const DAY_LABELS    = isAr ? ["الأحد","الاثنين","الثلاثاء","الأربعاء","الخميس","الجمعة","السبت"] : ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

  // ── Mutations: Attendance
  const createAtt = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiClient.post("/api/hr/attendance", body).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/hr/attendance"] }); setNewAttOpen(false); toast({ title: isAr ? "تم التسجيل" : "Attendance recorded" }); },
    onError:   () => toast({ title: isAr ? "حدث خطأ" : "Error", variant: "destructive" }),
  });

  const bulkUpdateAtt = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiClient.post("/api/hr/attendance/bulk", body).then((r) => r.data),
    onSuccess: (d: Record<string, unknown>) => {
      qc.invalidateQueries({ queryKey: ["/hr/attendance"] });
      setSelectedIds(new Set());
      setBulkOpen(false);
      toast({ title: isAr ? `تم تحديث ${d.updated} سجل` : `Updated ${d.updated} records` });
    },
    onError: () => toast({ title: isAr ? "حدث خطأ" : "Error", variant: "destructive" }),
  });

  const approveLeave = useMutation({
    mutationFn: async ({
      id,
      status,
      source,
    }: { id: number; status: string; source: "legacy" | "canonical" }) => {
      if (source === "canonical" && canonicalApprovalUi) {
        const path = status === "approved"
          ? `/api/hr/leave-requests/${id}/approve`
          : `/api/hr/leave-requests/${id}/reject`;
        return apiClient.patch(path, {}).then((r) => r.data);
      }
      return apiClient.patch(`/api/hr/attendance/leaves/${id}`, { status }).then((r) => r.data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/hr/leave-requests"] });
      qc.invalidateQueries({ queryKey: ["/hr/attendance/leaves"] });
      qc.invalidateQueries({ queryKey: ["/hr/leave-balances"] });
      toast({ title: isAr ? "تم التحديث" : "Updated" });
    },
  });

  // ── Mutations: Shifts / Calendars
  const createShift = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiClient.post("/api/hr/attendance/shifts", body).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/hr/attendance/shifts"] }); setNewShiftOpen(false); setEditingShift(null); toast({ title: isAr ? "تم الحفظ" : "Saved" }); },
  });
  const updateShift = useMutation({
    mutationFn: ({ id, ...body }: Record<string, unknown>) => apiClient.patch(`/api/hr/attendance/shifts/${id}`, body).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/hr/attendance/shifts"] }); setEditingShift(null); setNewShiftOpen(false); toast({ title: isAr ? "تم التحديث" : "Updated" }); },
  });
  const deleteShift = useMutation({
    mutationFn: (id: number) => apiClient.delete(`/api/hr/attendance/shifts/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/hr/attendance/shifts"] }); },
  });
  const createCal = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiClient.post("/api/hr/attendance/calendars", body).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/hr/attendance/calendars"] }); setNewCalendarOpen(false); toast({ title: isAr ? "تم الحفظ" : "Saved" }); },
  });
  const bulkInitBalances = useMutation({
    mutationFn: ({ leavePolicyId, year }: { leavePolicyId: number; year: number }) =>
      apiClient.post("/api/hr/leave-balances/bulk-init", { leavePolicyId, year }).then((r) => r.data),
    onSuccess: (d: Record<string, unknown>) => { qc.invalidateQueries({ queryKey: ["/hr/leave-balances"] }); toast({ title: isAr ? `تم التهيئة: ${d.created} موظف` : `Initialized: ${d.created} employees` }); },
  });

  // ── Mutations: Overtime
  const createOtPolicy = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiClient.post("/api/hr/overtime/policies", body).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/hr/overtime/policies"] }); setOtPolicyOpen(false); setEditingOtPolicy(null); toast({ title: isAr ? "تم حفظ السياسة" : "Policy saved" }); },
    onError:   () => toast({ title: isAr ? "حدث خطأ" : "Error", variant: "destructive" }),
  });
  const updateOtPolicy = useMutation({
    mutationFn: ({ id, ...body }: Record<string, unknown>) => apiClient.patch(`/api/hr/overtime/policies/${id}`, body).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/hr/overtime/policies"] }); setOtPolicyOpen(false); setEditingOtPolicy(null); toast({ title: isAr ? "تم التحديث" : "Updated" }); },
  });
  const deleteOtPolicy = useMutation({
    mutationFn: (id: number) => apiClient.delete(`/api/hr/overtime/policies/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/hr/overtime/policies"] }); toast({ title: isAr ? "تم الحذف" : "Deleted" }); },
  });
  const createOtRecord = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiClient.post("/api/hr/overtime/records", body).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/hr/overtime/records"] }); setOtRecordOpen(false); setEditingOtRecord(null); toast({ title: isAr ? "تم حفظ سجل الأوفرتايم" : "Overtime record saved" }); },
    onError:   () => toast({ title: isAr ? "حدث خطأ" : "Error", variant: "destructive" }),
  });
  const updateOtRecord = useMutation({
    mutationFn: ({ id, ...body }: Record<string, unknown>) => apiClient.patch(`/api/hr/overtime/records/${id}`, body).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/hr/overtime/records"] }); setOtRecordOpen(false); setEditingOtRecord(null); toast({ title: isAr ? "تم التحديث" : "Updated" }); },
  });
  const deleteOtRecord = useMutation({
    mutationFn: (id: number) => apiClient.delete(`/api/hr/overtime/records/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/hr/overtime/records"] }); toast({ title: isAr ? "تم الحذف" : "Deleted" }); },
  });
  const approveOtRecord = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => apiClient.patch(`/api/hr/overtime/records/${id}`, { status }).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/hr/overtime/records"] }); toast({ title: isAr ? "تم تحديث الحالة" : "Status updated" }); },
  });
  const calculateOt = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiClient.post("/api/hr/overtime/calculate", body).then((r) => r.data),
    onSuccess: (d: Record<string, unknown>) => {
      qc.invalidateQueries({ queryKey: ["/hr/overtime/records"] });
      toast({ title: isAr ? `تم إنشاء ${d.created} سجل أوفرتايم` : `Created ${d.created} overtime records` });
    },
    onError: () => toast({ title: isAr ? "حدث خطأ في الحساب" : "Calculation error", variant: "destructive" }),
  });

  // ── Import helpers
  const parseFileToRows = useCallback((file: File): Promise<Record<string, string>[]> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target!.result as ArrayBuffer);
          const wb = XLSX.read(data, { type: "array" });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { raw: false, defval: "" });
          resolve(rows);
        } catch {
          reject(new Error("Failed to parse file"));
        }
      };
      reader.onerror = () => reject(new Error("File read error"));
      reader.readAsArrayBuffer(file);
    });
  }, []);

  const handleFileSelect = useCallback(async (file: File) => {
    if (!file) return;
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!["xlsx", "xls", "csv"].includes(ext ?? "")) {
      toast({ title: isAr ? "نوع الملف غير مدعوم" : "Unsupported file type", description: "xlsx, xls, csv", variant: "destructive" });
      return;
    }
    setImportLoading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(
        `${BASE}/api/hr/workforce/imports/dry-run?templateKey=attendance.period.default.v1`,
        { method: "POST", body: fd, credentials: "include" },
      );
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? res.statusText);
      }
      const result = (await res.json()) as ImportPreview & { batchId: number };
      setImportBatchId(result.batchId);
      setImportPreview({ rows: result.rows, stats: result.stats });
      setImportStep("preview");
    } catch (e) {
      toast({
        title: isAr ? "خطأ في قراءة الملف" : "File parse error",
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      });
    } finally {
      setImportLoading(false);
    }
  }, [BASE, isAr, toast]);

  const handleImportConfirm = useCallback(async () => {
    if (!importPreview || !importBatchId) return;
    setImportLoading(true);
    try {
      const result = await apiClient
        .post<{
          reconciliation: { inserted: number; updated: number; failed: number };
          reconciliationReportId: number;
        }>(`/api/hr/workforce/imports/${importBatchId}/confirm`)
        .then((r) => r.data);
      qc.invalidateQueries({ queryKey: ["/hr/attendance"] });
      const rec = result.reconciliation;
      toast({
        title: isAr
          ? `تم الاستيراد: ${rec.inserted} جديد، ${rec.updated} تحديث`
          : `Imported: ${rec.inserted} new, ${rec.updated} updated`,
        description: rec.failed > 0 ? (isAr ? `${rec.failed} فشل` : `${rec.failed} failed`) : undefined,
      });
      setImportOpen(false);
      setImportStep("upload");
      setImportPreview(null);
      setImportBatchId(null);
    } catch {
      toast({ title: isAr ? "خطأ في الاستيراد" : "Import error", variant: "destructive" });
    } finally {
      setImportLoading(false);
    }
  }, [importPreview, importBatchId, isAr, qc, toast]);

  const handleDownloadTemplate = useCallback(async () => {
    try {
      await downloadWithAuth(
        `${BASE}/api/hr/workforce/imports/templates/attendance.period.default.v1/download`,
        "attendance_template_v1.xlsx",
      );
    } catch {
      toast({ title: isAr ? "خطأ في التحميل" : "Download error", variant: "destructive" });
    }
  }, [BASE, isAr, toast]);

  const { data: importHistory } = useQuery({
    queryKey: ["/hr/workforce/imports/history"],
    queryFn: () =>
      apiClient
        .get<{ imports: Array<{ batch: { id: number; status: string; createdAt: string }; job: { dryRun: boolean } }> }>(
          "/api/hr/workforce/imports/history",
        )
        .then((r) => r.data.imports),
    enabled: importOpen,
  });

  const handleExport = useCallback(async (format: "xlsx" | "csv") => {
    const p = new URLSearchParams({ format });
    if (attFilter.dateFrom) p.set("dateFrom", attFilter.dateFrom);
    if (attFilter.dateTo) p.set("dateTo", attFilter.dateTo);
    if (attFilter.status !== "__all__") p.set("status", attFilter.status);
    try {
      await downloadWithAuth(`${BASE}/api/hr/attendance/export?${p}`, `attendance_export.${format}`);
    } catch {
      toast({ title: isAr ? "خطأ في التصدير" : "Export error", variant: "destructive" });
    }
  }, [attFilter, BASE, isAr, toast]);

  // ── Toggle select
  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleSelectAll = () => {
    if (selectedIds.size === attendance.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(attendance.map((a) => Number(a.id))));
    }
  };

  // ── OT policy form helpers
  const otPolicyFormData = editingOtPolicy ?? otPolicyForm;
  const setOtPolicyField = (k: string, v: unknown) => {
    if (editingOtPolicy) setEditingOtPolicy((f) => ({ ...f!, [k]: v }));
    else setOtPolicyForm((f) => ({ ...f, [k]: v }));
  };
  const otRecordFormData = editingOtRecord ?? otRecordForm;
  const setOtRecordField = (k: string, v: unknown) => {
    if (editingOtRecord) setEditingOtRecord((f) => ({ ...f!, [k]: v }));
    else setOtRecordForm((f) => ({ ...f, [k]: v }));
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6" dir={isAr ? "rtl" : "ltr"}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{isAr ? "محرك الحضور والإجازات" : "Attendance & Leave"}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{isAr ? "تسجيل الحضور · الإجازات · الأرصدة · الأوفرتايم · الاستيراد/التصدير" : "Attendance · Leave · Balances · Overtime · Import/Export"}</p>
        </div>
        <Link href={`${BASE}/hr`}><Button variant="outline" size="sm">{isAr ? "لوحة HR" : "HR Hub"}</Button></Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { icon: CheckCircle2, label: isAr ? "حاضر اليوم" : "Present Today",    value: attendance.filter((a) => a.date === today && a.status === "present").length, color: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950" },
          { icon: AlertCircle,  label: isAr ? "طلبات معلقة" : "Pending Leaves",  value: leaves.filter((l) => l.status === "pending" || l.status === "pending_approval").length, color: "bg-amber-50 text-amber-600 dark:bg-amber-950" },
          { icon: Zap,          label: isAr ? "أوفرتايم معلق" : "OT Pending",    value: otRecords.filter((r) => r.status === "pending").length,                        color: "bg-orange-50 text-orange-600 dark:bg-orange-950" },
          { icon: TrendingUp,   label: isAr ? "سياسات الأوفرتايم" : "OT Policies", value: otPolicies.filter((p) => p.isActive).length,                                color: "bg-violet-50 text-violet-600 dark:bg-violet-950" },
        ].map(({ icon: Icon, label, value, color }) => (
          <Card key={label}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${color}`}><Icon className="w-5 h-5" /></div>
              <div><p className="text-xs text-muted-foreground">{label}</p><p className="text-xl font-bold">{value}</p></div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="attendance">{isAr ? "الحضور" : "Attendance"}</TabsTrigger>
          <TabsTrigger value="leaves">{isAr ? "الإجازات" : "Leaves"}</TabsTrigger>
          <TabsTrigger value="balances">{isAr ? "الأرصدة" : "Balances"}</TabsTrigger>
          <TabsTrigger value="overtime">{isAr ? "الأوفرتايم" : "Overtime"}</TabsTrigger>
          <TabsTrigger value="shifts">{isAr ? "الشيفتات" : "Shifts"}</TabsTrigger>
          <TabsTrigger value="calendars">{isAr ? "التقويمات" : "Calendars"}</TabsTrigger>
        </TabsList>

        {/* ─── ATTENDANCE TAB ──────────────────────────────────────────────────── */}
        <TabsContent value="attendance" className="space-y-4">
          <div className="flex flex-wrap gap-2 items-end justify-between">
            {/* Filters */}
            <div className="flex flex-wrap gap-2 items-end">
              <div className="space-y-1">
                <Label className="text-xs">{isAr ? "من" : "From"}</Label>
                <Input type="date" className="h-8 text-sm" value={attFilter.dateFrom} onChange={(e) => setAttFilter((f) => ({ ...f, dateFrom: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{isAr ? "إلى" : "To"}</Label>
                <Input type="date" className="h-8 text-sm" value={attFilter.dateTo} onChange={(e) => setAttFilter((f) => ({ ...f, dateTo: e.target.value }))} />
              </div>
              <Select value={attFilter.status} onValueChange={(v) => setAttFilter((f) => ({ ...f, status: v }))}>
                <SelectTrigger className="h-8 text-sm w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">{isAr ? "كل الحالات" : "All statuses"}</SelectItem>
                  {Object.entries(ATT_STATUS).map(([k, v]) => <SelectItem key={k} value={k}>{isAr ? v.labelAr : v.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {/* Action buttons */}
            <div className="flex flex-wrap gap-2">
              {selectedIds.size > 0 && (
                <Button size="sm" variant="outline" onClick={() => setBulkOpen(true)}>
                  <Users className="w-4 h-4 me-1" />{isAr ? `تعديل ${selectedIds.size} سجل` : `Bulk edit (${selectedIds.size})`}
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => handleExport("csv")}>
                <Download className="w-4 h-4 me-1" />CSV
              </Button>
              <Button size="sm" variant="outline" onClick={() => handleExport("xlsx")}>
                <FileSpreadsheet className="w-4 h-4 me-1" />Excel
              </Button>
              <Button size="sm" variant="outline" onClick={() => { setImportOpen(true); setImportStep("upload"); setImportPreview(null); }}>
                <Upload className="w-4 h-4 me-1" />{isAr ? "استيراد" : "Import"}
              </Button>
              <Button size="sm" onClick={() => setNewAttOpen(true)}>
                <Plus className="w-4 h-4 me-1" />{isAr ? "تسجيل حضور" : "Record"}
              </Button>
            </div>
          </div>

          {attQ.isLoading ? (
            <div className="space-y-2">{[1,2,3,4].map((i) => <div key={i} className="h-12 bg-muted animate-pulse rounded" />)}</div>
          ) : attendance.length === 0 ? (
            <Card><CardContent className="p-8 text-center text-muted-foreground"><Clock className="w-10 h-10 mx-auto mb-2 opacity-30" /><p>{isAr ? "لا توجد سجلات" : "No attendance records"}</p></CardContent></Card>
          ) : (
            <div className="rounded-lg border overflow-hidden">
              <div className="grid grid-cols-[32px_1fr_auto_auto_auto_auto] gap-2 p-2 bg-muted/40 text-xs font-semibold text-muted-foreground items-center">
                <Checkbox checked={selectedIds.size === attendance.length && attendance.length > 0} onCheckedChange={toggleSelectAll} />
                <span>{isAr ? "الموظف" : "Employee"}</span>
                <span>{isAr ? "التاريخ" : "Date"}</span>
                <span>{isAr ? "الدخول / الخروج" : "In / Out"}</span>
                <span>{isAr ? "الشيفت" : "Shift"}</span>
                <span>{isAr ? "الحالة" : "Status"}</span>
              </div>
              {attendance.map((a) => {
                const sc = ATT_STATUS[String(a.status)] ?? ATT_STATUS.present;
                const id = Number(a.id);
                return (
                  <div key={id} className={`grid grid-cols-[32px_1fr_auto_auto_auto_auto] gap-2 p-2.5 items-center text-sm border-t hover:bg-muted/20 ${selectedIds.has(id) ? "bg-primary/5" : ""}`}>
                    <Checkbox checked={selectedIds.has(id)} onCheckedChange={() => toggleSelect(id)} />
                    <div>
                      <p className="font-medium truncate">{String(a.employeeName ?? "-")}</p>
                      <p className="text-xs text-muted-foreground">{String(a.employeeNumber ?? "")}</p>
                    </div>
                    <span className="text-muted-foreground text-xs">{String(a.date)}</span>
                    <span className="text-muted-foreground text-xs">{[a.checkIn, a.checkOut].filter(Boolean).join(" → ") || "-"}</span>
                    <span className="text-muted-foreground text-xs truncate max-w-[80px]">{String(a.shiftName ?? "-")}</span>
                    <Badge className={`text-xs w-fit ${sc.color}`}>{isAr ? sc.labelAr : sc.label}</Badge>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ─── LEAVES TAB ──────────────────────────────────────────────────────── */}
        <TabsContent value="leaves" className="space-y-4">
          {leaveCutover.isPilotWorkspace && leaveCutover.legacyFrozen && (
            <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
              {isAr
                ? "مسار الإجازات الجديد مفعّل لهذه المنشأة — الموافقات عبر النظام الموحّد."
                : "Canonical leave cutover is active for this workspace — approvals use the unified leave API."}
            </div>
          )}
          <div className="flex justify-between items-center flex-wrap gap-2">
            <Select value={leaveFilter.status} onValueChange={(v) => setLeaveFilter({ status: v })}>
              <SelectTrigger className="h-8 text-sm w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">{isAr ? "كل الحالات" : "All statuses"}</SelectItem>
                {Object.entries(LEAVE_STATUS).filter(([k]) => k !== "withdrawn").map(([k, v]) => <SelectItem key={k} value={k}>{isAr ? v.labelAr : v.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {leavesQ.isLoading ? (
            <div className="space-y-2">{[1,2,3].map((i) => <div key={i} className="h-14 bg-muted animate-pulse rounded" />)}</div>
          ) : leaves.length === 0 ? (
            <Card><CardContent className="p-8 text-center text-muted-foreground"><CalendarCheck className="w-10 h-10 mx-auto mb-2 opacity-30" /><p>{isAr ? "لا توجد طلبات إجازة" : "No leave requests"}</p></CardContent></Card>
          ) : (
            <div className="space-y-2">
              {leaves.map((l: { source?: string; status: string; id: number; legacyApproveId?: number }) => {
                const sc = LEAVE_STATUS[l.status] ?? LEAVE_STATUS.pending;
                const legacyPending =
                  l.source === "legacy" && l.status === "pending" && !leaveCutover.legacyFrozen;
                const canonicalPending =
                  l.source === "canonical" &&
                  (l.status === "pending_approval" || l.status === "pending");
                return (
                  <Card key={`${l.source}-${l.id}`}>
                    <CardContent className="p-4 flex items-center gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium">{l.employeeName ?? "-"}</span>
                          <Badge className={`text-xs ${sc.color}`}>{isAr ? sc.labelAr : sc.label}</Badge>
                          <span className="text-xs text-muted-foreground">{l.leaveType}</span>
                          {l.source === "canonical" && (
                            <Badge variant="outline" className="text-xs">{isAr ? "نظام جديد" : "Canonical"}</Badge>
                          )}
                          {canonicalPending && !canonicalApprovalUi && (
                            <Badge variant="outline" className="text-xs text-amber-700 border-amber-300 dark:text-amber-300">
                              {isAr ? "موافقة عبر المسار الجديد — قيد التفعيل" : "Canonical approval — P18-D4"}
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {l.startDate} → {l.endDate}
                          {l.daysCount != null ? ` · ${l.daysCount} ${isAr ? "يوم" : "days"}` : ""}
                          {l.requestNumber ? ` · ${l.requestNumber}` : ""}
                        </p>
                        {l.reason && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{l.reason}</p>}
                      </div>
                      {legacyPending && l.legacyApproveId != null && (
                        <div className="flex gap-2 shrink-0">
                          <Button size="sm" variant="outline" className="text-emerald-600 border-emerald-200 hover:bg-emerald-50" onClick={() => approveLeave.mutate({ id: l.legacyApproveId!, status: "approved", source: "legacy" })}>
                            <CheckCircle2 className="w-3.5 h-3.5 me-1" />{isAr ? "موافقة" : "Approve"}
                          </Button>
                          <Button size="sm" variant="outline" className="text-red-600 border-red-200 hover:bg-red-50" onClick={() => approveLeave.mutate({ id: l.legacyApproveId!, status: "rejected", source: "legacy" })}>
                            <XCircle className="w-3.5 h-3.5 me-1" />{isAr ? "رفض" : "Reject"}
                          </Button>
                        </div>
                      )}
                      {canonicalPending && canonicalApprovalUi && (
                        <div className="flex gap-2 shrink-0">
                          <Button size="sm" variant="outline" className="text-emerald-600 border-emerald-200 hover:bg-emerald-50" onClick={() => approveLeave.mutate({ id: l.id, status: "approved", source: "canonical" })}>
                            <CheckCircle2 className="w-3.5 h-3.5 me-1" />{isAr ? "موافقة" : "Approve"}
                          </Button>
                          <Button size="sm" variant="outline" className="text-red-600 border-red-200 hover:bg-red-50" onClick={() => approveLeave.mutate({ id: l.id, status: "rejected", source: "canonical" })}>
                            <XCircle className="w-3.5 h-3.5 me-1" />{isAr ? "رفض" : "Reject"}
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ─── BALANCES TAB ─────────────────────────────────────────────────────── */}
        <TabsContent value="balances" className="space-y-4">
          <div className="flex justify-between items-center flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <Label className="text-sm">{isAr ? "السنة:" : "Year:"}</Label>
              <Input type="number" className="h-8 w-24 text-sm" value={balanceFilter.year} onChange={(e) => setBalanceFilter({ year: e.target.value })} />
            </div>
            {policies.length > 0 && (
              <Button size="sm" variant="outline" onClick={() => {
                const first = policies[0] as Record<string, unknown>;
                bulkInitBalances.mutate({ leavePolicyId: Number(first.id), year: Number(balanceFilter.year) });
              }} disabled={bulkInitBalances.isPending}>
                <Users className="w-4 h-4 me-1" />{isAr ? "تهيئة الأرصدة للكل" : "Bulk Initialize"}
              </Button>
            )}
          </div>
          {balancesQ.isLoading ? (
            <div className="space-y-2">{[1,2,3].map((i) => <div key={i} className="h-14 bg-muted animate-pulse rounded" />)}</div>
          ) : balances.length === 0 ? (
            <Card><CardContent className="p-8 text-center text-muted-foreground"><ClipboardList className="w-10 h-10 mx-auto mb-2 opacity-30" /><p>{isAr ? "لا توجد أرصدة إجازات" : "No leave balances"}</p></CardContent></Card>
          ) : (
            <div className="rounded-lg border overflow-hidden">
              <div className="grid grid-cols-6 gap-2 p-2 bg-muted/40 text-xs font-semibold text-muted-foreground">
                <span className="col-span-2">{isAr ? "الموظف" : "Employee"}</span>
                <span>{isAr ? "السياسة" : "Policy"}</span>
                <span>{isAr ? "المستحق" : "Entitled"}</span>
                <span>{isAr ? "المستخدم" : "Used"}</span>
                <span>{isAr ? "المتبقي" : "Remaining"}</span>
              </div>
              {balances.map((b) => {
                const entitled  = parseFloat(String(b.entitled))         || 0;
                const used      = parseFloat(String(b.used))             || 0;
                const carried   = parseFloat(String(b.carriedForward))   || 0;
                const adj       = parseFloat(String(b.manualAdjustment)) || 0;
                const remaining = entitled + carried + adj - used;
                return (
                  <div key={String(b.id)} className="grid grid-cols-6 gap-2 p-2.5 items-center text-sm border-t hover:bg-muted/20">
                    <div className="col-span-2">
                      <p className="font-medium truncate">{String(b.employeeName ?? "-")}</p>
                      <p className="text-xs text-muted-foreground">{String(b.employeeNumber ?? "")}</p>
                    </div>
                    <span className="text-xs text-muted-foreground truncate">{String(b.policyName ?? b.leaveType ?? "-")}</span>
                    <span className="font-medium">{entitled}</span>
                    <span className="text-red-600">{used}</span>
                    <span className={`font-bold ${remaining < 0 ? "text-red-600" : "text-emerald-600"}`}>{remaining}</span>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ─── OVERTIME TAB ─────────────────────────────────────────────────────── */}
        <TabsContent value="overtime" className="space-y-4">
          <Tabs value={otTab} onValueChange={setOtTab}>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <TabsList>
                <TabsTrigger value="records">{isAr ? "سجلات الأوفرتايم" : "OT Records"}</TabsTrigger>
                <TabsTrigger value="policies">{isAr ? "السياسات" : "Policies"}</TabsTrigger>
              </TabsList>
              {otTab === "policies" ? (
                <Button size="sm" onClick={() => { setOtPolicyForm({ name: "", nameAr: "", dayType: "any", calculationType: "multiplier", rateMultiplier: "1.5", fixedRatePerHour: "", maxHoursPerDay: "", maxHoursPerMonth: "", minThresholdMinutes: "30", requiresApproval: true, autoCalculate: true, notes: "" }); setEditingOtPolicy(null); setOtPolicyOpen(true); }}>
                  <Plus className="w-4 h-4 me-1" />{isAr ? "سياسة جديدة" : "New Policy"}
                </Button>
              ) : (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => calculateOt.mutate({ dateFrom: attFilter.dateFrom || undefined, dateTo: attFilter.dateTo || undefined })} disabled={calculateOt.isPending}>
                    <Activity className="w-4 h-4 me-1" />{isAr ? "احتساب تلقائي" : "Auto Calculate"}
                  </Button>
                  <Button size="sm" onClick={() => { setOtRecordForm({ employeeId: "", date: today, policyId: "__none__", shiftId: "__none__", startTime: "", endTime: "", durationMinutes: "", notes: "" }); setEditingOtRecord(null); setOtRecordOpen(true); }}>
                    <Plus className="w-4 h-4 me-1" />{isAr ? "سجل يدوي" : "Manual Entry"}
                  </Button>
                </div>
              )}
            </div>

            {/* ── OT Records ─── */}
            <TabsContent value="records" className="space-y-3 mt-3">
              <div className="flex flex-wrap gap-2 items-end">
                <div className="space-y-1">
                  <Label className="text-xs">{isAr ? "من" : "From"}</Label>
                  <Input type="date" className="h-8 text-sm" value={otFilter.dateFrom} onChange={(e) => setOtFilter((f) => ({ ...f, dateFrom: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{isAr ? "إلى" : "To"}</Label>
                  <Input type="date" className="h-8 text-sm" value={otFilter.dateTo} onChange={(e) => setOtFilter((f) => ({ ...f, dateTo: e.target.value }))} />
                </div>
                <Select value={otFilter.status} onValueChange={(v) => setOtFilter((f) => ({ ...f, status: v }))}>
                  <SelectTrigger className="h-8 text-sm w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">{isAr ? "كل الحالات" : "All statuses"}</SelectItem>
                    {Object.entries(OT_STATUS).map(([k, v]) => <SelectItem key={k} value={k}>{isAr ? v.labelAr : v.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              {otRecordsQ.isLoading ? (
                <div className="space-y-2">{[1,2,3].map((i) => <div key={i} className="h-14 bg-muted animate-pulse rounded" />)}</div>
              ) : otRecords.length === 0 ? (
                <Card><CardContent className="p-8 text-center text-muted-foreground"><Zap className="w-10 h-10 mx-auto mb-2 opacity-30" /><p>{isAr ? "لا توجد سجلات أوفرتايم" : "No overtime records"}</p></CardContent></Card>
              ) : (
                <div className="rounded-lg border overflow-hidden">
                  <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-2 p-2 bg-muted/40 text-xs font-semibold text-muted-foreground">
                    <span>{isAr ? "الموظف / التاريخ" : "Employee / Date"}</span>
                    <span>{isAr ? "المدة" : "Duration"}</span>
                    <span>{isAr ? "المبلغ" : "Amount"}</span>
                    <span>{isAr ? "الحالة" : "Status"}</span>
                    <span>{isAr ? "إجراء" : "Action"}</span>
                  </div>
                  {otRecords.map((r) => {
                    const sc = OT_STATUS[String(r.status)] ?? OT_STATUS.draft;
                    const mins = Number(r.durationMinutes) || 0;
                    return (
                      <div key={String(r.id)} className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-2 p-2.5 items-center text-sm border-t hover:bg-muted/20">
                        <div>
                          <p className="font-medium">{String(r.employeeName ?? "-")}</p>
                          <p className="text-xs text-muted-foreground">{String(r.date)} {r.startTime ? `· ${r.startTime}-${r.endTime ?? ""}` : ""}</p>
                        </div>
                        <span className="text-sm font-mono">{Math.floor(mins/60)}h {mins%60}m</span>
                        <span className="text-sm">{r.calculatedAmount ? String(r.calculatedAmount) : "-"}</span>
                        <Badge className={`text-xs w-fit ${sc.color}`}>{isAr ? sc.labelAr : sc.label}</Badge>
                        <div className="flex gap-1">
                          {r.status === "pending" && (
                            <>
                              <Button size="icon" variant="ghost" className="h-7 w-7 text-emerald-600" onClick={() => approveOtRecord.mutate({ id: Number(r.id), status: "approved" })}><CheckCircle2 className="w-3.5 h-3.5" /></Button>
                              <Button size="icon" variant="ghost" className="h-7 w-7 text-red-600" onClick={() => approveOtRecord.mutate({ id: Number(r.id), status: "rejected" })}><XCircle className="w-3.5 h-3.5" /></Button>
                            </>
                          )}
                          {r.status === "draft" && (
                            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => approveOtRecord.mutate({ id: Number(r.id), status: "pending" })}>
                              {isAr ? "إرسال" : "Submit"}
                            </Button>
                          )}
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditingOtRecord({ ...r }); setOtRecordOpen(true); }}><Pencil className="w-3.5 h-3.5" /></Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => deleteOtRecord.mutate(Number(r.id))}><Trash2 className="w-3.5 h-3.5" /></Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </TabsContent>

            {/* ── OT Policies ─── */}
            <TabsContent value="policies" className="space-y-3 mt-3">
              {otPoliciesQ.isLoading ? (
                <div className="space-y-2">{[1,2].map((i) => <div key={i} className="h-20 bg-muted animate-pulse rounded" />)}</div>
              ) : otPolicies.length === 0 ? (
                <Card><CardContent className="p-8 text-center text-muted-foreground"><TrendingUp className="w-10 h-10 mx-auto mb-2 opacity-30" /><p>{isAr ? "لا توجد سياسات أوفرتايم" : "No overtime policies"}</p></CardContent></Card>
              ) : (
                <div className="grid sm:grid-cols-2 gap-3">
                  {otPolicies.map((p) => {
                    const dayTypeLabel: Record<string, string> = { any: isAr ? "أي يوم" : "Any day", weekday: isAr ? "يوم عمل" : "Weekday", weekend: isAr ? "عطلة أسبوعية" : "Weekend", holiday: isAr ? "إجازة رسمية" : "Holiday" };
                    const calcLabel: Record<string, string> = { multiplier: isAr ? "مضاعف" : "Multiplier", fixed_rate: isAr ? "سعر ثابت/ساعة" : "Fixed rate/hr", custom: isAr ? "مخصص" : "Custom" };
                    return (
                      <Card key={String(p.id)} className={Boolean(p.isActive) ? "" : "opacity-60"}>
                        <CardContent className="p-4">
                          <div className="flex justify-between items-start gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-semibold">{isAr && p.nameAr ? String(p.nameAr) : String(p.name)}</span>
                                {!p.isActive && <Badge className="text-xs bg-zinc-100 text-zinc-500">{isAr ? "غير نشط" : "Inactive"}</Badge>}
                              </div>
                              <p className="text-xs text-muted-foreground mt-1">
                                {dayTypeLabel[String(p.dayType)] ?? String(p.dayType)} ·{" "}
                                {calcLabel[String(p.calculationType)] ?? String(p.calculationType)}
                                {p.calculationType === "multiplier" ? ` × ${p.rateMultiplier}` : ""}
                                {p.calculationType === "fixed_rate" && p.fixedRatePerHour ? ` ${p.fixedRatePerHour}/${isAr ? "ساعة" : "hr"}` : ""}
                              </p>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {isAr ? "حد أدنى:" : "Min threshold:"} {String(p.minThresholdMinutes ?? 0)} {isAr ? "دقيقة" : "min"}
                                {p.maxHoursPerDay ? ` · ${isAr ? "أقصى/يوم:" : "Max/day:"} ${String(p.maxHoursPerDay)}h` : ""}
                                {Boolean(p.requiresApproval) ? ` · ${isAr ? "يتطلب موافقة" : "Requires approval"}` : ""}
                              </p>
                            </div>
                            <div className="flex gap-1 shrink-0">
                              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditingOtPolicy({ ...p }); setOtPolicyOpen(true); }}><Pencil className="w-3.5 h-3.5" /></Button>
                              <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => deleteOtPolicy.mutate(Number(p.id))}><Trash2 className="w-3.5 h-3.5" /></Button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </TabsContent>

        {/* ─── SHIFTS TAB ───────────────────────────────────────────────────────── */}
        <TabsContent value="shifts" className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-muted-foreground">{isAr ? `${shifts.length} شيفت` : `${shifts.length} shifts`}</p>
            <Button size="sm" onClick={() => { setShiftForm({ name: "", nameAr: "", startTime: "08:00", endTime: "17:00", breakMinutes: "60", graceMinutes: "15", isFlexible: false }); setEditingShift(null); setNewShiftOpen(true); }}>
              <Plus className="w-4 h-4 me-1" />{isAr ? "شيفت جديد" : "New Shift"}
            </Button>
          </div>
          {shifts.length === 0 ? (
            <Card><CardContent className="p-8 text-center text-muted-foreground"><Timer className="w-10 h-10 mx-auto mb-2 opacity-30" /><p>{isAr ? "لا توجد شيفتات" : "No shifts defined"}</p></CardContent></Card>
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              {shifts.map((s) => (
                <Card key={String(s.id)}>
                  <CardContent className="p-4">
                    <div className="flex justify-between items-start gap-2">
                      <div>
                        <p className="font-semibold">{String(s.name)}</p>
                        {Boolean(s.nameAr) && <p className="text-sm text-muted-foreground">{String(s.nameAr)}</p>}
                        <p className="text-sm mt-1"><Clock className="w-3.5 h-3.5 inline me-1 text-muted-foreground" />{String(s.startTime)} - {String(s.endTime)}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {isAr ? "استراحة:" : "Break:"} {String(s.breakMinutes)} {isAr ? "دقيقة" : "min"} ·
                          {isAr ? " سماحية:" : " Grace:"} {String(s.graceMinutes)} {isAr ? "دقيقة" : "min"}
                          {s.isFlexible ? ` · ${isAr ? "مرن" : "Flexible"}` : ""}
                        </p>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditingShift({ ...s }); setNewShiftOpen(true); }}><Pencil className="w-3.5 h-3.5" /></Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => deleteShift.mutate(Number(s.id))}><Trash2 className="w-3.5 h-3.5" /></Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ─── CALENDARS TAB ────────────────────────────────────────────────────── */}
        <TabsContent value="calendars" className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-muted-foreground">{isAr ? `${cals.length} تقويم` : `${cals.length} calendars`}</p>
            <Button size="sm" onClick={() => setNewCalendarOpen(true)}><Plus className="w-4 h-4 me-1" />{isAr ? "تقويم جديد" : "New Calendar"}</Button>
          </div>
          {cals.length === 0 ? (
            <Card><CardContent className="p-8 text-center text-muted-foreground"><Calendar className="w-10 h-10 mx-auto mb-2 opacity-30" /><p>{isAr ? "لا توجد تقويمات" : "No calendars"}</p></CardContent></Card>
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              {cals.map((c) => {
                const workDays = (c.workDays as number[]) ?? [];
                return (
                  <Card key={String(c.id)}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold">{String(c.name)}</span>
                            {Boolean(c.isDefault) && <Badge className="text-xs bg-primary/10 text-primary">{isAr ? "افتراضي" : "Default"}</Badge>}
                          </div>
                          {Boolean(c.nameAr) && <p className="text-sm text-muted-foreground">{String(c.nameAr)}</p>}
                          <div className="flex gap-1 mt-2 flex-wrap">
                            {[0,1,2,3,4,5,6].map((d) => (
                              <span key={d} className={`text-xs px-1.5 py-0.5 rounded ${workDays.includes(d) ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{DAY_LABELS[d]}</span>
                            ))}
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">{String(c.timezone)}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* ══════════════════════════════════════════════════════════
          DIALOGS
      ══════════════════════════════════════════════════════════ */}

      {/* ── Import Dialog ─────────────────────────────────────────────────────── */}
      <Dialog open={importOpen} onOpenChange={(o) => { if (!o) { setImportOpen(false); setImportStep("upload"); setImportPreview(null); } }}>
        <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col" dir={isAr ? "rtl" : "ltr"}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="w-5 h-5" />
              {isAr ? "مركز استيراد الحضور" : "HR Attendance Import Center"}
            </DialogTitle>
          </DialogHeader>

          {/* Steps indicator */}
          <div className="flex items-center gap-2 text-sm">
            {(["upload", "preview", "confirm"] as const).map((step, i) => {
              const labels = isAr ? ["رفع الملف", "مراجعة البيانات", "تأكيد الاستيراد"] : ["Upload File", "Review Data", "Confirm Import"];
              const active = importStep === step;
              const done   = (["upload","preview","confirm"].indexOf(importStep)) > i;
              return (
                <div key={step} className="flex items-center gap-1">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${active ? "bg-primary text-primary-foreground" : done ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground"}`}>{done ? "✓" : i+1}</div>
                  <span className={active ? "font-semibold" : "text-muted-foreground"}>{labels[i]}</span>
                  {i < 2 && <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                </div>
              );
            })}
          </div>

          <div className="flex-1 overflow-y-auto space-y-4">
            {/* Step 1: Upload */}
            {importStep === "upload" && (
              <div className="space-y-4">
                <div
                  className={`border-2 border-dashed rounded-xl p-10 text-center transition-colors cursor-pointer ${isDragOver ? "border-primary bg-primary/5" : "border-muted-foreground/30 hover:border-primary/50"}`}
                  onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                  onDragLeave={() => setIsDragOver(false)}
                  onDrop={(e) => { e.preventDefault(); setIsDragOver(false); const file = e.dataTransfer.files[0]; if (file) handleFileSelect(file); }}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); e.target.value = ""; }} />
                  {importLoading ? (
                    <div className="space-y-2"><div className="w-10 h-10 mx-auto border-4 border-primary/30 border-t-primary rounded-full animate-spin" /><p className="text-sm text-muted-foreground">{isAr ? "جارٍ تحليل الملف..." : "Parsing file..."}</p></div>
                  ) : (
                    <>
                      <FileSpreadsheet className="w-12 h-12 mx-auto mb-3 text-muted-foreground/50" />
                      <p className="font-medium mb-1">{isAr ? "اسحب وأفلت الملف هنا" : "Drag & drop your file here"}</p>
                      <p className="text-sm text-muted-foreground">{isAr ? "أو انقر للاختيار" : "or click to browse"}</p>
                      <p className="text-xs text-muted-foreground mt-2">{isAr ? "يدعم: Excel (.xlsx, .xls) وCSV" : "Supports: Excel (.xlsx, .xls) and CSV"}</p>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                  <FileSpreadsheet className="w-5 h-5 text-emerald-600 shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">{isAr ? "تحميل قالب ديناميكي" : "Download Dynamic Template"}</p>
                    <p className="text-xs text-muted-foreground">{isAr ? "قالب Excel يتضمن كل الأعمدة والتنسيق الصحيح وأمثلة للبيانات" : "Excel template with all columns, correct format, and sample data"}</p>
                  </div>
                  <Button size="sm" variant="outline" onClick={handleDownloadTemplate}>
                    <Download className="w-4 h-4 me-1" />{isAr ? "تحميل" : "Download"}
                  </Button>
                </div>
                {importHistory && importHistory.length > 0 && (
                  <div className="rounded-lg border p-3 space-y-2">
                    <p className="text-sm font-medium">{isAr ? "سجل الاستيراد" : "Import history"}</p>
                    <div className="max-h-32 overflow-y-auto text-xs space-y-1">
                      {importHistory.slice(0, 8).map((h) => (
                        <div key={h.batch.id} className="flex justify-between text-muted-foreground gap-2">
                          <span>#{h.batch.id}</span>
                          <span>{h.batch.status}</span>
                          <span>{new Date(h.batch.createdAt).toLocaleDateString()}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Step 2: Preview */}
            {importStep === "preview" && importPreview && (
              <div className="space-y-4">
                {/* Stats */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: isAr ? "إجمالي الصفوف" : "Total rows",    value: importPreview.stats.total,         color: "bg-blue-50 text-blue-700" },
                    { label: isAr ? "صالح للاستيراد" : "Valid",         value: importPreview.stats.valid,         color: "bg-emerald-50 text-emerald-700" },
                    { label: isAr ? "يحتوي أخطاء" : "With errors",     value: importPreview.stats.invalid,       color: "bg-red-50 text-red-700" },
                    { label: isAr ? "سجلات جديدة" : "New records",     value: importPreview.stats.newRecords,    color: "bg-violet-50 text-violet-700" },
                  ].map((s) => (
                    <div key={s.label} className={`rounded-lg p-3 text-center ${s.color}`}>
                      <p className="text-2xl font-bold">{s.value}</p>
                      <p className="text-xs mt-0.5">{s.label}</p>
                    </div>
                  ))}
                </div>

                {/* Table */}
                <div className="rounded-lg border overflow-x-auto max-h-64">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40 sticky top-0">
                      <tr>
                        <th className="p-2 text-start font-semibold text-muted-foreground">#</th>
                        <th className="p-2 text-start font-semibold text-muted-foreground">{isAr ? "الموظف" : "Employee"}</th>
                        <th className="p-2 text-start font-semibold text-muted-foreground">{isAr ? "التاريخ" : "Date"}</th>
                        <th className="p-2 text-start font-semibold text-muted-foreground">{isAr ? "الحالة" : "Status"}</th>
                        <th className="p-2 text-start font-semibold text-muted-foreground">{isAr ? "دخول/خروج" : "In/Out"}</th>
                        <th className="p-2 text-start font-semibold text-muted-foreground">{isAr ? "الحالة / الأخطاء" : "Row status / Errors"}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importPreview.rows.map((row) => (
                        <tr key={row.rowNum} className={`border-t ${row.errors.length > 0 ? "bg-red-50 dark:bg-red-950/20" : row.warnings.length > 0 ? "bg-amber-50 dark:bg-amber-950/20" : ""}`}>
                          <td className="p-2 text-muted-foreground">{row.rowNum}</td>
                          <td className="p-2">{row.employeeName ?? row.employeeNumber ?? "-"}</td>
                          <td className="p-2">{row.date ?? "-"}</td>
                          <td className="p-2">{row.status ?? "-"}</td>
                          <td className="p-2">{[row.checkIn, row.checkOut].filter(Boolean).join(" → ") || "-"}</td>
                          <td className="p-2">
                            {row.errors.length > 0 ? (
                              <div className="space-y-0.5">
                                {row.errors.map((e, i) => <p key={i} className="text-red-600 flex items-center gap-1"><XCircle className="w-3 h-3 shrink-0" />{e}</p>)}
                              </div>
                            ) : row.warnings.length > 0 ? (
                              <div className="space-y-0.5">
                                {row.warnings.map((w, i) => <p key={i} className="text-amber-600 flex items-center gap-1"><AlertTriangle className="w-3 h-3 shrink-0" />{w}</p>)}
                              </div>
                            ) : (
                              <span className="text-emerald-600 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />{isAr ? "صالح" : "Valid"}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {importPreview.stats.invalid > 0 && (
                  <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 text-amber-700 text-sm">
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                    <p>{isAr ? `سيتم تجاهل ${importPreview.stats.invalid} صف يحتوي على أخطاء وسيُستورد ${importPreview.stats.valid} صف فقط.` : `${importPreview.stats.invalid} rows with errors will be skipped. Only ${importPreview.stats.valid} valid rows will be imported.`}</p>
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 shrink-0">
            {importStep === "upload" && (
              <Button variant="outline" onClick={() => setImportOpen(false)}>{isAr ? "إلغاء" : "Cancel"}</Button>
            )}
            {importStep === "preview" && (
              <>
                <Button variant="outline" onClick={() => { setImportStep("upload"); setImportPreview(null); }}>{isAr ? "رجوع" : "Back"}</Button>
                <Button onClick={handleImportConfirm} disabled={importLoading || (importPreview?.stats.valid ?? 0) === 0}>
                  {importLoading ? (isAr ? "جارٍ الاستيراد..." : "Importing...") : (isAr ? `استيراد ${importPreview?.stats.valid ?? 0} سجل` : `Import ${importPreview?.stats.valid ?? 0} records`)}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Bulk Update Dialog ───────────────────────────────────────────────── */}
      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent dir={isAr ? "rtl" : "ltr"}>
          <DialogHeader><DialogTitle>{isAr ? `تعديل جماعي - ${selectedIds.size} سجل` : `Bulk Update - ${selectedIds.size} records`}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>{isAr ? "تعيين الحالة" : "Set Status"}</Label>
              <Select value={bulkStatus} onValueChange={setBulkStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(ATT_STATUS).map(([k, v]) => <SelectItem key={k} value={k}>{isAr ? v.labelAr : v.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkOpen(false)}>{isAr ? "إلغاء" : "Cancel"}</Button>
            <Button onClick={() => bulkUpdateAtt.mutate({ ids: Array.from(selectedIds), status: bulkStatus })} disabled={bulkUpdateAtt.isPending}>
              {isAr ? "تطبيق" : "Apply"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── New Attendance Dialog ─────────────────────────────────────────────── */}
      <Dialog open={newAttOpen} onOpenChange={setNewAttOpen}>
        <DialogContent dir={isAr ? "rtl" : "ltr"}>
          <DialogHeader><DialogTitle>{isAr ? "تسجيل حضور" : "Record Attendance"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>{isAr ? "الموظف" : "Employee"}</Label>
              <Select value={attForm.employeeId} onValueChange={(v) => setAttForm((f) => ({ ...f, employeeId: v }))}>
                <SelectTrigger><SelectValue placeholder={isAr ? "اختر موظفاً" : "Select employee"} /></SelectTrigger>
                <SelectContent>{emps.map((e) => <SelectItem key={String(e.id)} value={String(e.id)}>{String(e.fullName ?? e.employeeNumber)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>{isAr ? "التاريخ" : "Date"}</Label><Input type="date" value={attForm.date} onChange={(e) => setAttForm((f) => ({ ...f, date: e.target.value }))} /></div>
              <div className="space-y-1.5">
                <Label>{isAr ? "الحالة" : "Status"}</Label>
                <Select value={attForm.status} onValueChange={(v) => setAttForm((f) => ({ ...f, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(ATT_STATUS).map(([k, v]) => <SelectItem key={k} value={k}>{isAr ? v.labelAr : v.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>{isAr ? "وقت الدخول" : "Check In"}</Label><Input type="time" value={attForm.checkIn} onChange={(e) => setAttForm((f) => ({ ...f, checkIn: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label>{isAr ? "وقت الخروج" : "Check Out"}</Label><Input type="time" value={attForm.checkOut} onChange={(e) => setAttForm((f) => ({ ...f, checkOut: e.target.value }))} /></div>
            </div>
            <div className="space-y-1.5">
              <Label>{isAr ? "الشيفت" : "Shift"}</Label>
              <Select value={attForm.shiftId} onValueChange={(v) => setAttForm((f) => ({ ...f, shiftId: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{isAr ? "- بدون شيفت -" : "- No shift -"}</SelectItem>
                  {shifts.map((s) => <SelectItem key={String(s.id)} value={String(s.id)}>{String(s.name)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label>{isAr ? "ملاحظات" : "Notes"}</Label><Input value={attForm.notes} onChange={(e) => setAttForm((f) => ({ ...f, notes: e.target.value }))} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewAttOpen(false)}>{isAr ? "إلغاء" : "Cancel"}</Button>
            <Button onClick={() => createAtt.mutate({ ...attForm, employeeId: Number(attForm.employeeId), shiftId: attForm.shiftId === "__none__" ? null : Number(attForm.shiftId) })} disabled={createAtt.isPending || !attForm.employeeId}>
              {isAr ? "تسجيل" : "Record"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Shift Dialog ──────────────────────────────────────────────────────── */}
      <Dialog open={newShiftOpen} onOpenChange={(o) => { setNewShiftOpen(o); if (!o) setEditingShift(null); }}>
        <DialogContent dir={isAr ? "rtl" : "ltr"}>
          <DialogHeader><DialogTitle>{editingShift ? (isAr ? "تعديل الشيفت" : "Edit Shift") : (isAr ? "شيفت جديد" : "New Shift")}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5"><Label>{isAr ? "الاسم" : "Name"}</Label><Input value={String(shiftFormData.name ?? "")} onChange={(e) => editingShift ? setEditingShift((f) => ({ ...f!, name: e.target.value })) : setShiftForm((f) => ({ ...f, name: e.target.value }))} /></div>
            <div className="space-y-1.5"><Label>{isAr ? "الاسم بالعربية" : "Name (AR)"}</Label><Input dir="rtl" value={String(shiftFormData.nameAr ?? "")} onChange={(e) => editingShift ? setEditingShift((f) => ({ ...f!, nameAr: e.target.value })) : setShiftForm((f) => ({ ...f, nameAr: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>{isAr ? "البداية" : "Start"}</Label><Input type="time" value={String(shiftFormData.startTime ?? "08:00")} onChange={(e) => editingShift ? setEditingShift((f) => ({ ...f!, startTime: e.target.value })) : setShiftForm((f) => ({ ...f, startTime: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label>{isAr ? "النهاية" : "End"}</Label><Input type="time" value={String(shiftFormData.endTime ?? "17:00")} onChange={(e) => editingShift ? setEditingShift((f) => ({ ...f!, endTime: e.target.value })) : setShiftForm((f) => ({ ...f, endTime: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>{isAr ? "الاستراحة (دقيقة)" : "Break (min)"}</Label><Input type="number" value={String(shiftFormData.breakMinutes ?? "60")} onChange={(e) => editingShift ? setEditingShift((f) => ({ ...f!, breakMinutes: e.target.value })) : setShiftForm((f) => ({ ...f, breakMinutes: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label>{isAr ? "السماحية (دقيقة)" : "Grace (min)"}</Label><Input type="number" value={String(shiftFormData.graceMinutes ?? "15")} onChange={(e) => editingShift ? setEditingShift((f) => ({ ...f!, graceMinutes: e.target.value })) : setShiftForm((f) => ({ ...f, graceMinutes: e.target.value }))} /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setNewShiftOpen(false); setEditingShift(null); }}>{isAr ? "إلغاء" : "Cancel"}</Button>
            <Button onClick={() => {
              const body = { ...shiftFormData, breakMinutes: Number(shiftFormData.breakMinutes), graceMinutes: Number(shiftFormData.graceMinutes) };
              if (editingShift) updateShift.mutate(body); else createShift.mutate(body);
            }} disabled={createShift.isPending || updateShift.isPending}>
              {isAr ? "حفظ" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Calendar Dialog ───────────────────────────────────────────────────── */}
      <Dialog open={newCalendarOpen} onOpenChange={setNewCalendarOpen}>
        <DialogContent dir={isAr ? "rtl" : "ltr"}>
          <DialogHeader><DialogTitle>{isAr ? "تقويم عمل جديد" : "New Work Calendar"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5"><Label>{isAr ? "الاسم" : "Name"}</Label><Input value={calForm.name} onChange={(e) => setCalForm((f) => ({ ...f, name: e.target.value }))} /></div>
            <div className="space-y-1.5"><Label>{isAr ? "الاسم بالعربية" : "Name (AR)"}</Label><Input dir="rtl" value={calForm.nameAr} onChange={(e) => setCalForm((f) => ({ ...f, nameAr: e.target.value }))} /></div>
            <div className="space-y-1.5"><Label>{isAr ? "المنطقة الزمنية" : "Timezone"}</Label><Input value={calForm.timezone} onChange={(e) => setCalForm((f) => ({ ...f, timezone: e.target.value }))} /></div>
            <div className="space-y-1.5">
              <Label>{isAr ? "أيام العمل" : "Working Days"}</Label>
              <div className="flex flex-wrap gap-1">
                {DAY_LABELS.map((d, i) => (
                  <button key={i} type="button" onClick={() => setCalForm((f) => ({ ...f, workDays: f.workDays.includes(i) ? f.workDays.filter((x) => x !== i) : [...f.workDays, i] }))}
                    className={`text-xs px-2.5 py-1 rounded border transition-colors ${calForm.workDays.includes(i) ? "bg-primary text-primary-foreground border-primary" : "bg-background border-input hover:bg-muted"}`}>
                    {d}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewCalendarOpen(false)}>{isAr ? "إلغاء" : "Cancel"}</Button>
            <Button onClick={() => createCal.mutate(calForm)} disabled={createCal.isPending || !calForm.name}>{isAr ? "حفظ" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── OT Policy Dialog ──────────────────────────────────────────────────── */}
      <Dialog open={otPolicyOpen} onOpenChange={(o) => { setOtPolicyOpen(o); if (!o) setEditingOtPolicy(null); }}>
        <DialogContent dir={isAr ? "rtl" : "ltr"}>
          <DialogHeader><DialogTitle>{editingOtPolicy ? (isAr ? "تعديل سياسة الأوفرتايم" : "Edit OT Policy") : (isAr ? "سياسة أوفرتايم جديدة" : "New OT Policy")}</DialogTitle></DialogHeader>
          <div className="space-y-3 max-h-[60vh] overflow-y-auto">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>{isAr ? "الاسم" : "Name"} *</Label><Input value={String(otPolicyFormData.name ?? "")} onChange={(e) => setOtPolicyField("name", e.target.value)} /></div>
              <div className="space-y-1.5"><Label>{isAr ? "الاسم بالعربية" : "Name (AR)"}</Label><Input dir="rtl" value={String(otPolicyFormData.nameAr ?? "")} onChange={(e) => setOtPolicyField("nameAr", e.target.value)} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{isAr ? "نوع اليوم" : "Day Type"}</Label>
                <Select value={String(otPolicyFormData.dayType ?? "any")} onValueChange={(v) => setOtPolicyField("dayType", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">{isAr ? "أي يوم" : "Any day"}</SelectItem>
                    <SelectItem value="weekday">{isAr ? "يوم عمل" : "Weekday"}</SelectItem>
                    <SelectItem value="weekend">{isAr ? "عطلة أسبوعية" : "Weekend"}</SelectItem>
                    <SelectItem value="holiday">{isAr ? "إجازة رسمية" : "Holiday"}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{isAr ? "طريقة الحساب" : "Calculation"}</Label>
                <Select value={String(otPolicyFormData.calculationType ?? "multiplier")} onValueChange={(v) => setOtPolicyField("calculationType", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="multiplier">{isAr ? "مضاعف" : "Multiplier"}</SelectItem>
                    <SelectItem value="fixed_rate">{isAr ? "سعر ثابت/ساعة" : "Fixed rate/hr"}</SelectItem>
                    <SelectItem value="custom">{isAr ? "مخصص" : "Custom"}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {String(otPolicyFormData.calculationType ?? "multiplier") === "multiplier" && (
              <div className="space-y-1.5">
                <Label>{isAr ? "معامل الضرب" : "Rate Multiplier"} (e.g. 1.5 = 150%)</Label>
                <Input type="number" step="0.1" min="1" value={String(otPolicyFormData.rateMultiplier ?? "1.5")} onChange={(e) => setOtPolicyField("rateMultiplier", e.target.value)} />
              </div>
            )}
            {String(otPolicyFormData.calculationType ?? "multiplier") === "fixed_rate" && (
              <div className="space-y-1.5">
                <Label>{isAr ? "السعر الثابت لكل ساعة" : "Fixed Rate per Hour"}</Label>
                <Input type="number" step="0.01" value={String(otPolicyFormData.fixedRatePerHour ?? "")} onChange={(e) => setOtPolicyField("fixedRatePerHour", e.target.value)} />
              </div>
            )}
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5"><Label>{isAr ? "حد أدنى (دقيقة)" : "Min threshold (min)"}</Label><Input type="number" value={String(otPolicyFormData.minThresholdMinutes ?? "30")} onChange={(e) => setOtPolicyField("minThresholdMinutes", e.target.value)} /></div>
              <div className="space-y-1.5"><Label>{isAr ? "أقصى/يوم (ساعة)" : "Max/day (hr)"}</Label><Input type="number" value={String(otPolicyFormData.maxHoursPerDay ?? "")} onChange={(e) => setOtPolicyField("maxHoursPerDay", e.target.value)} /></div>
              <div className="space-y-1.5"><Label>{isAr ? "أقصى/شهر (ساعة)" : "Max/month (hr)"}</Label><Input type="number" value={String(otPolicyFormData.maxHoursPerMonth ?? "")} onChange={(e) => setOtPolicyField("maxHoursPerMonth", e.target.value)} /></div>
            </div>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox checked={Boolean(otPolicyFormData.requiresApproval)} onCheckedChange={(v) => setOtPolicyField("requiresApproval", Boolean(v))} />
                <span className="text-sm">{isAr ? "يتطلب موافقة" : "Requires approval"}</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox checked={Boolean(otPolicyFormData.autoCalculate)} onCheckedChange={(v) => setOtPolicyField("autoCalculate", Boolean(v))} />
                <span className="text-sm">{isAr ? "حساب تلقائي" : "Auto calculate"}</span>
              </label>
            </div>
            <div className="space-y-1.5"><Label>{isAr ? "ملاحظات" : "Notes"}</Label><Textarea rows={2} value={String(otPolicyFormData.notes ?? "")} onChange={(e) => setOtPolicyField("notes", e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setOtPolicyOpen(false); setEditingOtPolicy(null); }}>{isAr ? "إلغاء" : "Cancel"}</Button>
            <Button onClick={() => {
              const body = { ...otPolicyFormData, minThresholdMinutes: Number(otPolicyFormData.minThresholdMinutes) };
              if (editingOtPolicy) updateOtPolicy.mutate(body); else createOtPolicy.mutate(body);
            }} disabled={createOtPolicy.isPending || updateOtPolicy.isPending || !otPolicyFormData.name}>
              {isAr ? "حفظ" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── OT Record Dialog ──────────────────────────────────────────────────── */}
      <Dialog open={otRecordOpen} onOpenChange={(o) => { setOtRecordOpen(o); if (!o) setEditingOtRecord(null); }}>
        <DialogContent dir={isAr ? "rtl" : "ltr"}>
          <DialogHeader><DialogTitle>{editingOtRecord ? (isAr ? "تعديل سجل الأوفرتايم" : "Edit OT Record") : (isAr ? "سجل أوفرتايم جديد" : "New OT Record")}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>{isAr ? "الموظف" : "Employee"} *</Label>
              <Select value={String(otRecordFormData.employeeId ?? "")} onValueChange={(v) => setOtRecordField("employeeId", v)}>
                <SelectTrigger><SelectValue placeholder={isAr ? "اختر موظفاً" : "Select employee"} /></SelectTrigger>
                <SelectContent>{emps.map((e) => <SelectItem key={String(e.id)} value={String(e.id)}>{String(e.fullName ?? e.employeeNumber)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>{isAr ? "التاريخ" : "Date"} *</Label><Input type="date" value={String(otRecordFormData.date ?? today)} onChange={(e) => setOtRecordField("date", e.target.value)} /></div>
              <div className="space-y-1.5">
                <Label>{isAr ? "السياسة" : "Policy"}</Label>
                <Select value={String(otRecordFormData.policyId ?? "__none__")} onValueChange={(v) => setOtRecordField("policyId", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">{isAr ? "- بدون سياسة -" : "- No policy -"}</SelectItem>
                    {otPolicies.map((p) => <SelectItem key={String(p.id)} value={String(p.id)}>{String(isAr && p.nameAr ? p.nameAr : p.name)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5"><Label>{isAr ? "البداية" : "Start"}</Label><Input type="time" value={String(otRecordFormData.startTime ?? "")} onChange={(e) => setOtRecordField("startTime", e.target.value)} /></div>
              <div className="space-y-1.5"><Label>{isAr ? "النهاية" : "End"}</Label><Input type="time" value={String(otRecordFormData.endTime ?? "")} onChange={(e) => setOtRecordField("endTime", e.target.value)} /></div>
              <div className="space-y-1.5"><Label>{isAr ? "المدة (دقيقة)" : "Duration (min)"}</Label><Input type="number" value={String(otRecordFormData.durationMinutes ?? "")} onChange={(e) => setOtRecordField("durationMinutes", e.target.value)} /></div>
            </div>
            <div className="space-y-1.5"><Label>{isAr ? "ملاحظات" : "Notes"}</Label><Input value={String(otRecordFormData.notes ?? "")} onChange={(e) => setOtRecordField("notes", e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setOtRecordOpen(false); setEditingOtRecord(null); }}>{isAr ? "إلغاء" : "Cancel"}</Button>
            <Button onClick={() => {
              const body = {
                ...otRecordFormData,
                employeeId: Number(otRecordFormData.employeeId),
                policyId: otRecordFormData.policyId === "__none__" ? null : Number(otRecordFormData.policyId),
                shiftId: otRecordFormData.shiftId === "__none__" ? null : Number(otRecordFormData.shiftId),
                durationMinutes: otRecordFormData.durationMinutes ? Number(otRecordFormData.durationMinutes) : undefined,
              };
              if (editingOtRecord) updateOtRecord.mutate(body); else createOtRecord.mutate(body);
            }} disabled={createOtRecord.isPending || updateOtRecord.isPending || !otRecordFormData.employeeId}>
              {isAr ? "حفظ" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
