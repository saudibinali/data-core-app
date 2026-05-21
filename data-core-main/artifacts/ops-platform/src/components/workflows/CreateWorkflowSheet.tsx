import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import {
  useCreateWorkflow,
  useListEventRegistry,
} from "@workspace/api-client-react";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Trash2, Bell, ClipboardCheck, GitMerge,
  Clock, UserCheck, Loader2, ChevronDown, Zap, AlertCircle,
  CheckSquare,
} from "lucide-react";
import { cn } from "@/lib/utils";
import DynamicConditionBuilder, {
  type ConditionGroup,
} from "./DynamicConditionBuilder";
import { parseEventSchema } from "./event-field-types";

// ── Step types ────────────────────────────────────────────────────────────────

type StepType = "notification" | "task" | "approval" | "condition" | "status_update" | "assignment" | "delay";

interface WorkflowStep {
  index: number;
  type: StepType;
  name: string;
  config: Record<string, unknown>;
}

const STEP_TYPES: { value: StepType; label: string; labelAr: string; icon: React.ElementType; color: string }[] = [
  { value: "notification",  label: "Send Notification", labelAr: "إرسال إشعار",    icon: Bell,           color: "text-blue-600" },
  { value: "task",          label: "Create Task",        labelAr: "إنشاء مهمة",      icon: CheckSquare,    color: "text-violet-600" },
  { value: "approval",      label: "Request Approval",   labelAr: "طلب موافقة",      icon: ClipboardCheck, color: "text-amber-600" },
  { value: "condition",     label: "Condition Branch",   labelAr: "فرع شرطي",        icon: GitMerge,       color: "text-teal-600" },
  { value: "status_update", label: "Update Status",      labelAr: "تحديث الحالة",    icon: UserCheck,      color: "text-emerald-600" },
  { value: "assignment",    label: "Assign User",        labelAr: "تعيين مستخدم",    icon: UserCheck,      color: "text-indigo-600" },
  { value: "delay",         label: "Delay",              labelAr: "تأخير",           icon: Clock,          color: "text-slate-500" },
];

const ROLES          = ["admin", "manager", "member"];
const PRIORITIES     = ["low", "medium", "high", "urgent"];
const RECIPIENT_TYPES = ["creator", "assignee", "manager", "role", "all_admins"];
const ASSIGNEE_TYPES = ["creator", "role", "manager"];

function defaultConfig(type: StepType): Record<string, unknown> {
  switch (type) {
    case "notification":  return { recipientType: "creator", title: "", message: "" };
    case "task":          return { title: "", description: "", assigneeType: "role", assigneeRole: "admin", priority: "medium", dueDays: 3 };
    case "approval":      return { title: "", description: "", approverRole: "admin" };
    case "condition":     return { conditions: { logic: "and", conditions: [] } };
    case "status_update": return { targetStatus: "" };
    case "assignment":    return { assigneeType: "role", assigneeRole: "admin" };
    case "delay":         return { delayMinutes: 60 };
    default:              return {};
  }
}

// ── Step config editors ───────────────────────────────────────────────────────

function Sel({ value, onValue, options, placeholder, className }: {
  value: string; onValue: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string; className?: string;
}) {
  return (
    <Select value={value} onValueChange={onValue}>
      <SelectTrigger className={cn("h-8 text-xs", className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => <SelectItem key={o.value} value={o.value} className="text-xs capitalize">{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function NotificationConfig({ config, onChange, isAr }: { config: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void; isAr: boolean }) {
  const set = (k: string, v: unknown) => onChange({ ...config, [k]: v });
  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">{isAr ? "نوع المستلم" : "Recipient"}</Label>
        <Sel className="mt-1" value={String(config.recipientType ?? "creator")} onValue={(v) => set("recipientType", v)}
          options={RECIPIENT_TYPES.map((r) => ({ value: r, label: r }))} />
      </div>
      {config.recipientType === "role" && (
        <div>
          <Label className="text-xs">{isAr ? "الدور" : "Role"}</Label>
          <Sel className="mt-1" value={String(config.recipientRole ?? "admin")} onValue={(v) => set("recipientRole", v)}
            options={ROLES.map((r) => ({ value: r, label: r }))} />
        </div>
      )}
      <div>
        <Label className="text-xs">{isAr ? "العنوان" : "Title"} *</Label>
        <Input className="h-8 text-xs mt-1" value={String(config.title ?? "")} onChange={(e) => set("title", e.target.value)}
          placeholder={isAr ? "عنوان الإشعار" : "Notification title"} />
      </div>
      <div>
        <Label className="text-xs">{isAr ? "الرسالة" : "Message"}</Label>
        <Textarea className="text-xs mt-1 min-h-[56px] resize-none" value={String(config.message ?? "")} onChange={(e) => set("message", e.target.value)}
          placeholder={isAr ? "نص الإشعار" : "Notification body"} />
      </div>
      <div>
        <Label className="text-xs">{isAr ? "الرابط" : "Link (optional)"}</Label>
        <Input className="h-8 text-xs mt-1" value={String(config.link ?? "")} onChange={(e) => set("link", e.target.value)} placeholder="/tickets" />
      </div>
    </div>
  );
}

function TaskConfig({ config, onChange, isAr }: { config: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void; isAr: boolean }) {
  const set = (k: string, v: unknown) => onChange({ ...config, [k]: v });
  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">{isAr ? "عنوان المهمة" : "Task Title"} *</Label>
        <Input className="h-8 text-xs mt-1" value={String(config.title ?? "")} onChange={(e) => set("title", e.target.value)}
          placeholder={isAr ? "عنوان المهمة" : "Task title"} />
      </div>
      <div>
        <Label className="text-xs">{isAr ? "الوصف" : "Description"}</Label>
        <Textarea className="text-xs mt-1 min-h-[56px] resize-none" value={String(config.description ?? "")} onChange={(e) => set("description", e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">{isAr ? "نوع المسؤول" : "Assignee"}</Label>
          <Sel className="mt-1" value={String(config.assigneeType ?? "role")} onValue={(v) => set("assigneeType", v)}
            options={ASSIGNEE_TYPES.map((r) => ({ value: r, label: r }))} />
        </div>
        {config.assigneeType === "role" && (
          <div>
            <Label className="text-xs">{isAr ? "الدور" : "Role"}</Label>
            <Sel className="mt-1" value={String(config.assigneeRole ?? "admin")} onValue={(v) => set("assigneeRole", v)}
              options={ROLES.map((r) => ({ value: r, label: r }))} />
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">{isAr ? "الأولوية" : "Priority"}</Label>
          <Sel className="mt-1" value={String(config.priority ?? "medium")} onValue={(v) => set("priority", v)}
            options={PRIORITIES.map((p) => ({ value: p, label: p }))} />
        </div>
        <div>
          <Label className="text-xs">{isAr ? "الاستحقاق (أيام)" : "Due (days)"}</Label>
          <Input type="number" min={1} className="h-8 text-xs mt-1" value={String(config.dueDays ?? 3)}
            onChange={(e) => set("dueDays", parseInt(e.target.value) || 3)} />
        </div>
      </div>
    </div>
  );
}

function ApprovalConfig({ config, onChange, isAr }: { config: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void; isAr: boolean }) {
  const set = (k: string, v: unknown) => onChange({ ...config, [k]: v });
  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">{isAr ? "عنوان الموافقة" : "Approval Title"} *</Label>
        <Input className="h-8 text-xs mt-1" value={String(config.title ?? "")} onChange={(e) => set("title", e.target.value)} />
      </div>
      <div>
        <Label className="text-xs">{isAr ? "الوصف" : "Description"}</Label>
        <Textarea className="text-xs mt-1 min-h-[56px] resize-none" value={String(config.description ?? "")} onChange={(e) => set("description", e.target.value)} />
      </div>
      <div>
        <Label className="text-xs">{isAr ? "دور المعتمِد" : "Approver Role"}</Label>
        <Sel className="mt-1" value={String(config.approverRole ?? "admin")} onValue={(v) => set("approverRole", v)}
          options={ROLES.map((r) => ({ value: r, label: r }))} />
      </div>
    </div>
  );
}

function DelayConfig({ config, onChange, isAr }: { config: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void; isAr: boolean }) {
  return (
    <div>
      <Label className="text-xs">{isAr ? "مدة التأخير (دقائق)" : "Delay duration (minutes)"}</Label>
      <Input type="number" min={1} className="h-8 text-xs mt-1" value={String(config.delayMinutes ?? 60)}
        onChange={(e) => onChange({ ...config, delayMinutes: parseInt(e.target.value) || 60 })} />
    </div>
  );
}

function AssignmentConfig({ config, onChange, isAr }: { config: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void; isAr: boolean }) {
  const set = (k: string, v: unknown) => onChange({ ...config, [k]: v });
  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">{isAr ? "نوع المعيَّن" : "Assignee Type"}</Label>
        <Sel className="mt-1" value={String(config.assigneeType ?? "role")} onValue={(v) => set("assigneeType", v)}
          options={ASSIGNEE_TYPES.map((r) => ({ value: r, label: r }))} />
      </div>
      {config.assigneeType === "role" && (
        <div>
          <Label className="text-xs">{isAr ? "الدور" : "Role"}</Label>
          <Sel className="mt-1" value={String(config.assigneeRole ?? "admin")} onValue={(v) => set("assigneeRole", v)}
            options={ROLES.map((r) => ({ value: r, label: r }))} />
        </div>
      )}
    </div>
  );
}

function StatusUpdateConfig({ config, onChange, isAr }: { config: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void; isAr: boolean }) {
  return (
    <div>
      <Label className="text-xs">{isAr ? "الحالة الجديدة" : "New Status"} *</Label>
      <Input className="h-8 text-xs mt-1" value={String(config.targetStatus ?? "")}
        onChange={(e) => onChange({ ...config, targetStatus: e.target.value })}
        placeholder="e.g. resolved, closed, in_progress" />
    </div>
  );
}

function StepConfigEditor({ step, onChange, isAr }: { step: WorkflowStep; onChange: (s: WorkflowStep) => void; isAr: boolean }) {
  const upd = (c: Record<string, unknown>) => onChange({ ...step, config: c });
  switch (step.type) {
    case "notification":  return <NotificationConfig config={step.config} onChange={upd} isAr={isAr} />;
    case "task":          return <TaskConfig         config={step.config} onChange={upd} isAr={isAr} />;
    case "approval":      return <ApprovalConfig     config={step.config} onChange={upd} isAr={isAr} />;
    case "delay":         return <DelayConfig        config={step.config} onChange={upd} isAr={isAr} />;
    case "assignment":    return <AssignmentConfig   config={step.config} onChange={upd} isAr={isAr} />;
    case "status_update": return <StatusUpdateConfig config={step.config} onChange={upd} isAr={isAr} />;
    case "condition":
      return <p className="text-xs text-muted-foreground italic">Branching logic is evaluated at runtime based on the conditions defined above.</p>;
    default: return null;
  }
}

// ── Step card ─────────────────────────────────────────────────────────────────

function StepCard({ step, index, total, onChange, onRemove, onMoveUp, onMoveDown, isAr }: {
  step: WorkflowStep; index: number; total: number;
  onChange: (s: WorkflowStep) => void; onRemove: () => void;
  onMoveUp: () => void; onMoveDown: () => void; isAr: boolean;
}) {
  const meta = STEP_TYPES.find((t) => t.value === step.type);
  const Icon = meta?.icon ?? Bell;

  return (
    <div className="border border-border rounded-lg bg-background overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/30">
        <div className="flex flex-col gap-0.5 shrink-0">
          <button onClick={onMoveUp} disabled={index === 0} className="p-0.5 rounded hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed">
            <ChevronDown className="w-3 h-3 rotate-180" />
          </button>
          <button onClick={onMoveDown} disabled={index === total - 1} className="p-0.5 rounded hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed">
            <ChevronDown className="w-3 h-3" />
          </button>
        </div>

        <div className={cn("w-5 h-5 rounded flex items-center justify-center shrink-0", meta?.color)}>
          <Icon className="w-3 h-3" />
        </div>

        <div className="flex-1 min-w-0">
          <Select
            value={step.type}
            onValueChange={(v) => onChange({ ...step, type: v as StepType, config: defaultConfig(v as StepType) })}
          >
            <SelectTrigger className="h-6 text-xs border-0 bg-transparent p-0 gap-1 w-auto focus:ring-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STEP_TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value} className="text-xs">
                  {isAr ? t.labelAr : t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Badge variant="outline" className="text-[10px] shrink-0">{isAr ? "الخطوة" : "Step"} {index + 1}</Badge>

        <button onClick={onRemove} className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0">
          <Trash2 className="w-3 h-3" />
        </button>
      </div>

      <div className="p-3 space-y-3">
        <div>
          <Label className="text-xs">{isAr ? "اسم الخطوة" : "Step Name"}</Label>
          <Input className="h-8 text-xs mt-1" value={step.name} onChange={(e) => onChange({ ...step, name: e.target.value })}
            placeholder={isAr ? "وصف مختصر للخطوة" : "Brief step description"} />
        </div>
        <StepConfigEditor step={step} onChange={onChange} isAr={isAr} />
      </div>
    </div>
  );
}

// ── MODULES ───────────────────────────────────────────────────────────────────
// Derived dynamically from the event registry response
const FALLBACK_MODULES = ["tickets", "users", "departments", "approvals", "groups", "hr", "calendar", "system"];

// ── Main Sheet ────────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated?: (id: number) => void;
}

export default function CreateWorkflowSheet({ open, onClose, onCreated }: Props) {
  const { i18n } = useTranslation();
  const isAr = i18n.language.startsWith("ar");
  const { toast } = useToast();
  const [, navigate] = useLocation();

  // ── Form state ─────────────────────────────────────────────────────────────
  const [name,          setName]          = useState("");
  const [nameAr,        setNameAr]        = useState("");
  const [description,   setDescription]   = useState("");
  const [descriptionAr, setDescriptionAr] = useState("");
  const [module,        setModule]        = useState("");
  const [triggerEvent,  setTriggerEvent]  = useState("");
  const [isActive,      setIsActive]      = useState(true);
  const [conditions,    setConditions]    = useState<ConditionGroup>({ logic: "and", conditions: [] });
  const [steps,         setSteps]         = useState<WorkflowStep[]>([]);
  const [errors,        setErrors]        = useState<Record<string, string>>({});

  // ── Event registry ─────────────────────────────────────────────────────────
  const { data: eventRegistry } = useListEventRegistry();

  // Dynamic module list from registry
  const modules = useMemo(() => {
    if (!eventRegistry?.length) return FALLBACK_MODULES;
    const seen = new Set<string>();
    eventRegistry.forEach((e) => { if (e.module) seen.add(e.module); });
    return Array.from(seen).sort();
  }, [eventRegistry]);

  // Events filtered by selected module
  const filteredEvents = useMemo(
    () => (module ? (eventRegistry ?? []).filter((e) => e.module === module) : (eventRegistry ?? [])),
    [eventRegistry, module],
  );

  // Schema of the selected trigger event - drives condition builder
  const selectedEventSchema = useMemo(() => {
    if (!triggerEvent) return null;
    const entry = (eventRegistry ?? []).find((e) => e.eventName === triggerEvent);
    if (!entry?.schema) return null;
    return parseEventSchema(entry.schema);
  }, [eventRegistry, triggerEvent]);

  // Reset trigger event + conditions when module changes
  useEffect(() => {
    setTriggerEvent("");
    setConditions({ logic: "and", conditions: [] });
  }, [module]);

  // Reset conditions when trigger event changes
  useEffect(() => {
    setConditions({ logic: "and", conditions: [] });
  }, [triggerEvent]);

  // Reset whole form when sheet closes
  useEffect(() => {
    if (!open) {
      setName(""); setNameAr(""); setDescription(""); setDescriptionAr("");
      setModule(""); setTriggerEvent(""); setIsActive(true);
      setConditions({ logic: "and", conditions: [] });
      setSteps([]); setErrors({});
    }
  }, [open]);

  // ── Mutation ───────────────────────────────────────────────────────────────
  const createWorkflow = useCreateWorkflow({
    mutation: {
      onSuccess: (wf) => {
        toast({ title: isAr ? "تم إنشاء سير العمل بنجاح" : "Workflow created successfully" });
        onClose();
        if (onCreated) onCreated(wf.id);
        else navigate(`/workflows/${wf.id}`);
      },
      onError: () => {
        toast({ title: isAr ? "فشل إنشاء سير العمل" : "Failed to create workflow", variant: "destructive" });
      },
    },
  });

  // ── Validation ─────────────────────────────────────────────────────────────
  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!name.trim())       e.name         = isAr ? "الاسم مطلوب"            : "Name is required";
    if (!module)            e.module        = isAr ? "الوحدة مطلوبة"           : "Module is required";
    if (!triggerEvent)      e.triggerEvent  = isAr ? "حدث التشغيل مطلوب"       : "Trigger event is required";
    if (steps.length === 0) e.steps         = isAr ? "أضف خطوة واحدة على الأقل" : "Add at least one step";

    steps.forEach((step, i) => {
      if (!step.name.trim()) e[`step_${i}_name`] = isAr ? "اسم الخطوة مطلوب" : "Step name required";
      if (step.type === "notification" && !String(step.config.title ?? "").trim())
        e[`step_${i}_cfg`] = isAr ? "عنوان الإشعار مطلوب" : "Notification title required";
      if (step.type === "task" && !String(step.config.title ?? "").trim())
        e[`step_${i}_cfg`] = isAr ? "عنوان المهمة مطلوب" : "Task title required";
    });

    setErrors(e);
    return Object.keys(e).length === 0;
  }

  // ── Submit ─────────────────────────────────────────────────────────────────
  function handleSubmit() {
    if (!validate()) return;
    createWorkflow.mutate({
      data: {
        name:          name.trim(),
        nameAr:        nameAr.trim() || undefined,
        description:   description.trim() || undefined,
        descriptionAr: descriptionAr.trim() || undefined,
        module,
        triggerEvent,
        isActive,
        conditions:    conditions as unknown as Record<string, unknown>,
        steps:         steps.map((s, i) => ({ ...s, index: i })) as unknown as Record<string, unknown>[],
      },
    });
  }

  // ── Step helpers ────────────────────────────────────────────────────────────
  function addStep(type: StepType = "notification") {
    const meta = STEP_TYPES.find((t) => t.value === type)!;
    setSteps((prev) => [
      ...prev,
      { index: prev.length, type, name: isAr ? meta.labelAr : meta.label, config: defaultConfig(type) },
    ]);
  }

  function updateStep(i: number, step: WorkflowStep) {
    setSteps((prev) => prev.map((s, idx) => (idx === i ? step : s)));
  }

  function removeStep(i: number) {
    setSteps((prev) => prev.filter((_, idx) => idx !== i).map((s, idx) => ({ ...s, index: idx })));
  }

  function moveStep(i: number, dir: -1 | 1) {
    setSteps((prev) => {
      const next = [...prev];
      const j = i + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next.map((s, idx) => ({ ...s, index: idx }));
    });
  }

  const hasErr = (k: string) => Boolean(errors[k]);

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-2xl flex flex-col gap-0 p-0">
        <SheetHeader className="px-6 pt-6 pb-4 border-b border-border shrink-0">
          <SheetTitle className="flex items-center gap-2 text-lg">
            <Zap className="w-5 h-5 text-primary" />
            {isAr ? "إنشاء سير عمل جديد" : "Create Workflow"}
          </SheetTitle>
          <SheetDescription className="text-sm">
            {isAr
              ? "اضبط حدث التشغيل، والشروط الديناميكية المرتبطة بالحدث، وخطوات التنفيذ."
              : "Configure the trigger event, event-driven conditions, and execution steps."}
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1 min-h-0">
          <div className="px-6 py-5 space-y-6">

            {/* ── 1. Basic info ──────────────────────────────────────────── */}
            <section className="space-y-4">
              <SectionHeading n={1} label={isAr ? "المعلومات الأساسية" : "Basic Information"} />

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">{isAr ? "الاسم" : "Name"} *</Label>
                  <Input
                    className={cn("h-8 text-sm", hasErr("name") && "border-destructive")}
                    value={name}
                    onChange={(e) => { setName(e.target.value); clearErr("name"); }}
                    placeholder={isAr ? "اسم سير العمل" : "Workflow name"}
                  />
                  {hasErr("name") && <Err msg={errors.name!} />}
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{isAr ? "الاسم بالعربية" : "Arabic Name"}</Label>
                  <Input className="h-8 text-sm" dir="rtl" value={nameAr} onChange={(e) => setNameAr(e.target.value)} placeholder="اسم سير العمل" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">{isAr ? "الوصف" : "Description"}</Label>
                  <Textarea className="text-sm min-h-[60px] resize-none" value={description} onChange={(e) => setDescription(e.target.value)}
                    placeholder={isAr ? "وصف اختياري" : "Optional description"} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{isAr ? "الوصف بالعربية" : "Arabic Description"}</Label>
                  <Textarea className="text-sm min-h-[60px] resize-none" dir="rtl" value={descriptionAr} onChange={(e) => setDescriptionAr(e.target.value)} placeholder="وصف اختياري" />
                </div>
              </div>
            </section>

            {/* ── 2. Trigger ─────────────────────────────────────────────── */}
            <section className="space-y-4">
              <SectionHeading n={2} label={isAr ? "إعداد التشغيل" : "Trigger Configuration"} />

              <div className="grid grid-cols-2 gap-3">
                {/* Module */}
                <div className="space-y-1">
                  <Label className="text-xs">{isAr ? "الوحدة" : "Module"} *</Label>
                  <Select value={module} onValueChange={(v) => { setModule(v); clearErr("module"); }}>
                    <SelectTrigger className={cn("h-8 text-sm", hasErr("module") && "border-destructive")}>
                      <SelectValue placeholder={isAr ? "اختر الوحدة" : "Select module"} />
                    </SelectTrigger>
                    <SelectContent>
                      {modules.map((m) => (
                        <SelectItem key={m} value={m} className="text-sm capitalize">{m}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {hasErr("module") && <Err msg={errors.module!} />}
                </div>

                {/* Trigger event - auto-populated from registry */}
                <div className="space-y-1">
                  <Label className="text-xs">{isAr ? "حدث التشغيل" : "Trigger Event"} *</Label>
                  <Select
                    value={triggerEvent}
                    onValueChange={(v) => { setTriggerEvent(v); clearErr("triggerEvent"); }}
                    disabled={!module}
                  >
                    <SelectTrigger className={cn("h-8 text-sm", hasErr("triggerEvent") && "border-destructive")}>
                      <SelectValue placeholder={module
                        ? (isAr ? "اختر الحدث" : "Select event")
                        : (isAr ? "اختر الوحدة أولاً" : "Select module first")} />
                    </SelectTrigger>
                    <SelectContent>
                      {filteredEvents.length === 0
                        ? <div className="p-2 text-xs text-muted-foreground text-center">{isAr ? "لا توجد أحداث" : "No events found"}</div>
                        : filteredEvents.map((e) => (
                          <SelectItem key={e.eventName} value={e.eventName} className="text-xs">
                            <span className="flex flex-col">
                              <span className="font-mono">{e.eventName}</span>
                              {(isAr ? e.descriptionAr : e.description) && (
                                <span className="text-muted-foreground text-[10px]">
                                  {isAr ? e.descriptionAr : e.description}
                                </span>
                              )}
                            </span>
                          </SelectItem>
                        ))
                      }
                    </SelectContent>
                  </Select>
                  {hasErr("triggerEvent") && <Err msg={errors.triggerEvent!} />}
                </div>
              </div>

              {/* Active toggle */}
              <div className="flex items-center gap-3">
                <button type="button" role="switch" aria-checked={isActive} onClick={() => setIsActive((v) => !v)}
                  className={cn("relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none",
                    isActive ? "bg-primary" : "bg-muted-foreground/30")}>
                  <span className={cn("pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform",
                    isActive ? "translate-x-4" : "translate-x-0")} />
                </button>
                <Label className="text-xs cursor-pointer" onClick={() => setIsActive((v) => !v)}>
                  {isActive
                    ? (isAr ? "نشط - سيعمل فوراً" : "Active - runs immediately after creation")
                    : (isAr ? "غير نشط - يمكن تفعيله لاحقاً" : "Inactive - activate later")}
                </Label>
              </div>
            </section>

            {/* ── 3. Conditions (schema-driven) ──────────────────────────── */}
            <section>
              <Accordion type="single" collapsible defaultValue={triggerEvent ? "conditions" : undefined}>
                <AccordionItem value="conditions" className="border border-border rounded-lg">
                  <AccordionTrigger className="px-4 py-3 text-sm font-semibold hover:no-underline">
                    <span className="flex items-center gap-2">
                      <SectionBadge n={3} />
                      {isAr ? "الشروط الديناميكية" : "Dynamic Conditions"}
                      {triggerEvent && selectedEventSchema && (
                        <Badge variant="secondary" className="text-[10px] font-normal ml-1">
                          {selectedEventSchema.fields.length} {isAr ? "حقول متاحة" : "fields available"}
                        </Badge>
                      )}
                      {conditions.conditions.length > 0 && (
                        <Badge className="text-[10px] ml-1">{conditions.conditions.length}</Badge>
                      )}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="px-4 pb-4">
                    <p className="text-xs text-muted-foreground mb-3">
                      {isAr
                        ? "تُحمَّل الحقول تلقائياً من مخطط حدث التشغيل. حدد الحدث أعلاه أولاً."
                        : "Fields are loaded automatically from the trigger event schema. Select an event above first."}
                    </p>
                    <DynamicConditionBuilder
                      schema={selectedEventSchema}
                      conditions={conditions}
                      onChange={setConditions}
                    />
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </section>

            {/* ── 4. Steps ───────────────────────────────────────────────── */}
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <SectionHeading n={4} label={isAr ? "خطوات التنفيذ" : "Execution Steps"}
                  badge={steps.length > 0 ? <Badge variant="secondary" className="text-xs">{steps.length}</Badge> : undefined} />
              </div>

              {hasErr("steps") && (
                <div className="flex items-center gap-1.5 text-xs text-destructive bg-destructive/10 px-3 py-2 rounded-md">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  {errors.steps}
                </div>
              )}

              {steps.length === 0 ? (
                <div className="border-2 border-dashed border-border rounded-lg py-8 text-center">
                  <p className="text-sm text-muted-foreground">{isAr ? "لم تُضَف أي خطوات بعد" : "No steps added yet"}</p>
                  <p className="text-xs text-muted-foreground mt-1">{isAr ? "اختر نوع الخطوة أدناه" : "Pick a step type below to begin"}</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {steps.map((step, i) => (
                    <div key={i}>
                      <StepCard step={step} index={i} total={steps.length}
                        onChange={(s) => updateStep(i, s)} onRemove={() => removeStep(i)}
                        onMoveUp={() => moveStep(i, -1)} onMoveDown={() => moveStep(i, 1)} isAr={isAr} />
                      {(hasErr(`step_${i}_name`) || hasErr(`step_${i}_cfg`)) && (
                        <p className="text-[10px] text-destructive mt-0.5 px-1">
                          {errors[`step_${i}_name`] ?? errors[`step_${i}_cfg`]}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Add step palette */}
              <div className="flex flex-wrap gap-1.5 pt-1">
                {STEP_TYPES.map((t) => {
                  const Icon = t.icon;
                  return (
                    <button key={t.value} type="button"
                      onClick={() => { addStep(t.value); clearErr("steps"); }}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border text-xs hover:bg-muted transition-colors">
                      <Icon className={cn("w-3 h-3", t.color)} />
                      {isAr ? t.labelAr : t.label}
                    </button>
                  );
                })}
              </div>
            </section>

          </div>
        </ScrollArea>

        <SheetFooter className="px-6 py-4 border-t border-border shrink-0 flex-row gap-2 justify-end">
          <Button variant="outline" onClick={onClose} disabled={createWorkflow.isPending}>
            {isAr ? "إلغاء" : "Cancel"}
          </Button>
          <Button onClick={handleSubmit} disabled={createWorkflow.isPending} className="gap-2 min-w-[130px]">
            {createWorkflow.isPending
              ? <><Loader2 className="w-4 h-4 animate-spin" />{isAr ? "جارٍ الإنشاء..." : "Creating..."}</>
              : <><Plus className="w-4 h-4" />{isAr ? "إنشاء سير العمل" : "Create Workflow"}</>
            }
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );

  // ── Helpers ────────────────────────────────────────────────────────────────
  function clearErr(k: string) {
    setErrors((prev) => { const n = { ...prev }; delete n[k]; return n; });
  }
}

// ── Small UI helpers ──────────────────────────────────────────────────────────

function SectionBadge({ n }: { n: number }) {
  return (
    <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold shrink-0">
      {n}
    </span>
  );
}

function SectionHeading({ n, label, badge }: { n: number; label: string; badge?: React.ReactNode }) {
  return (
    <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
      <SectionBadge n={n} />
      {label}
      {badge}
    </h3>
  );
}

function Err({ msg }: { msg: string }) {
  return <p className="text-[10px] text-destructive">{msg}</p>;
}
