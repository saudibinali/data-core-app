import { useState } from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useApiFetch } from "@/hooks/use-api-fetch";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Archive, ArrowLeft, CheckCircle2, RefreshCcw, Send, Users, AlertTriangle,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type StagingRow = {
  id: number;
  batchId: string;
  rowIndex: number;
  status: string;
  normalizedRow: Record<string, unknown>;
  mismatchFields: Array<{ field?: string; labelEn?: string; labelAr?: string; value?: string; entityType?: string }>;
  errors: string[];
  warnings: string[];
  existingEmployeeId?: number | null;
  promotedEmployeeId?: number | null;
  createdAt: string;
};

const STATUS_LABELS: Record<string, { en: string; ar: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pending_review: { en: "Pending review", ar: "بانتظار المراجعة", variant: "secondary" },
  field_mismatch: { en: "Field mismatch", ar: "بيانات غير مطابقة", variant: "destructive" },
  ready_to_promote: { en: "Ready to promote", ar: "جاهز للإرسال", variant: "default" },
  promoted: { en: "Promoted", ar: "تم الإرسال", variant: "outline" },
  rejected: { en: "Rejected", ar: "مرفوض", variant: "outline" },
};

export default function HrImportStagingPage() {
  const { i18n } = useTranslation();
  const isAr = i18n.language.startsWith("ar");
  const apiFetch = useApiFetch();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [editId, setEditId] = useState<number | null>(null);
  const [editFields, setEditFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["/hr/employees/import-staging"],
    queryFn: async () => {
      const r = await apiFetch("/api/hr/employees/import-staging?limit=200");
      if (!r.ok) throw new Error("Failed to load staging");
      return r.json() as Promise<{ rows: StagingRow[]; total: number }>;
    },
  });

  const rows = data?.rows ?? [];
  const pendingRows = rows.filter((r) => r.status !== "promoted" && r.status !== "rejected");

  function openEdit(row: StagingRow) {
    setEditId(row.id);
    const d = row.normalizedRow;
    setEditFields({
      jobGradeCode: String(d.jobGradeCode ?? d.job_grade_code ?? ""),
      jobTitleCode: String(d.jobTitleCode ?? d.job_title_code ?? ""),
      orgUnitCode: String(d.orgUnitCode ?? d.org_unit_code ?? ""),
      workLocationCode: String(d.workLocationCode ?? d.work_location_code ?? ""),
      positionCode: String(d.positionCode ?? d.position_code ?? ""),
    });
  }

  async function saveEdit() {
    if (!editId) return;
    setBusy(true);
    try {
      const r = await apiFetch(`/api/hr/employees/import-staging/${editId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          normalizedRow: {
            jobGradeCode: editFields.jobGradeCode || null,
            jobTitleCode: editFields.jobTitleCode || null,
            orgUnitCode: editFields.orgUnitCode || null,
            workLocationCode: editFields.workLocationCode || null,
            positionCode: editFields.positionCode || null,
            job_grade_code: editFields.jobGradeCode || null,
            job_title_code: editFields.jobTitleCode || null,
            org_unit_code: editFields.orgUnitCode || null,
            work_location_code: editFields.workLocationCode || null,
            position_code: editFields.positionCode || null,
          },
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      toast({ title: isAr ? "تم حفظ التصحيح" : "Correction saved" });
      setEditId(null);
      await refetch();
    } catch {
      toast({ title: isAr ? "فشل الحفظ" : "Save failed", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function saveAlias(entityType: string, aliasCode: string, canonicalCode: string) {
    try {
      const r = await apiFetch("/api/hr/employees/import-staging/aliases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityType, aliasCode, canonicalCode }),
      });
      if (!r.ok) throw new Error("alias failed");
      toast({ title: isAr ? "تم حفظ Alias" : "Alias saved" });
    } catch {
      toast({ title: isAr ? "فشل حفظ Alias" : "Failed to save alias", variant: "destructive" });
    }
  }

  async function promoteOne(id: number) {
    setBusy(true);
    try {
      const r = await apiFetch(`/api/hr/employees/import-staging/${id}/promote`, { method: "POST" });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? "Promote failed");
      toast({ title: isAr ? "تم إرسال الموظف للقائمة" : "Employee promoted to roster" });
      qc.invalidateQueries({ queryKey: ["/hr/employees"] });
      await refetch();
    } catch (e) {
      toast({
        title: isAr ? "تعذّر الإرسال" : "Promote failed",
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  async function bulkPromote() {
    const ids = [...selected];
    if (!ids.length) return;
    setBusy(true);
    try {
      const r = await apiFetch("/api/hr/employees/import-staging/bulk-promote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error("Bulk promote failed");
      toast({
        title: isAr ? "اكتمل الإرسال الجماعي" : "Bulk promote complete",
        description: isAr
          ? `نجح: ${body.promoted} — فشل: ${body.failed?.length ?? 0}`
          : `Promoted: ${body.promoted} — Failed: ${body.failed?.length ?? 0}`,
      });
      qc.invalidateQueries({ queryKey: ["/hr/employees"] });
      setSelected(new Set());
      await refetch();
    } catch {
      toast({ title: isAr ? "فشل الإرسال الجماعي" : "Bulk promote failed", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container max-w-6xl py-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <Link href="/hr/employees" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-2">
            <ArrowLeft className="w-4 h-4" />
            {isAr ? "العودة للموظفين" : "Back to employees"}
          </Link>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Archive className="w-6 h-6" />
            {isAr ? "أرشيف استيراد الموظفين" : "Employee Import Archive"}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isAr
              ? "موظفون لم تطابق بياناتهم الأساسية مع Foundation — راجع ثم أرسل للقائمة"
              : "Employees whose master data did not match Foundation — review then promote to roster"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading || busy}>
            <RefreshCcw className="w-4 h-4 me-2" />
            {isAr ? "تحديث" : "Refresh"}
          </Button>
          <Link href="/admin/hr/foundation">
            <Button variant="outline" size="sm">
              {isAr ? "بيانات الموارد البشرية" : "HR Foundation"}
            </Button>
          </Link>
        </div>
      </div>

      {pendingRows.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/20 p-3 flex gap-2 text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
          {isAr
            ? `${pendingRows.length} موظف(ين) بانتظار المراجعة. صحّح الأكواد من Foundation ثم اضغط «إرسال للموظفين».`
            : `${pendingRows.length} employee(s) pending review. Fix codes from Foundation then click Promote.`}
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>{isAr ? "الصفوف المعلّقة" : "Pending rows"}</CardTitle>
            <CardDescription>{isAr ? `الإجمالي: ${data?.total ?? 0}` : `Total: ${data?.total ?? 0}`}</CardDescription>
          </div>
          {selected.size > 0 && (
            <Button size="sm" onClick={bulkPromote} disabled={busy}>
              <Send className="w-4 h-4 me-2" />
              {isAr ? `إرسال (${selected.size})` : `Promote (${selected.size})`}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">{isAr ? "جاري التحميل..." : "Loading..."}</p>
          ) : rows.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Users className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p>{isAr ? "لا توجد صفوف في الأرشيف" : "No rows in archive"}</p>
            </div>
          ) : (
            <div className="border rounded-md overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="p-2 w-8" />
                    <th className="p-2 text-start">#</th>
                    <th className="p-2 text-start">{isAr ? "الاسم" : "Name"}</th>
                    <th className="p-2 text-start">{isAr ? "الحالة" : "Status"}</th>
                    <th className="p-2 text-start">{isAr ? "عدم التطابق" : "Mismatch"}</th>
                    <th className="p-2 text-start">{isAr ? "إجراء" : "Action"}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const st = STATUS_LABELS[row.status] ?? STATUS_LABELS.pending_review;
                    const name = String(row.normalizedRow.fullName ?? "—");
                    const canPromote = row.status === "ready_to_promote";
                    const canSelect = row.status !== "promoted" && row.status !== "rejected";
                    return (
                      <tr key={row.id} className="border-t">
                        <td className="p-2">
                          {canSelect && (
                            <input
                              type="checkbox"
                              checked={selected.has(row.id)}
                              onChange={(e) => {
                                const next = new Set(selected);
                                e.target.checked ? next.add(row.id) : next.delete(row.id);
                                setSelected(next);
                              }}
                            />
                          )}
                        </td>
                        <td className="p-2 text-muted-foreground">{row.rowIndex}</td>
                        <td className="p-2 font-medium">{name}</td>
                        <td className="p-2">
                          <Badge variant={st.variant}>{isAr ? st.ar : st.en}</Badge>
                        </td>
                        <td className="p-2 text-xs text-red-600 max-w-md">
                          {(row.mismatchFields ?? []).map((m, i) => (
                            <span key={i} className="block">
                              {(isAr ? m.labelAr : m.labelEn) ?? m.entityType}: {m.value}
                            </span>
                          ))}
                        </td>
                        <td className="p-2 space-x-2 space-x-reverse">
                          {row.status !== "promoted" && (
                            <Button variant="outline" size="sm" onClick={() => openEdit(row)} disabled={busy}>
                              {isAr ? "تصحيح" : "Fix"}
                            </Button>
                          )}
                          {canPromote && (
                            <Button size="sm" onClick={() => promoteOne(row.id)} disabled={busy}>
                              <Send className="w-3 h-3 me-1" />
                              {isAr ? "إرسال" : "Promote"}
                            </Button>
                          )}
                          {row.promotedEmployeeId && (
                            <Link href={`/hr/employees/${row.promotedEmployeeId}`}>
                              <Button variant="ghost" size="sm">
                                <CheckCircle2 className="w-3 h-3 me-1" />
                                {isAr ? "عرض" : "View"}
                              </Button>
                            </Link>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {editId !== null && (
        <Card>
          <CardHeader>
            <CardTitle>{isAr ? "تصحيح أكواد Foundation" : "Fix Foundation codes"}</CardTitle>
            <CardDescription>
              {isAr ? "استخدم الأكواد المعرفة في /admin/hr/foundation" : "Use codes defined in /admin/hr/foundation"}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              ["jobGradeCode", isAr ? "كود الدرجة" : "Job grade code"],
              ["jobTitleCode", isAr ? "كود المسمى" : "Job title code"],
              ["orgUnitCode", isAr ? "كود الوحدة" : "Org unit code"],
              ["workLocationCode", isAr ? "كود الموقع" : "Work location code"],
              ["positionCode", isAr ? "كود المنصب" : "Position code"],
            ].map(([key, label]) => (
              <div key={key} className="space-y-1">
                <Label>{label}</Label>
                <Input
                  value={editFields[key] ?? ""}
                  onChange={(e) => setEditFields((f) => ({ ...f, [key]: e.target.value }))}
                />
              </div>
            ))}
            <div className="md:col-span-2 flex gap-2">
              <Button onClick={saveEdit} disabled={busy}>{isAr ? "حفظ" : "Save"}</Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={async () => {
                  // Save aliases for non-empty edits (alias = previous mismatched value not known here).
                  // In this first iteration we store self-alias (same value) only when user enters an alternative code in the field.
                  // The real alias source is typically shown in mismatch list; we keep this button for quick adoption.
                  if (editFields.jobGradeCode) await saveAlias("job_grade", editFields.jobGradeCode, editFields.jobGradeCode);
                  if (editFields.jobTitleCode) await saveAlias("job_title", editFields.jobTitleCode, editFields.jobTitleCode);
                  if (editFields.orgUnitCode) await saveAlias("org_unit", editFields.orgUnitCode, editFields.orgUnitCode);
                  if (editFields.workLocationCode) await saveAlias("work_location", editFields.workLocationCode, editFields.workLocationCode);
                  if (editFields.positionCode) await saveAlias("position", editFields.positionCode, editFields.positionCode);
                }}
              >
                {isAr ? "حفظ كـ Alias" : "Save as alias"}
              </Button>
              <Button variant="outline" onClick={() => setEditId(null)}>{isAr ? "إلغاء" : "Cancel"}</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
