import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/use-permissions";
import { ArrowLeft, GitFork, Pencil } from "lucide-react";

type PolicyRow = {
  id: number;
  code: string;
  name: string;
  nameAr: string | null;
  routingType: string;
  routingLabel: string;
  chainDepth: number;
  timeoutHours: number;
  onTimeout: string;
  isActive: boolean;
  displayOrder: number;
  description: string | null;
  descriptionAr: string | null;
};

const ROUTING_OPTIONS = [
  { value: "direct_manager", en: "Direct manager", ar: "المدير المباشر" },
  { value: "manager_chain", en: "Manager chain", ar: "سلسلة المدراء" },
  { value: "org_unit_head", en: "Department head", ar: "رئيس القسم" },
  { value: "division_head", en: "Division head", ar: "مدير الشعبة" },
  { value: "hr_director", en: "HR director", ar: "مدير الموارد البشرية" },
  { value: "executive", en: "Executive", ar: "تنفيذي" },
];

const TIMEOUT_OPTIONS = [
  { value: "escalate", en: "Escalate", ar: "تصعيد" },
  { value: "auto_approve", en: "Auto-approve", ar: "موافقة تلقائية" },
  { value: "auto_reject", en: "Auto-reject", ar: "رفض تلقائي" },
];

async function fetchTemplates(includeInactive: boolean): Promise<PolicyRow[]> {
  const q = includeInactive ? "?includeInactive=true" : "";
  const res = await fetch(`/api/hr/approval-templates${q}`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to load templates");
  return res.json();
}

async function patchTemplate(code: string, body: Record<string, unknown>): Promise<PolicyRow> {
  const res = await fetch(`/api/hr/approval-templates/${encodeURIComponent(code)}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? "Update failed");
  }
  return res.json();
}

export default function ProcessTemplatesPage() {
  const { i18n } = useTranslation();
  const isAr = i18n.language.startsWith("ar");
  const { toast } = useToast();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission("admin") || hasPermission("hr.manage");
  const qc = useQueryClient();

  const [editRow, setEditRow] = useState<PolicyRow | null>(null);
  const [form, setForm] = useState({
    name: "",
    nameAr: "",
    routingType: "direct_manager",
    chainDepth: 1,
    timeoutHours: 48,
    onTimeout: "escalate",
    isActive: true,
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ["approval-templates", "admin"],
    queryFn: () => fetchTemplates(true),
  });

  const save = useMutation({
    mutationFn: () =>
      patchTemplate(editRow!.code, {
        name: form.name,
        nameAr: form.nameAr || null,
        routingType: form.routingType,
        chainDepth: Number(form.chainDepth),
        timeoutHours: Number(form.timeoutHours),
        onTimeout: form.onTimeout,
        isActive: form.isActive,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["approval-templates"] });
      setEditRow(null);
      toast({ title: isAr ? "تم حفظ القالب" : "Template saved" });
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  function openEdit(p: PolicyRow) {
    setEditRow(p);
    setForm({
      name: p.name,
      nameAr: p.nameAr ?? "",
      routingType: p.routingType,
      chainDepth: p.chainDepth,
      timeoutHours: p.timeoutHours,
      onTimeout: p.onTimeout,
      isActive: p.isActive,
    });
  }

  return (
    <div className="space-y-6 p-4 md:p-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-3">
        <Link href="/workflows">
          <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <GitFork className="h-6 w-6 text-primary" />
            {isAr ? "قوالب العمليات" : "Process Templates"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isAr
              ? "مسارات موافقة مبنية على الهيكل التنظيمي — قابلة للتعديل من قبل المسؤول"
              : "Org-aware approval paths — editable by workspace administrators"}
          </p>
        </div>
      </div>

      {!canEdit && (
        <p className="text-sm text-amber-600">
          {isAr ? "عرض فقط — يتطلب صلاحية hr.manage للتعديل" : "Read-only — hr.manage required to edit"}
        </p>
      )}

      {isLoading && <Skeleton className="h-24 w-full" />}
      {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}

      {data?.map((p) => (
        <Card key={p.code} className={!p.isActive ? "opacity-60" : undefined}>
          <CardHeader className="flex flex-row items-start justify-between gap-2">
            <div>
              <CardTitle className="text-base">{isAr && p.nameAr ? p.nameAr : p.name}</CardTitle>
              <CardDescription>{p.code}</CardDescription>
            </div>
            {canEdit && (
              <Button variant="outline" size="sm" onClick={() => openEdit(p)}>
                <Pencil className="h-4 w-4 mr-1" />
                {isAr ? "تعديل" : "Edit"}
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>{isAr && p.descriptionAr ? p.descriptionAr : p.description}</p>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{p.routingLabel}</Badge>
              <Badge variant="outline">{p.timeoutHours}h SLA</Badge>
              {!p.isActive && <Badge variant="destructive">{isAr ? "معطّل" : "Inactive"}</Badge>}
              {p.chainDepth > 1 && (
                <Badge variant="outline">{isAr ? "متسلسل" : "Sequential"} ×{p.chainDepth}</Badge>
              )}
            </div>
          </CardContent>
        </Card>
      ))}

      <Dialog open={editRow != null} onOpenChange={(o) => !o && setEditRow(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{isAr ? "تعديل قالب الموافقة" : "Edit approval template"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>{isAr ? "الاسم (إنجليزي)" : "Name (EN)"}</Label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <Label>{isAr ? "الاسم (عربي)" : "Name (AR)"}</Label>
              <Input value={form.nameAr} onChange={(e) => setForm((f) => ({ ...f, nameAr: e.target.value }))} dir="rtl" />
            </div>
            <div>
              <Label>{isAr ? "التوجيه" : "Routing"}</Label>
              <Select value={form.routingType} onValueChange={(v) => setForm((f) => ({ ...f, routingType: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROUTING_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{isAr ? o.ar : o.en}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>{isAr ? "عمق السلسلة" : "Chain depth"}</Label>
                <Input
                  type="number"
                  min={1}
                  max={5}
                  value={form.chainDepth}
                  onChange={(e) => setForm((f) => ({ ...f, chainDepth: Number(e.target.value) }))}
                />
              </div>
              <div>
                <Label>{isAr ? "مهلة (ساعة)" : "Timeout (hours)"}</Label>
                <Input
                  type="number"
                  min={1}
                  max={720}
                  value={form.timeoutHours}
                  onChange={(e) => setForm((f) => ({ ...f, timeoutHours: Number(e.target.value) }))}
                />
              </div>
            </div>
            <div>
              <Label>{isAr ? "عند انتهاء المهلة" : "On timeout"}</Label>
              <Select value={form.onTimeout} onValueChange={(v) => setForm((f) => ({ ...f, onTimeout: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TIMEOUT_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{isAr ? o.ar : o.en}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={form.isActive} onCheckedChange={(c) => setForm((f) => ({ ...f, isActive: c }))} />
              <Label>{isAr ? "نشط" : "Active"}</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditRow(null)}>{isAr ? "إلغاء" : "Cancel"}</Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {isAr ? "حفظ" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
