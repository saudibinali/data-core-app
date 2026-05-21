import { useState, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "wouter";
import * as XLSX from "xlsx";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient, downloadWithAuth, useListHrEmployees, useGetHrSettings, useUpdateHrSettings, usePreviewHrEmployeeImport, useConfirmHrEmployeeImport, useBulkUpdateHrEmployees } from "@workspace/api-client-react";
import { usePermissions } from "@/hooks/use-permissions";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Users, Search, UserPlus, ChevronRight, Building2,
  Briefcase, Hash, MapPin, Mail, Upload, Download,
  FileSpreadsheet, CheckSquare, Trash2, Settings2,
  AlertTriangle, CheckCircle2, RefreshCcw, ChevronDown,
  X, AlertCircle, Info,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const EMPLOYMENT_TYPE_LABELS: Record<string, string> = {
  full_time:  "Full-time",
  part_time:  "Part-time",
  contractor: "Contractor",
  intern:     "Intern",
  temporary:  "Temporary",
};
const EMPLOYMENT_TYPE_COLORS: Record<string, string> = {
  full_time:  "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  part_time:  "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300",
  contractor: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  intern:     "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  temporary:  "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300",
};
const STATUS_STYLES: Record<string, string> = {
  active:     "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border-0",
  on_leave:   "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border-0",
  suspended:  "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300 border-0",
  terminated: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 border-0",
  resigned:   "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400 border-0",
};
const STATUS_LABELS: Record<string, { en: string; ar: string }> = {
  active:     { en: "Active",     ar: "نشط" },
  on_leave:   { en: "On Leave",   ar: "في إجازة" },
  suspended:  { en: "Suspended",  ar: "موقوف" },
  terminated: { en: "Terminated", ar: "منتهية خدمته" },
  resigned:   { en: "Resigned",   ar: "مستقيل" },
};

function StatusBadge({ status, isAr }: { status: string; isAr: boolean }) {
  const labels = STATUS_LABELS[status];
  return (
    <Badge className={`${STATUS_STYLES[status] ?? "bg-muted text-foreground border-0"} text-xs`}>
      {labels ? (isAr ? labels.ar : labels.en) : status}
    </Badge>
  );
}
function initials(name: string) {
  return name.split(" ").filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase();
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings modal
// ─────────────────────────────────────────────────────────────────────────────
function NumberingSettingsModal({ open, onClose, isAr }: { open: boolean; onClose: () => void; isAr: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: settings } = useGetHrSettings() as { data: any };
  const [mode, setMode] = useState<string>("");
  const [startFrom, setStartFrom] = useState("");
  const [leaveMode, setLeaveMode] = useState<string>("");

  const updateMut = useUpdateHrSettings({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ["/hr/settings"] });
        qc.invalidateQueries({ queryKey: ["/hr/leave-cutover/status"] });
        toast({ title: isAr ? "تم حفظ الإعدادات" : "Settings saved" });
        onClose();
      },
    },
  });

  const currentMode = mode || settings?.numberingMode || "auto";
  const currentLeaveMode = leaveMode || settings?.leaveRuntimeMode || "transition";

  function save() {
    const payload: Record<string, unknown> = {
      numberingMode: currentMode,
      leaveRuntimeMode: currentLeaveMode,
    };
    if (startFrom) payload.numberingStartFrom = parseInt(startFrom, 10);
    updateMut.mutate({ data: payload } as any);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="w-4 h-4" />
            {isAr ? "إعدادات الموارد البشرية" : "Workspace HR Settings"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-1">
          <div>
            <Label className="text-sm font-medium mb-2 block">{isAr ? "مسار الإجازات (Leave runtime)" : "Leave Runtime Mode"}</Label>
            <Select value={currentLeaveMode} onValueChange={setLeaveMode}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="legacy">
                  <p className="font-medium">{isAr ? "قديم (Legacy)" : "Legacy"}</p>
                  <p className="text-xs text-muted-foreground">{isAr ? "مسار hr_employee_leaves فقط (تجريبي env)" : "Legacy path only; env pilot flags"}</p>
                </SelectItem>
                <SelectItem value="transition">
                  <p className="font-medium">{isAr ? "انتقالي" : "Transition"}</p>
                  <p className="text-xs text-muted-foreground">{isAr ? "إرسال وموافقة canonical مفعّل؛ legacy مسموح" : "Canonical submit/approve ON; legacy still allowed"}</p>
                </SelectItem>
                <SelectItem value="canonical">
                  <p className="font-medium">{isAr ? "معياري (Canonical)" : "Canonical"}</p>
                  <p className="text-xs text-muted-foreground">{isAr ? "تجميد كتابة legacy — مسار leave_requests فقط" : "Legacy writes frozen; leave_requests only"}</p>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-sm font-medium mb-2 block">{isAr ? "وضع ترقيم الموظفين" : "Employee Numbering Mode"}</Label>
            <Select value={currentMode} onValueChange={setMode}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">
                  <div>
                    <p className="font-medium">{isAr ? "تلقائي" : "Automatic"}</p>
                    <p className="text-xs text-muted-foreground">{isAr ? "يُولّد النظام الرقم تلقائياً دائماً" : "System always generates the number"}</p>
                  </div>
                </SelectItem>
                <SelectItem value="manual">
                  <div>
                    <p className="font-medium">{isAr ? "يدوي" : "Manual"}</p>
                    <p className="text-xs text-muted-foreground">{isAr ? "يجب إدخال الرقم يدوياً في كل مرة" : "Number must be entered manually each time"}</p>
                  </div>
                </SelectItem>
                <SelectItem value="hybrid">
                  <div>
                    <p className="font-medium">{isAr ? "هجين" : "Hybrid"}</p>
                    <p className="text-xs text-muted-foreground">{isAr ? "يولّد تلقائياً مع إمكانية التعديل" : "Auto-generates but can be overridden"}</p>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-sm font-medium mb-1 block">{isAr ? "ابدأ الترقيم من (اختياري)" : "Start numbering from (optional)"}</Label>
            <p className="text-xs text-muted-foreground mb-2">
              {isAr
                ? "للترحيل: إذا لديك موظفون بأرقام موجودة (مثل 5000) سيستمر النظام من 5001 تلقائياً. هذا الحقل يُجبر البداية على رقم محدد."
                : "For migration: if you have employees at 5000 the system will auto-continue from 5001. Use this field to force a specific start."}
            </p>
            <Input
              type="number"
              placeholder={isAr ? "مثال: 5001" : "e.g. 5001"}
              value={startFrom}
              onChange={(e) => setStartFrom(e.target.value)}
            />
          </div>

          <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">{isAr ? "ملاحظة" : "Note"}</p>
            <p>{isAr ? "النظام يكتشف تلقائياً أعلى رقم موجود ويكمل التسلسل من بعده - لا تُعاد البيانات الحالية." : "System auto-detects the highest existing number and continues from there - existing records are never re-numbered."}</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{isAr ? "إلغاء" : "Cancel"}</Button>
          <Button onClick={save} disabled={updateMut.isPending}>
            {updateMut.isPending ? (isAr ? "جاري الحفظ..." : "Saving...") : (isAr ? "حفظ" : "Save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Import modal
// ─────────────────────────────────────────────────────────────────────────────
type ImportRow = {
  rowIndex: number;
  status: "new" | "update" | "error" | "skip";
  existingEmployeeId?: number;
  errors: string[];
  warnings: string[];
  data: Record<string, unknown>;
};

function ImportModal({ open, onClose, isAr }: { open: boolean; onClose: () => void; isAr: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [step, setStep] = useState<"upload" | "preview" | "done">("upload");
  const [previewRows, setPreviewRows] = useState<ImportRow[]>([]);
  const [summary, setSummary] = useState<{ total: number; new: number; update: number; errors: number } | null>(null);
  const [result, setResult] = useState<{ imported: number; updated: number; errors: string[] } | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const previewMut = usePreviewHrEmployeeImport({
    mutation: {
      onSuccess: (data: any) => {
        setPreviewRows(data.rows ?? []);
        setSummary(data.summary ?? null);
        const allValid = (data.rows ?? []).filter((r: ImportRow) => r.status !== "error").map((r: ImportRow) => r.rowIndex);
        setSelectedRows(new Set(allValid));
        setStep("preview");
      },
      onError: () => toast({ title: isAr ? "فشل تحليل الملف" : "Failed to parse file", variant: "destructive" }),
    },
  });

  const confirmMut = useConfirmHrEmployeeImport({
    mutation: {
      onSuccess: (data: any) => {
        qc.invalidateQueries({ queryKey: ["/hr/employees"] });
        setResult(data);
        setStep("done");
      },
      onError: () => toast({ title: isAr ? "فشل الاستيراد" : "Import failed", variant: "destructive" }),
    },
  });

  function parseAndPreview(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const data = new Uint8Array(e.target!.result as ArrayBuffer);
      const wb = XLSX.read(data, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]!]!;
      const rawAll = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 });
      if (rawAll.length < 4) {
        toast({ title: isAr ? "الملف فارغ أو غير صحيح" : "File is empty or invalid", variant: "destructive" });
        return;
      }
      // Row index: 0=AR headers, 1=EN headers, 2=keys, 3+=data
      const keyRow = rawAll[2] as string[];
      const dataRows = rawAll.slice(3) as string[][];
      const rows: Record<string, string>[] = dataRows
        .filter((r) => r.some((c) => c != null && String(c).trim() !== ""))
        .map((r) => {
          const obj: Record<string, string> = {};
          keyRow.forEach((k, i) => { if (k) obj[String(k)] = String(r[i] ?? ""); });
          return obj;
        });
      if (rows.length === 0) {
        toast({ title: isAr ? "لا توجد بيانات في الملف" : "No data rows found in file", variant: "destructive" });
        return;
      }
      previewMut.mutate({ data: { rows } } as any);
    };
    reader.readAsArrayBuffer(file);
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) parseAndPreview(file);
  }, []);

  async function downloadTemplate() {
    try {
      await downloadWithAuth(`${BASE}/api/hr/employees/import-template`, "employee_import_template.xlsx");
    } catch {
      toast({ title: isAr ? "خطأ في تحميل القالب" : "Failed to download template", variant: "destructive" });
    }
  }

  function confirm() {
    const rowsToImport = previewRows
      .filter((r) => selectedRows.has(r.rowIndex) && r.status !== "error")
      .map((r) => ({
        status: r.status,
        existingEmployeeId: r.existingEmployeeId,
        data: r.data,
      }));
    confirmMut.mutate({ data: { rows: rowsToImport } } as any);
  }

  function reset() {
    setStep("upload");
    setPreviewRows([]);
    setSummary(null);
    setResult(null);
    setSelectedRows(new Set());
  }

  const validCount = previewRows.filter((r) => r.status !== "error" && selectedRows.has(r.rowIndex)).length;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { reset(); onClose(); } }}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="w-4 h-4" />
            {isAr ? "استيراد موظفين" : "Import Employees"}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto">
          {/* Step 1: Upload */}
          {step === "upload" && (
            <div className="space-y-4 py-2">
              <div className="rounded-md border bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800 p-3 flex gap-3">
                <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                <div className="text-sm text-blue-800 dark:text-blue-300 space-y-1">
                  <p className="font-medium">{isAr ? "كيفية الاستيراد" : "How to import"}</p>
                  <ol className={`list-decimal ${isAr ? "mr-4" : "ml-4"} space-y-0.5 text-xs`}>
                    <li>{isAr ? "حمّل قالب Excel الديناميكي (يتضمن حقولك المخصصة والعلاقات)" : "Download the dynamic Excel template (includes your custom fields and lookups)"}</li>
                    <li>{isAr ? "أدخل بيانات الموظفين في الصفوف ابتداءً من الصف الرابع" : "Enter employee data in rows starting from row 4"}</li>
                    <li>{isAr ? "ارفع الملف للمراجعة قبل الحفظ" : "Upload the file to preview before saving"}</li>
                  </ol>
                </div>
              </div>

              <Button variant="outline" className="w-full gap-2" onClick={downloadTemplate}>
                <FileSpreadsheet className="w-4 h-4 text-green-600" />
                {isAr ? "تحميل القالب الديناميكي (Excel)" : "Download Dynamic Template (Excel)"}
              </Button>

              <div
                className={`border-2 border-dashed rounded-lg p-10 text-center transition-colors cursor-pointer ${dragging ? "border-primary bg-primary/5" : "border-muted-foreground/30 hover:border-primary/50"}`}
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                onClick={() => fileRef.current?.click()}
              >
                <Upload className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
                <p className="text-sm font-medium">{isAr ? "اسحب الملف هنا أو اضغط للاختيار" : "Drag & drop or click to select file"}</p>
                <p className="text-xs text-muted-foreground mt-1">{isAr ? "يدعم Excel (.xlsx) و CSV (.csv)" : "Supports Excel (.xlsx) and CSV (.csv)"}</p>
                <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) parseAndPreview(f); }} />
              </div>
              {previewMut.isPending && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <RefreshCcw className="w-4 h-4 animate-spin" />
                  {isAr ? "جاري تحليل الملف..." : "Parsing file..."}
                </div>
              )}
            </div>
          )}

          {/* Step 2: Preview */}
          {step === "preview" && summary && (
            <div className="space-y-4 py-2">
              {/* Summary */}
              <div className="grid grid-cols-4 gap-3">
                {[
                  { label: isAr ? "إجمالي" : "Total", value: summary.total, color: "text-foreground" },
                  { label: isAr ? "جديد" : "New", value: summary.new, color: "text-emerald-600" },
                  { label: isAr ? "تحديث" : "Update", value: summary.update, color: "text-blue-600" },
                  { label: isAr ? "أخطاء" : "Errors", value: summary.errors, color: "text-red-600" },
                ].map((s) => (
                  <div key={s.label} className="rounded-md border p-3 text-center">
                    <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                    <p className="text-xs text-muted-foreground">{s.label}</p>
                  </div>
                ))}
              </div>

              {summary.errors > 0 && (
                <div className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 p-3 text-sm text-amber-800 dark:text-amber-300 flex gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  {isAr ? `${summary.errors} صف به أخطاء - سيتم استبعادها تلقائياً` : `${summary.errors} rows have errors - they will be skipped`}
                </div>
              )}

              {/* Rows table */}
              <div className="border rounded-md overflow-auto max-h-80">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="p-2 text-left w-8">
                        <Checkbox
                          checked={validCount > 0 && selectedRows.size === previewRows.filter(r => r.status !== "error").length}
                          onCheckedChange={(v) => {
                            if (v) setSelectedRows(new Set(previewRows.filter(r => r.status !== "error").map(r => r.rowIndex)));
                            else setSelectedRows(new Set());
                          }}
                        />
                      </th>
                      <th className="p-2 text-left">#</th>
                      <th className="p-2 text-left">{isAr ? "الحالة" : "Status"}</th>
                      <th className="p-2 text-left">{isAr ? "الاسم" : "Name"}</th>
                      <th className="p-2 text-left">{isAr ? "رقم الموظف" : "Emp #"}</th>
                      <th className="p-2 text-left">{isAr ? "ملاحظات" : "Notes"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row) => (
                      <tr key={row.rowIndex} className={`border-t ${row.status === "error" ? "bg-red-50 dark:bg-red-950/20" : row.status === "update" ? "bg-blue-50 dark:bg-blue-950/20" : ""}`}>
                        <td className="p-2">
                          {row.status !== "error" && (
                            <Checkbox
                              checked={selectedRows.has(row.rowIndex)}
                              onCheckedChange={(v) => {
                                const next = new Set(selectedRows);
                                v ? next.add(row.rowIndex) : next.delete(row.rowIndex);
                                setSelectedRows(next);
                              }}
                            />
                          )}
                        </td>
                        <td className="p-2 text-muted-foreground">{row.rowIndex}</td>
                        <td className="p-2">
                          {row.status === "error"   && <span className="text-red-600 font-medium flex items-center gap-1"><AlertCircle className="w-3 h-3" />{isAr ? "خطأ" : "Error"}</span>}
                          {row.status === "new"     && <span className="text-emerald-600 font-medium flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />{isAr ? "جديد" : "New"}</span>}
                          {row.status === "update"  && <span className="text-blue-600 font-medium flex items-center gap-1"><RefreshCcw className="w-3 h-3" />{isAr ? "تحديث" : "Update"}</span>}
                        </td>
                        <td className="p-2 font-medium">{String(row.data.fullName ?? "")}</td>
                        <td className="p-2 font-mono text-muted-foreground">{String(row.data.employeeNumber ?? "-")}</td>
                        <td className="p-2 max-w-xs">
                          {row.errors.map((e, i) => <p key={i} className="text-red-600">{e}</p>)}
                          {row.warnings.map((w, i) => <p key={i} className="text-amber-600">{w}</p>)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Step 3: Done */}
          {step === "done" && result && (
            <div className="py-6 space-y-4 text-center">
              <CheckCircle2 className="w-14 h-14 mx-auto text-emerald-500" />
              <h3 className="text-lg font-semibold">{isAr ? "اكتمل الاستيراد" : "Import Complete"}</h3>
              <div className="grid grid-cols-3 gap-3 max-w-sm mx-auto">
                <div className="rounded-md border p-3">
                  <p className="text-xl font-bold text-emerald-600">{result.imported}</p>
                  <p className="text-xs text-muted-foreground">{isAr ? "موظف جديد" : "Imported"}</p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-xl font-bold text-blue-600">{result.updated}</p>
                  <p className="text-xs text-muted-foreground">{isAr ? "محدّث" : "Updated"}</p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-xl font-bold text-red-600">{result.errors.length}</p>
                  <p className="text-xs text-muted-foreground">{isAr ? "أخطاء" : "Errors"}</p>
                </div>
              </div>
              {result.errors.length > 0 && (
                <div className="text-left rounded-md border bg-red-50 dark:bg-red-950/20 p-3 max-h-40 overflow-auto">
                  {result.errors.map((e, i) => <p key={i} className="text-xs text-red-700 dark:text-red-400">{e}</p>)}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="border-t pt-3">
          {step === "upload" && (
            <Button variant="outline" onClick={onClose}>{isAr ? "إغلاق" : "Close"}</Button>
          )}
          {step === "preview" && (
            <>
              <Button variant="outline" onClick={reset}>{isAr ? "رجوع" : "Back"}</Button>
              <Button onClick={confirm} disabled={validCount === 0 || confirmMut.isPending}>
                {confirmMut.isPending
                  ? (isAr ? "جاري الحفظ..." : "Saving...")
                  : (isAr ? `استيراد ${validCount} موظف` : `Import ${validCount} employees`)}
              </Button>
            </>
          )}
          {step === "done" && (
            <>
              <Button variant="outline" onClick={reset}>{isAr ? "استيراد آخر" : "Import another"}</Button>
              <Button onClick={() => { reset(); onClose(); }}>{isAr ? "إغلاق" : "Close"}</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Bulk action modal
// ─────────────────────────────────────────────────────────────────────────────
function BulkModal({
  open, onClose, isAr, selectedIds, onDone,
}: {
  open: boolean; onClose: () => void; isAr: boolean;
  selectedIds: number[]; onDone: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [action, setAction] = useState("set_status");
  const [value, setValue] = useState("");

  // Load options for set_org_unit / set_job_title
  const orgQ = useQuery({ queryKey: ["/hr/org-units"], queryFn: () => apiClient.get("/api/hr/org-units").then(r => r.data) });
  const jtQ  = useQuery({ queryKey: ["/hr/job-titles"], queryFn: () => apiClient.get("/api/hr/job-titles").then(r => r.data) });

  const bulkMut = useBulkUpdateHrEmployees({
    mutation: {
      onSuccess: (data: any) => {
        qc.invalidateQueries({ queryKey: ["/hr/employees"] });
        toast({ title: isAr ? `تم تطبيق الإجراء على ${data.affected} موظف` : `Applied to ${data.affected} employees` });
        onDone();
        onClose();
      },
    },
  });

  function submit() {
    bulkMut.mutate({ data: { action, employeeIds: selectedIds, value: value || undefined } } as any);
  }

  const orgUnits: any[] = (orgQ.data as any) ?? [];
  const jobTitles: any[] = (jtQ.data as any) ?? [];

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckSquare className="w-4 h-4" />
            {isAr ? `إجراء جماعي على ${selectedIds.length} موظف` : `Bulk action - ${selectedIds.length} employees`}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div>
            <Label className="text-sm mb-1 block">{isAr ? "نوع الإجراء" : "Action"}</Label>
            <Select value={action} onValueChange={(v) => { setAction(v); setValue(""); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="set_status">{isAr ? "تغيير الحالة" : "Set Status"}</SelectItem>
                <SelectItem value="set_employment_type">{isAr ? "تغيير نوع التوظيف" : "Set Employment Type"}</SelectItem>
                <SelectItem value="set_org_unit">{isAr ? "نقل للوحدة التنظيمية" : "Move to Org Unit"}</SelectItem>
                <SelectItem value="set_job_title">{isAr ? "تغيير المسمى الوظيفي" : "Set Job Title"}</SelectItem>
                <SelectItem value="delete">{isAr ? "حذف" : "Delete"}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {action === "set_status" && (
            <div>
              <Label className="text-sm mb-1 block">{isAr ? "الحالة الجديدة" : "New Status"}</Label>
              <Select value={value} onValueChange={setValue}>
                <SelectTrigger><SelectValue placeholder={isAr ? "اختر..." : "Select..."} /></SelectTrigger>
                <SelectContent>
                  {Object.entries(STATUS_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{isAr ? v.ar : v.en}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {action === "set_employment_type" && (
            <div>
              <Label className="text-sm mb-1 block">{isAr ? "نوع التوظيف" : "Employment Type"}</Label>
              <Select value={value} onValueChange={setValue}>
                <SelectTrigger><SelectValue placeholder={isAr ? "اختر..." : "Select..."} /></SelectTrigger>
                <SelectContent>
                  {Object.entries(EMPLOYMENT_TYPE_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {action === "set_org_unit" && (
            <div>
              <Label className="text-sm mb-1 block">{isAr ? "الوحدة التنظيمية" : "Org Unit"}</Label>
              <Select value={value} onValueChange={setValue}>
                <SelectTrigger><SelectValue placeholder={isAr ? "اختر..." : "Select..."} /></SelectTrigger>
                <SelectContent>
                  {orgUnits.map((o: any) => <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          {action === "set_job_title" && (
            <div>
              <Label className="text-sm mb-1 block">{isAr ? "المسمى الوظيفي" : "Job Title"}</Label>
              <Select value={value} onValueChange={setValue}>
                <SelectTrigger><SelectValue placeholder={isAr ? "اختر..." : "Select..."} /></SelectTrigger>
                <SelectContent>
                  {jobTitles.map((j: any) => <SelectItem key={j.id} value={String(j.id)}>{j.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          {action === "delete" && (
            <div className="rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/20 p-3 text-sm text-red-700 dark:text-red-400 flex gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              {isAr ? `سيتم حذف ${selectedIds.length} موظف نهائياً. هذا الإجراء لا يمكن التراجع عنه.` : `${selectedIds.length} employees will be permanently deleted. This cannot be undone.`}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{isAr ? "إلغاء" : "Cancel"}</Button>
          <Button
            onClick={submit}
            disabled={bulkMut.isPending || (action !== "delete" && !value)}
            variant={action === "delete" ? "destructive" : "default"}
          >
            {bulkMut.isPending ? (isAr ? "جاري التطبيق..." : "Applying...") : (isAr ? "تطبيق" : "Apply")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────
export default function HrEmployeesPage() {
  const { i18n } = useTranslation();
  const isAr = i18n.language.startsWith("ar");
  const { hasPermission } = usePermissions();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const isAdmin = hasPermission("admin") || hasPermission("hr.manage");

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkMode, setBulkMode] = useState(false);

  // Modals
  const [showImport, setShowImport] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const { data, isLoading } = useListHrEmployees({
    search: search || undefined,
    employmentType: typeFilter !== "all" ? typeFilter : undefined,
    status: statusFilter !== "all" ? statusFilter : undefined,
    limit: "200",
  } as any);

  const { data: hrSettings } = useGetHrSettings() as { data: any };

  const employees: any[] = (data as any)?.employees ?? [];
  const total     = (data as any)?.total ?? 0;

  const numberingMode: string = hrSettings?.numberingMode ?? "auto";
  const numberingBadge = {
    auto:   { label: isAr ? "ترقيم تلقائي" : "Auto Numbering",   cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" },
    manual: { label: isAr ? "ترقيم يدوي" : "Manual Numbering",   cls: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" },
    hybrid: { label: isAr ? "ترقيم هجين" : "Hybrid Numbering",   cls: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300" },
  };
  const nb = numberingBadge[numberingMode as keyof typeof numberingBadge] ?? numberingBadge.auto;

  function toggleSelect(id: number) {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  }
  function toggleAll() {
    if (selected.size === employees.length) setSelected(new Set());
    else setSelected(new Set(employees.map((e) => e.id)));
  }

  async function doExport(fmt: "xlsx" | "csv") {
    const params = new URLSearchParams({ format: fmt });
    if (typeFilter !== "all") params.set("employmentType", typeFilter);
    if (statusFilter !== "all") params.set("status", statusFilter);
    try {
      await downloadWithAuth(`${BASE}/api/hr/employees/export?${params}`, `employees_export.${fmt}`);
    } catch {
      toast({ title: isAr ? "خطأ في التصدير" : "Export failed", variant: "destructive" });
    }
  }

  return (
    <div className="space-y-5">
      {/* Modals */}
      <ImportModal open={showImport} onClose={() => setShowImport(false)} isAr={isAr} />
      <BulkModal
        open={showBulk} onClose={() => setShowBulk(false)} isAr={isAr}
        selectedIds={Array.from(selected)} onDone={() => { setSelected(new Set()); setBulkMode(false); }}
      />
      <NumberingSettingsModal open={showSettings} onClose={() => setShowSettings(false)} isAr={isAr} />

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="w-6 h-6 text-primary" />
            {isAr ? "الموظفون" : "Employees"}
          </h1>
          <div className="flex items-center gap-2 mt-1">
            <p className="text-sm text-muted-foreground">
              {isLoading ? "..." : `${total} ${isAr ? "موظف" : total === 1 ? "employee" : "employees"}`}
            </p>
            <Badge className={`text-xs ${nb.cls} border-0`}>{nb.label}</Badge>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {isAdmin && (
            <>
              {/* Bulk mode toggle */}
              <Button
                variant={bulkMode ? "default" : "outline"} size="sm"
                onClick={() => { setBulkMode(!bulkMode); setSelected(new Set()); }}
              >
                <CheckSquare className="w-4 h-4 mr-1.5" />
                {isAr ? "تحديد متعدد" : "Select"}
              </Button>

              {/* Bulk action */}
              {bulkMode && selected.size > 0 && (
                <Button size="sm" onClick={() => setShowBulk(true)}>
                  {isAr ? `إجراء على ${selected.size}` : `Action (${selected.size})`}
                </Button>
              )}

              {/* Export */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Download className="w-4 h-4 mr-1.5" />
                    {isAr ? "تصدير" : "Export"}
                    <ChevronDown className="w-3 h-3 ml-1" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => doExport("xlsx")}>
                    <FileSpreadsheet className="w-4 h-4 mr-2 text-green-600" />
                    {isAr ? "تصدير Excel" : "Export as Excel"}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => doExport("csv")}>
                    <Download className="w-4 h-4 mr-2" />
                    {isAr ? "تصدير CSV" : "Export as CSV"}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Import */}
              <Button variant="outline" size="sm" onClick={() => setShowImport(true)}>
                <Upload className="w-4 h-4 mr-1.5" />
                {isAr ? "استيراد" : "Import"}
              </Button>

              {/* Numbering settings */}
              <Button variant="ghost" size="sm" onClick={() => setShowSettings(true)} title={isAr ? "إعدادات الترقيم" : "Numbering settings"}>
                <Settings2 className="w-4 h-4" />
              </Button>

              {/* Add employee */}
              <Button size="sm" onClick={() => navigate("/hr/employees/new")}>
                <UserPlus className="w-4 h-4 mr-1.5" />
                {isAr ? "إضافة موظف" : "Add Employee"}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        {bulkMode && employees.length > 0 && (
          <div className="flex items-center gap-2">
            <Checkbox checked={selected.size === employees.length && employees.length > 0} onCheckedChange={toggleAll} />
            <span className="text-sm text-muted-foreground">
              {isAr ? `تحديد الكل (${employees.length})` : `Select all (${employees.length})`}
            </span>
            {selected.size > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                <X className="w-3 h-3 mr-1" />
                {isAr ? "إلغاء التحديد" : "Clear"}
              </Button>
            )}
          </div>
        )}

        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder={isAr ? "بحث بالاسم أو البريد أو الرقم الوظيفي..." : "Search by name, email or employee #..."}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-40">
            <Briefcase className="w-4 h-4 mr-2 text-muted-foreground" />
            <SelectValue placeholder={isAr ? "النوع" : "Type"} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{isAr ? "كل الأنواع" : "All Types"}</SelectItem>
            <SelectItem value="full_time">Full-time</SelectItem>
            <SelectItem value="part_time">Part-time</SelectItem>
            <SelectItem value="contractor">Contractor</SelectItem>
            <SelectItem value="intern">Intern</SelectItem>
            <SelectItem value="temporary">Temporary</SelectItem>
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder={isAr ? "الحالة" : "Status"} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{isAr ? "كل الحالات" : "All Statuses"}</SelectItem>
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>{isAr ? v.ar : v.en}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Employee grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}><CardContent className="p-4"><Skeleton className="h-20 w-full" /></CardContent></Card>
          ))}
        </div>
      ) : employees.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Users className="w-14 h-14 text-muted-foreground/30 mb-4" />
          <p className="text-lg font-medium text-muted-foreground">
            {search || typeFilter !== "all" || statusFilter !== "all"
              ? (isAr ? "لا توجد نتائج" : "No employees match your filters")
              : (isAr ? "لا يوجد موظفون بعد" : "No employees yet")}
          </p>
          {isAdmin && !search && typeFilter === "all" && statusFilter === "all" && (
            <div className="flex gap-2 mt-4">
              <Button onClick={() => navigate("/hr/employees/new")}>
                <UserPlus className="w-4 h-4 mr-2" />
                {isAr ? "إضافة أول موظف" : "Add First Employee"}
              </Button>
              <Button variant="outline" onClick={() => setShowImport(true)}>
                <Upload className="w-4 h-4 mr-2" />
                {isAr ? "استيراد من Excel" : "Import from Excel"}
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {employees.map((emp: any) => (
            <div key={emp.id} className="relative">
              {bulkMode && (
                <div
                  className="absolute top-3 left-3 z-10"
                  onClick={(e) => { e.stopPropagation(); toggleSelect(emp.id); }}
                >
                  <Checkbox checked={selected.has(emp.id)} />
                </div>
              )}
              <Link href={bulkMode ? "#" : `/hr/employees/${emp.id}`}>
                <Card
                  className={`hover:shadow-md transition-shadow cursor-pointer group h-full ${bulkMode && selected.has(emp.id) ? "ring-2 ring-primary" : ""}`}
                  onClick={bulkMode ? () => toggleSelect(emp.id) : undefined}
                >
                  <CardContent className="p-4">
                    <div className={`flex items-start gap-3 ${bulkMode ? "pl-7" : ""}`}>
                      {emp.avatarUrl ? (
                        <img src={emp.avatarUrl} alt={emp.fullName} className="w-11 h-11 rounded-full shrink-0 object-cover" />
                      ) : (
                        <div className="w-11 h-11 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-bold shrink-0">
                          {initials(emp.fullName)}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <p className="font-semibold text-sm truncate">{emp.fullName}</p>
                          <StatusBadge status={emp.status ?? "active"} isAr={isAr} />
                        </div>
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          {emp.jobTitleName ?? emp.position ?? (isAr ? "لا يوجد مسمى" : "No title")}
                        </p>
                        <div className="mt-2 space-y-1">
                          {emp.orgUnitName && (
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              <Building2 className="w-3 h-3 shrink-0" />
                              <span className="truncate">{emp.orgUnitName}</span>
                            </div>
                          )}
                          {emp.employeeNumber && (
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              <Hash className="w-3 h-3 shrink-0" />
                              <span className="font-mono">{emp.employeeNumber}</span>
                            </div>
                          )}
                          {emp.email && (
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              <Mail className="w-3 h-3 shrink-0" />
                              <span className="truncate">{emp.email}</span>
                            </div>
                          )}
                          {emp.location && (
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              <MapPin className="w-3 h-3 shrink-0" />
                              <span className="truncate">{emp.location}</span>
                            </div>
                          )}
                        </div>
                        <div className="flex items-center justify-between mt-3">
                          {emp.employmentType && (
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${EMPLOYMENT_TYPE_COLORS[emp.employmentType] ?? "bg-muted text-foreground"}`}>
                              {EMPLOYMENT_TYPE_LABELS[emp.employmentType] ?? emp.employmentType}
                            </span>
                          )}
                          {!bulkMode && <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors ml-auto" />}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
