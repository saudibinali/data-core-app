import { useListUsers } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { Plus, Trash2, GitBranch, ClipboardCheck, Zap, ArrowDown } from "lucide-react";
import type { FormWorkflowPlan, FormWorkflowStepPlan, WorkflowApproverType } from "@/lib/form-smart-types";

interface Props {
  value: FormWorkflowPlan;
  onChange: (v: FormWorkflowPlan) => void;
  isAr: boolean;
  formName: string;
  autoEvent: string;
}

const APPROVER_OPTIONS: { value: WorkflowApproverType; labelEn: string; labelAr: string }[] = [
  { value: "manager", labelEn: "Direct manager", labelAr: "المدير المباشر" },
  { value: "department_head", labelEn: "Department head", labelAr: "رئيس القسم" },
  { value: "hr_admin", labelEn: "HR / Admin", labelAr: "الموارد البشرية / المشرف" },
  { value: "role", labelEn: "By platform role", labelAr: "حسب دور المنصة" },
  { value: "specific", labelEn: "Specific person", labelAr: "شخص محدد" },
];

const PRESETS: { labelEn: string; labelAr: string; steps: FormWorkflowStepPlan[] }[] = [
  {
    labelEn: "Manager only",
    labelAr: "المدير المباشر فقط",
    steps: [{ id: "p1", type: "approval", approverType: "manager", approvalMode: "single", title: "Manager Approval", titleAr: "موافقة المدير" }],
  },
  {
    labelEn: "Manager → HR",
    labelAr: "المدير ثم الموارد البشرية",
    steps: [
      { id: "p2a", type: "approval", approverType: "manager", approvalMode: "single", title: "Manager Approval", titleAr: "موافقة المدير" },
      { id: "p2b", type: "approval", approverType: "hr_admin", approvalMode: "single", title: "HR Review", titleAr: "مراجعة الموارد البشرية" },
    ],
  },
  {
    labelEn: "Dept head → Finance (if amount ≥ 100)",
    labelAr: "رئيس القسم → المالية (إذا المبلغ ≥ 100)",
    steps: [
      { id: "p3a", type: "approval", approverType: "department_head", approvalMode: "single", title: "Department Head", titleAr: "رئيس القسم" },
      {
        id: "p3b", type: "approval", approverType: "role", approverRole: "admin",
        approvalMode: "single", title: "Finance Approval", titleAr: "موافقة المالية",
        condition: { field: "amount", operator: "gte", value: "100" },
      },
    ],
  },
];

function newStep(): FormWorkflowStepPlan {
  return {
    id: `step-${Date.now()}`,
    type: "approval",
    approverType: "manager",
    approvalMode: "single",
    title: "Approval step",
    titleAr: "خطوة موافقة",
  };
}

export default function FormWorkflowBuilder({ value, onChange, isAr, formName, autoEvent }: Props) {
  const { data: usersRaw } = useListUsers({});
  const users = Array.isArray(usersRaw) ? usersRaw : [];

  function updateStep(idx: number, patch: Partial<FormWorkflowStepPlan>) {
    const steps = value.steps.map((s, i) => (i === idx ? { ...s, ...patch } : s));
    onChange({ ...value, steps });
  }

  function removeStep(idx: number) {
    onChange({ ...value, steps: value.steps.filter((_, i) => i !== idx) });
  }

  function addStep() {
    onChange({ ...value, steps: [...value.steps, newStep()] });
  }

  function applyPreset(steps: FormWorkflowStepPlan[]) {
    onChange({ enabled: true, steps: steps.map((s) => ({ ...s, id: `${s.id}-${Date.now()}` })) });
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between rounded-lg border p-4 bg-muted/30 gap-4">
        <div>
          <p className="text-sm font-medium flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-primary" />
            {isAr ? "تفعيل مسار الموافقة" : "Enable approval workflow"}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            <Link href="/process-templates" className="text-primary hover:underline">
              {isAr ? "قوالب العمليات المعتمدة" : "Org process templates"}
            </Link>
            {" · "}
            {isAr
              ? "يُنشأ سير عمل تلقائي (مسودة) — فعّله لاحقاً من صفحة سير العمل."
              : "A draft workflow is auto-created — activate it later from the Workflows page."}
          </p>
        </div>
        <Switch
          checked={value.enabled}
          onCheckedChange={(enabled) => onChange({ ...value, enabled, steps: value.steps.length ? value.steps : [newStep()] })}
        />
      </div>

      {value.enabled && (
        <>
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 flex items-start gap-3">
            <Zap className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <FieldGroup>
              <p className="text-xs text-muted-foreground">{isAr ? "حدث التوجيه (يُولَّد تلقائياً)" : "Routing event (auto-generated)"}</p>
              <code className="text-sm font-mono text-primary break-all">{autoEvent || "module.form_name.submitted"}</code>
              {formName && (
                <p className="text-xs text-muted-foreground mt-1">
                  {isAr ? `مرتبط بنموذج: ${formName}` : `Linked to form: ${formName}`}
                </p>
              )}
            </FieldGroup>
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">{isAr ? "قوالب جاهزة" : "Quick templates"}</CardTitle>
              <CardDescription className="text-xs">
                {isAr ? "ابدأ من مسار شائع ثم عدّل حسب حاجتك" : "Start from a common pattern, then customize"}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <Button key={p.labelEn} type="button" variant="outline" size="sm" onClick={() => applyPreset(p.steps)}>
                  {isAr ? p.labelAr : p.labelEn}
                </Button>
              ))}
            </CardContent>
          </Card>

          <div className="space-y-3">
            {value.steps.map((step, idx) => (
              <div key={step.id}>
                <Card>
                  <CardHeader className="py-3 px-4">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">{idx + 1}</Badge>
                        <ClipboardCheck className="w-4 h-4 text-amber-600" />
                        <CardTitle className="text-sm">{isAr ? "خطوة موافقة" : "Approval step"}</CardTitle>
                      </div>
                      {value.steps.length > 1 && (
                        <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeStep(idx)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3 pt-0 px-4 pb-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs">{isAr ? "المعتمد" : "Approver"}</Label>
                        <Select value={step.approverType ?? "manager"} onValueChange={(v) => updateStep(idx, { approverType: v as WorkflowApproverType })}>
                          <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {APPROVER_OPTIONS.map((o) => (
                              <SelectItem key={o.value} value={o.value}>{isAr ? o.labelAr : o.labelEn}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">{isAr ? "نمط الموافقة" : "Approval mode"}</Label>
                        <Select value={step.approvalMode ?? "single"} onValueChange={(v) => updateStep(idx, { approvalMode: v as FormWorkflowStepPlan["approvalMode"] })}>
                          <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="single">{isAr ? "موافقة واحدة" : "Single approver"}</SelectItem>
                            <SelectItem value="any">{isAr ? "أي واحد يكفي" : "Any one approves"}</SelectItem>
                            <SelectItem value="all">{isAr ? "الجميع يوافقون" : "All must approve"}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    {step.approverType === "role" && (
                      <FieldGroup>
                        <Label className="text-xs">{isAr ? "دور المنصة" : "Platform role"}</Label>
                        <Select value={step.approverRole ?? "admin"} onValueChange={(v) => updateStep(idx, { approverRole: v })}>
                          <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="admin">Admin</SelectItem>
                            <SelectItem value="manager">Manager</SelectItem>
                            <SelectItem value="member">Member</SelectItem>
                          </SelectContent>
                        </Select>
                      </FieldGroup>
                    )}

                    {step.approverType === "specific" && (
                      <FieldGroup>
                        <Label className="text-xs">{isAr ? "المستخدم" : "User"}</Label>
                        <Select value={String(step.approverUserIds?.[0] ?? "")} onValueChange={(v) => updateStep(idx, { approverUserIds: [Number(v)] })}>
                          <SelectTrigger className="h-9"><SelectValue placeholder={isAr ? "اختر مستخدماً" : "Select user"} /></SelectTrigger>
                          <SelectContent>
                            {users.map((u) => (
                              <SelectItem key={u.id} value={String(u.id)}>{u.name ?? u.email ?? `#${u.id}`}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FieldGroup>
                    )}

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs">{isAr ? "عنوان الخطوة (EN)" : "Step title (EN)"}</Label>
                        <Input className="h-9 text-sm" value={step.title ?? ""} onChange={(e) => updateStep(idx, { title: e.target.value })} />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">{isAr ? "عنوان الخطوة (AR)" : "Step title (AR)"}</Label>
                        <Input className="h-9 text-sm" dir="rtl" value={step.titleAr ?? ""} onChange={(e) => updateStep(idx, { titleAr: e.target.value })} />
                      </div>
                    </div>

                    <div className="rounded-lg border border-dashed p-3 space-y-2 bg-muted/10">
                      <Label className="text-xs text-muted-foreground">{isAr ? "شرط اختياري (مثال: amount ≥ 100)" : "Optional condition (e.g. amount ≥ 100)"}</Label>
                      <div className="grid grid-cols-3 gap-2">
                        <Input
                          className="h-8 text-xs"
                          placeholder={isAr ? "حقل النموذج" : "Form field"}
                          value={step.condition?.field ?? ""}
                          onChange={(e) => updateStep(idx, { condition: { ...(step.condition ?? { operator: "gte", value: "" }), field: e.target.value } })}
                        />
                        <Select value={step.condition?.operator ?? "gte"} onValueChange={(v) => updateStep(idx, { condition: { ...(step.condition ?? { field: "", value: "" }), operator: v } })}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="gte">≥</SelectItem>
                            <SelectItem value="gt">&gt;</SelectItem>
                            <SelectItem value="lte">≤</SelectItem>
                            <SelectItem value="eq">=</SelectItem>
                          </SelectContent>
                        </Select>
                        <Input
                          className="h-8 text-xs"
                          placeholder={isAr ? "القيمة" : "Value"}
                          value={step.condition?.value ?? ""}
                          onChange={(e) => updateStep(idx, { condition: { ...(step.condition ?? { field: "", operator: "gte" }), value: e.target.value } })}
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>
                {idx < value.steps.length - 1 && (
                  <div className="flex justify-center py-1 text-muted-foreground">
                    <ArrowDown className="w-4 h-4" />
                  </div>
                )}
              </div>
            ))}

            <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={addStep}>
              <Plus className="w-4 h-4" />
              {isAr ? "إضافة خطوة موافقة" : "Add approval step"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function FieldGroup({ children }: { children: React.ReactNode }) {
  return <div className="space-y-1.5">{children}</div>;
}
