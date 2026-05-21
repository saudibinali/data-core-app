import { useState } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { useCreateForm } from "@workspace/api-client-react";
import { ArrowLeft, ClipboardList, Loader2, ConciergeBell } from "lucide-react";
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

const MODULES = [
  { value: "hr",        label: "HR" },
  { value: "tickets",   label: "Tickets" },
  { value: "approvals", label: "Approvals" },
  { value: "system",    label: "System / General" },
  { value: "forms",     label: "Forms" },
];

export default function AdminFormsNewPage() {
  const { i18n } = useTranslation();
  const isAr = i18n.language.startsWith("ar");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const createForm = useCreateForm();

  const [name, setName]               = useState("");
  const [nameAr, setNameAr]           = useState("");
  const [description, setDescription] = useState("");
  const [descriptionAr, setDescriptionAr] = useState("");
  const [module, setModule]           = useState("system");
  const [category, setCategory]       = useState("");
  const [status, setStatus]           = useState("draft");
  const [workflowEvent, setWorkflowEvent] = useState("");
  const [showInSelfService, setShowInSelfService] = useState(false);
  const [visibleTo, setVisibleTo] = useState("all");

  function handleSubmit() {
    if (!name.trim()) {
      toast({ title: isAr ? "الاسم مطلوب" : "Name is required", variant: "destructive" });
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
          category: category.trim() || undefined,
          status: status as "draft" | "active" | "archived",
          workflowEvent: workflowEvent.trim() || undefined,
          showInSelfService,
          permissions: { visibleTo } as Record<string, unknown>,
        },
      },
      {
        onSuccess: (form) => {
          toast({ title: isAr ? "تم إنشاء النموذج وتسجيله تلقائياً في الصلاحيات" : "Form created and auto-registered in Roles & Permissions" });
          navigate(`/admin/hr/forms/${form.id}`);
        },
        onError: () => {
          toast({ title: isAr ? "فشل الإنشاء" : "Failed to create form", variant: "destructive" });
        },
      },
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <Button variant="ghost" size="sm" onClick={() => navigate("/admin/hr/forms")} className="-ml-2">
        <ArrowLeft className="w-4 h-4 mr-1" />
        {isAr ? "إدارة النماذج" : "Manage Forms"}
      </Button>

      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-primary/10">
          <ClipboardList className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">{isAr ? "نموذج جديد" : "New Form"}</h1>
          <p className="text-muted-foreground text-sm">
            {isAr ? "أنشئ نموذجًا جديدًا وأضف الحقول لاحقًا" : "Create a new form, then add fields"}
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{isAr ? "معلومات النموذج" : "Form Information"}</CardTitle>
          <CardDescription>
            {isAr ? "أضف الحقول بعد الإنشاء من صفحة التفاصيل" : "Add fields after creation from the detail page"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Name */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>{isAr ? "الاسم (EN)" : "Name (EN)"} <span className="text-destructive">*</span></Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Leave Request"
              />
            </div>
            <div className="space-y-1.5">
              <Label>{isAr ? "الاسم (AR)" : "Name (AR)"}</Label>
              <Input
                value={nameAr}
                onChange={(e) => setNameAr(e.target.value)}
                placeholder="مثال: طلب إجازة"
                dir="rtl"
              />
            </div>
          </div>

          {/* Description */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>{isAr ? "الوصف (EN)" : "Description (EN)"}</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What is this form for?"
                rows={3}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{isAr ? "الوصف (AR)" : "Description (AR)"}</Label>
              <Textarea
                value={descriptionAr}
                onChange={(e) => setDescriptionAr(e.target.value)}
                placeholder="ما الغرض من هذا النموذج؟"
                rows={3}
                dir="rtl"
              />
            </div>
          </div>

          {/* Module & Category */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>{isAr ? "الوحدة" : "Module"} <span className="text-destructive">*</span></Label>
              <Select value={module} onValueChange={setModule}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODULES.map((m) => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{isAr ? "الفئة (اختياري)" : "Category (optional)"}</Label>
              <Input
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="e.g. leave, finance, it"
              />
            </div>
          </div>

          {/* Status & workflow event */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>{isAr ? "الحالة" : "Status"}</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">{isAr ? "مسودة" : "Draft"}</SelectItem>
                  <SelectItem value="active">{isAr ? "نشط" : "Active"}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{isAr ? "حدث سير العمل" : "Workflow Event"}</Label>
              <Input
                value={workflowEvent}
                onChange={(e) => setWorkflowEvent(e.target.value)}
                placeholder="e.g. leave.requested"
              />
            </div>
          </div>

          {/* Self-Service Portal toggle */}
          <div className="flex items-center justify-between rounded-lg border p-4 bg-muted/30">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <ConciergeBell className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium">{isAr ? "إظهار في الخدمات الذاتية" : "Show in Self-Service Portal"}</p>
                <p className="text-xs text-muted-foreground">
                  {isAr ? "يتيح للموظفين رؤية هذا النموذج وتقديمه مباشرة" : "Employees can see and submit this form directly"}
                </p>
              </div>
            </div>
            <Switch checked={showInSelfService} onCheckedChange={setShowInSelfService} />
          </div>

          {/* Visibility control */}
          {showInSelfService && (
            <div className="space-y-1.5">
              <Label>{isAr ? "مرئي في الخدمات الذاتية لـ" : "Visible in Self-Service to"}</Label>
              <Select value={visibleTo} onValueChange={setVisibleTo}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{isAr ? "الجميع" : "Everyone"}</SelectItem>
                  <SelectItem value="member">{isAr ? "الموظفون فقط" : "Employees only"}</SelectItem>
                  <SelectItem value="manager_above">{isAr ? "المدراء فما فوق" : "Managers & above"}</SelectItem>
                  <SelectItem value="admin_only">{isAr ? "المشرفون فقط" : "Admins only"}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {isAr
                  ? "يُحدّد من يمكنه رؤية هذا النموذج وتقديمه في بوابة الخدمات الذاتية"
                  : "Controls who can see and submit this form in the self-service portal"}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex gap-3 justify-end">
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
