import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { useCreateForm } from "@workspace/api-client-react";
import {
  ArrowLeft, ClipboardList, Loader2, ConciergeBell, Users, GitBranch, FileText, Eye,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import FormAudienceBuilder from "@/components/forms/form-audience-builder";
import FormWorkflowBuilder from "@/components/forms/form-workflow-builder";
import {
  FORM_CATEGORIES, DEFAULT_AUDIENCE, DEFAULT_WORKFLOW_PLAN,
  buildFormWorkflowEventPreview, type FormAudienceConfig, type FormWorkflowPlan,
} from "@/lib/form-smart-types";

const MODULES = [
  { value: "system",    labelEn: "General / System", labelAr: "عام / النظام" },
  { value: "hr",        labelEn: "Human Resources",  labelAr: "الموارد البشرية" },
  { value: "tickets",   labelEn: "Tickets & IT",     labelAr: "التذاكر والدعم" },
  { value: "approvals", labelEn: "Approvals",        labelAr: "الموافقات" },
  { value: "forms",     labelEn: "Forms",            labelAr: "النماذج" },
];

type TabId = "info" | "audience" | "workflow" | "preview";

export default function AdminFormsNewPage() {
  const { i18n } = useTranslation();
  const isAr = i18n.language.startsWith("ar");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const createForm = useCreateForm();

  const [tab, setTab] = useState<TabId>("info");
  const [name, setName]               = useState("");
  const [nameAr, setNameAr]           = useState("");
  const [description, setDescription] = useState("");
  const [descriptionAr, setDescriptionAr] = useState("");
  const [module, setModule]           = useState("hr");
  const [category, setCategory]       = useState("general");
  const [customCategory, setCustomCategory] = useState("");
  const [status, setStatus]           = useState("draft");
  const [showInSelfService, setShowInSelfService] = useState(true);
  const [audience, setAudience] = useState<FormAudienceConfig>(DEFAULT_AUDIENCE);
  const [workflowPlan, setWorkflowPlan] = useState<FormWorkflowPlan>(DEFAULT_WORKFLOW_PLAN);

  const autoEvent = useMemo(() => buildFormWorkflowEventPreview(module, name || "form"), [module, name]);
  const resolvedCategory = category === "other" ? (customCategory.trim() || "other") : category;

  const TABS: { id: TabId; labelEn: string; labelAr: string; icon: React.ElementType }[] = [
    { id: "info",     labelEn: "Form info",      labelAr: "معلومات النموذج", icon: FileText },
    { id: "audience", labelEn: "Who can access", labelAr: "من يمكنه الوصول", icon: Users },
    { id: "workflow", labelEn: "Approval path",  labelAr: "مسار الموافقة",   icon: GitBranch },
    { id: "preview",  labelEn: "Preview",        labelAr: "معاينة",          icon: Eye },
  ];

  function handleSubmit() {
    if (!name.trim()) {
      toast({ title: isAr ? "الاسم مطلوب" : "Name is required", variant: "destructive" });
      setTab("info");
      return;
    }

    createForm.mutate(
      {
        data: {
          name: name.trim(),
          nameAr: nameAr.trim() || undefined,
          description: description.trim() || undefined,
          descriptionAr: descriptionAr.trim() || undefined,
          module,
          category: resolvedCategory,
          status: status as "draft" | "active" | "archived",
          showInSelfService,
          audience,
          workflowPlan,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      },
      {
        onSuccess: (form) => {
          toast({
            title: isAr
              ? "تم إنشاء النموذج — أضف الحقول ثم فعّل سير العمل"
              : "Form created — add fields, then activate the workflow",
          });
          navigate(`/admin/hr/forms/${form.id}`);
        },
        onError: () => {
          toast({ title: isAr ? "فشل الإنشاء" : "Failed to create", variant: "destructive" });
        },
      },
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <Button variant="ghost" size="sm" onClick={() => navigate("/admin/hr/forms")} className="-ml-2">
        <ArrowLeft className="w-4 h-4 mr-1" />
        {isAr ? "إدارة النماذج" : "Manage Forms"}
      </Button>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <ClipboardList className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{isAr ? "نموذج ذكي جديد" : "New Smart Form"}</h1>
            <p className="text-muted-foreground text-sm">
              {isAr
                ? "حدّد الجمهور ومسار الموافقة بصرياً — بدون أكواد تقنية"
                : "Configure audience and approval path visually — no technical codes"}
            </p>
          </div>
        </div>
        <Button onClick={handleSubmit} disabled={createForm.isPending} className="shrink-0">
          {createForm.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          {isAr ? "إنشاء النموذج" : "Create Form"}
        </Button>
      </div>

      <div className="flex gap-1 border-b border-border overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap",
              tab === t.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <t.icon className="w-4 h-4" />
            {isAr ? t.labelAr : t.labelEn}
          </button>
        ))}
      </div>

      {tab === "info" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{isAr ? "معلومات النموذج" : "Form Information"}</CardTitle>
            <CardDescription>
              {isAr ? "أضف الحقول بعد الإنشاء من صفحة التفاصيل" : "Add fields after creation from the detail page"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>{isAr ? "الاسم (EN)" : "Name (EN)"} <span className="text-destructive">*</span></Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Leave Request" />
              </div>
              <FieldGroup>
                <Label>{isAr ? "الاسم (AR)" : "Name (AR)"}</Label>
                <Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} placeholder="طلب إجازة" dir="rtl" />
              </FieldGroup>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>{isAr ? "الوصف (EN)" : "Description (EN)"}</Label>
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
              </div>
              <div className="space-y-1.5">
                <Label>{isAr ? "الوصف (AR)" : "Description (AR)"}</Label>
                <Textarea value={descriptionAr} onChange={(e) => setDescriptionAr(e.target.value)} rows={3} dir="rtl" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>{isAr ? "الوحدة" : "Module"}</Label>
                <Select value={module} onValueChange={setModule}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MODULES.map((m) => (
                      <SelectItem key={m.value} value={m.value}>{isAr ? m.labelAr : m.labelEn}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{isAr ? "الفئة" : "Category"}</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FORM_CATEGORIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>{isAr ? c.labelAr : c.labelEn}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {category === "other" && (
                  <Input
                    value={customCategory}
                    onChange={(e) => setCustomCategory(e.target.value)}
                    placeholder={isAr ? "فئة مخصصة" : "Custom category"}
                    className="mt-2"
                  />
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>{isAr ? "الحالة" : "Status"}</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">{isAr ? "مسودة" : "Draft"}</SelectItem>
                  <SelectItem value="active">{isAr ? "نشط" : "Active"}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between rounded-lg border p-4 bg-muted/30">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                    <ConciergeBell className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{isAr ? "إظهار في الخدمات الذاتية" : "Show in Self-Service Portal"}</p>
                    <p className="text-xs text-muted-foreground">
                      {isAr ? "يتيح للموظفين رؤية النموذج وتقديمه" : "Employees can browse and submit this form"}
                    </p>
                  </div>
                </div>
                <Switch checked={showInSelfService} onCheckedChange={setShowInSelfService} />
            </div>
          </CardContent>
        </Card>
      )}

      {tab === "audience" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{isAr ? "من يمكنه الوصول؟" : "Who can access this form?"}</CardTitle>
            <CardDescription>
              {isAr
                ? "حدّد الجمهور المستهدف — جميع الموظفين، مستوى دور، أو فئات محددة"
                : "Target all employees, a role level, or specific org groups"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FormAudienceBuilder
              value={audience}
              onChange={setAudience}
              isAr={isAr}
              showInSelfService={showInSelfService}
            />
          </CardContent>
        </Card>
      )}

      {tab === "workflow" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{isAr ? "مسار الموافقة" : "Approval workflow"}</CardTitle>
            <CardDescription>
              {isAr
                ? "ارسم خطوات الموافقة — المدير، الموارد البشرية، المالية… مع شروط اختيارية"
                : "Build approval steps — manager, HR, finance… with optional conditions"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FormWorkflowBuilder
              value={workflowPlan}
              onChange={setWorkflowPlan}
              isAr={isAr}
              formName={name || (isAr ? "النموذج" : "Form")}
              autoEvent={autoEvent}
            />
          </CardContent>
        </Card>
      )}

      {tab === "preview" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{isAr ? "ملخص" : "Summary"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div>
              <p className="font-medium">{name || (isAr ? "بدون اسم" : "Untitled")}</p>
              {nameAr && <p className="text-muted-foreground" dir="rtl">{nameAr}</p>}
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-lg border p-3">
                <p className="text-muted-foreground">{isAr ? "الفئة" : "Category"}</p>
                <p className="font-medium capitalize">{resolvedCategory}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-muted-foreground">{isAr ? "الخدمات الذاتية" : "Self-service"}</p>
                <p className="font-medium">{showInSelfService ? (isAr ? "نعم" : "Yes") : (isAr ? "لا" : "No")}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-muted-foreground">{isAr ? "الجمهور" : "Audience"}</p>
                <p className="font-medium capitalize">{audience.mode ?? "all"}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-muted-foreground">{isAr ? "مسار الموافقة" : "Workflow"}</p>
                <p className="font-medium">
                  {workflowPlan.enabled
                    ? `${workflowPlan.steps.length} ${isAr ? "خطوات" : "steps"}`
                    : (isAr ? "معطّل" : "Disabled")}
                </p>
              </div>
            </div>
            {workflowPlan.enabled && (
              <code className="block text-xs font-mono text-primary bg-primary/5 p-2 rounded">{autoEvent}</code>
            )}
          </CardContent>
        </Card>
      )}

      <div className="flex gap-3 justify-end pb-8">
        <Button variant="outline" onClick={() => navigate("/admin/hr/forms")}>
          {isAr ? "إلغاء" : "Cancel"}
        </Button>
        <Button onClick={handleSubmit} disabled={createForm.isPending}>
          {createForm.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          {isAr ? "إنشاء النموذج" : "Create Form"}
        </Button>
      </div>
    </div>
  );
}

function FieldGroup({ children }: { children: React.ReactNode }) {
  return <div className="space-y-1.5">{children}</div>;
}
