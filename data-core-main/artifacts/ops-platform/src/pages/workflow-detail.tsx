import { useParams, Link } from "wouter";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import {
  useGetWorkflow,
  useListWorkflowExecutions,
  useGetWorkflowExecutionSteps,
  useUpdateWorkflow,
} from "@workspace/api-client-react";
import { usePermissions } from "@/hooks/use-permissions";
import {
  GitFork, CheckCircle2, XCircle, Clock, Loader2,
  ChevronLeft, ChevronRight, ChevronDown, ChevronUp,
  Zap, Activity, Play, Pause, AlertCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow, format } from "date-fns";

const STATUS_CONFIG: Record<string, { icon: React.ElementType; color: string; badge: "default" | "destructive" | "secondary" | "outline" }> = {
  completed:       { icon: CheckCircle2, color: "text-emerald-600", badge: "default" },
  failed:          { icon: XCircle,      color: "text-red-600",     badge: "destructive" },
  running:         { icon: Loader2,      color: "text-blue-600",    badge: "secondary" },
  waiting_approval:{ icon: Clock,        color: "text-amber-600",   badge: "secondary" },
  pending:         { icon: Clock,        color: "text-slate-500",   badge: "outline" },
  cancelled:       { icon: XCircle,      color: "text-muted-foreground", badge: "outline" },
};

const STEP_STATUS_CONFIG: Record<string, { color: string }> = {
  completed: { color: "text-emerald-600" },
  failed:    { color: "text-red-600" },
  running:   { color: "text-blue-600" },
  skipped:   { color: "text-muted-foreground" },
  pending:   { color: "text-slate-500" },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status];
  const Icon = cfg?.icon ?? Clock;
  return (
    <Badge variant={cfg?.badge ?? "outline"} className="gap-1 text-xs capitalize">
      <Icon className={`w-3 h-3 ${cfg?.color ?? ""} ${status === "running" ? "animate-spin" : ""}`} />
      {status.replace(/_/g, " ")}
    </Badge>
  );
}

function StepTimeline({ steps }: { steps: Array<{
  id: number; stepIndex: number; stepType: string; stepName: string;
  status: string; error?: string | null; startedAt?: string | null; completedAt?: string | null;
}> }) {
  const { i18n } = useTranslation();
  const isAr = i18n.language.startsWith("ar");

  return (
    <div className="space-y-2">
      {steps.map((step, idx) => {
        const cfg = STEP_STATUS_CONFIG[step.status];
        const Icon = STATUS_CONFIG[step.status]?.icon ?? Clock;
        const duration = step.startedAt && step.completedAt
          ? `${Math.round((new Date(step.completedAt).getTime() - new Date(step.startedAt).getTime()) / 1000)}s`
          : null;

        return (
          <div key={step.id} className="flex items-start gap-3">
            <div className="flex flex-col items-center">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center border-2 ${
                step.status === "completed" ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950" :
                step.status === "failed"    ? "border-red-500 bg-red-50 dark:bg-red-950" :
                step.status === "running"   ? "border-blue-500 bg-blue-50 dark:bg-blue-950" :
                step.status === "skipped"   ? "border-muted bg-muted" :
                "border-muted-foreground/30 bg-background"
              }`}>
                <Icon className={`w-3 h-3 ${cfg?.color ?? "text-muted-foreground"} ${step.status === "running" ? "animate-spin" : ""}`} />
              </div>
              {idx < steps.length - 1 && (
                <div className="w-px h-4 bg-border mt-1" />
              )}
            </div>
            <div className="flex-1 pb-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium">{step.stepName}</span>
                <Badge variant="outline" className="text-[10px] capitalize">{step.stepType.replace(/_/g, " ")}</Badge>
                <span className={`text-xs capitalize ${cfg?.color ?? ""}`}>{step.status}</span>
                {duration && <span className="text-xs text-muted-foreground">{duration}</span>}
              </div>
              {step.error && (
                <p className="text-xs text-red-600 mt-0.5 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3 shrink-0" />
                  {step.error}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ExecutionRow({ execution }: { execution: {
  id: number; status: string; triggeredByName?: string | null;
  currentStepIndex: number; totalSteps?: number;
  startedAt: string; completedAt?: string | null; error?: string | null;
} }) {
  const [expanded, setExpanded] = useState(false);
  const { i18n } = useTranslation();
  const isAr = i18n.language.startsWith("ar");

  const { data: stepsData, isLoading } = useGetWorkflowExecutionSteps(
    execution.id,
    { query: { enabled: expanded, queryKey: ["execution-steps", execution.id] } },
  );

  const cfg = STATUS_CONFIG[execution.status];
  const Icon = cfg?.icon ?? Clock;

  return (
    <div className="border-b border-border last:border-0">
      <div
        className="flex items-start gap-4 px-6 py-4 hover:bg-muted/30 transition-colors cursor-pointer"
        onClick={() => setExpanded((e) => !e)}
      >
        <div className={`mt-0.5 shrink-0 ${cfg?.color ?? "text-slate-400"}`}>
          <Icon className={`w-4 h-4 ${execution.status === "running" ? "animate-spin" : ""}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge status={execution.status} />
            {execution.triggeredByName && (
              <span className="text-xs text-muted-foreground">
                {isAr ? "بواسطة" : "by"} <span className="font-medium text-foreground">{execution.triggeredByName}</span>
              </span>
            )}
            <span className="text-xs text-muted-foreground">
              {isAr ? "الخطوة" : "Step"} {execution.currentStepIndex + 1}
              {execution.totalSteps ? ` / ${execution.totalSteps}` : ""}
            </span>
          </div>
          {execution.error && (
            <p className="text-xs text-red-600 mt-0.5 truncate">{execution.error}</p>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="text-xs text-muted-foreground text-right">
            <p>{formatDistanceToNow(new Date(execution.startedAt), { addSuffix: true })}</p>
            {execution.completedAt && (
              <p className="text-[10px] opacity-60 mt-0.5">
                {Math.round((new Date(execution.completedAt).getTime() - new Date(execution.startedAt).getTime()) / 1000)}s
              </p>
            )}
          </div>
          {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </div>

      {expanded && (
        <div className="px-6 pb-4">
          {isLoading ? (
            <div className="space-y-2 pl-2">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
            </div>
          ) : stepsData?.steps?.length ? (
            <StepTimeline steps={stepsData.steps} />
          ) : (
            <p className="text-xs text-muted-foreground pl-2">{isAr ? "لا توجد خطوات مسجّلة" : "No step logs available"}</p>
          )}
        </div>
      )}
    </div>
  );
}

export default function WorkflowDetailPage() {
  const { id } = useParams<{ id: string }>();
  const workflowId = parseInt(id ?? "", 10);
  const { t, i18n } = useTranslation();
  const isAr = i18n.language.startsWith("ar");
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("workflow.manage");
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const limit = 20;

  const { data, isLoading, refetch } = useGetWorkflow(workflowId, {
    query: { enabled: !isNaN(workflowId), queryKey: ["workflow", workflowId] },
  });

  const { data: executions, isLoading: execLoading } = useListWorkflowExecutions(
    workflowId,
    { page, limit },
    { query: { enabled: !isNaN(workflowId), queryKey: ["workflow-executions", workflowId, page] } },
  );

  const updateWorkflow = useUpdateWorkflow({
    mutation: {
      onSuccess: () => {
        void refetch();
        toast({ title: isAr ? "تم تحديث سير العمل" : "Workflow updated" });
      },
    },
  });

  const workflow = data?.workflow;
  const steps = Array.isArray(workflow?.steps) ? workflow.steps : [];
  const totalPages = executions ? Math.ceil(executions.total / limit) : 1;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (!workflow) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <GitFork className="w-12 h-12 text-muted-foreground/30" />
        <p className="text-muted-foreground">{isAr ? "لم يُعثر على سير العمل" : "Workflow not found"}</p>
        <Link href="/workflows">
          <Button variant="outline" size="sm">
            <ChevronLeft className="w-4 h-4 mr-1" />
            {isAr ? "العودة" : "Back"}
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <Link href="/workflows">
            <Button variant="ghost" size="sm" className="mt-0.5 h-8 w-8 p-0">
              <ChevronLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold tracking-tight">
                {isAr && workflow.nameAr ? workflow.nameAr : workflow.name}
              </h1>
              {workflow.isActive
                ? <Badge variant="default"   className="gap-1"><CheckCircle2 className="w-3 h-3" />{isAr ? "نشط" : "Active"}</Badge>
                : <Badge variant="secondary" className="gap-1"><XCircle      className="w-3 h-3" />{isAr ? "متوقف" : "Paused"}</Badge>
              }
            </div>
            {(isAr ? workflow.descriptionAr : workflow.description) && (
              <p className="text-muted-foreground text-sm mt-1">
                {isAr ? workflow.descriptionAr : workflow.description}
              </p>
            )}
            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
              <span className="flex items-center gap-1 font-mono">
                <Zap className="w-3 h-3" /> {workflow.triggerEvent}
              </span>
              <span className="capitalize">{workflow.module}</span>
            </div>
          </div>
        </div>

        {isAdmin && (
          <div className="flex items-center gap-2">
            <Link href="/process-templates">
              <Button variant="outline" size="sm" className="gap-1">
                <GitFork className="w-4 h-4" />
                {isAr ? "قوالب العمليات" : "Process templates"}
              </Button>
            </Link>
            <Button
            variant={workflow.isActive ? "outline" : "default"}
            size="sm"
            className="gap-2"
            onClick={() => updateWorkflow.mutate({ id: workflow.id, data: { isActive: !workflow.isActive } })}
            disabled={updateWorkflow.isPending}
          >
            {workflow.isActive
              ? <><Pause className="w-4 h-4" />{isAr ? "إيقاف" : "Pause"}</>
              : <><Play  className="w-4 h-4" />{isAr ? "تفعيل" : "Activate"}</>
            }
          </Button>
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: isAr ? "الخطوات" : "Steps",     value: steps.length,                  icon: GitFork  },
          { label: isAr ? "التشغيلات" : "Runs",    value: workflow.executionCount ?? 0,   icon: Activity },
          { label: isAr ? "آخر تشغيل" : "Last Run", value: workflow.lastExecutedAt
              ? formatDistanceToNow(new Date(workflow.lastExecutedAt), { addSuffix: true })
              : (isAr ? "لا يوجد" : "Never"),                                               icon: Clock    },
        ].map((s) => (
          <Card key={s.label} className="py-4">
            <CardContent className="px-4 pb-0 pt-0 flex items-center gap-3">
              <s.icon className="w-8 h-8 text-primary opacity-70" />
              <div>
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className="text-lg font-bold">{s.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Step definitions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{isAr ? "الخطوات" : "Steps"}</CardTitle>
          <CardDescription>
            {isAr ? "تسلسل خطوات التنفيذ" : "Execution step sequence"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {steps.length === 0 ? (
            <p className="text-sm text-muted-foreground">{isAr ? "لا توجد خطوات محددة" : "No steps defined"}</p>
          ) : (
            <div className="space-y-2">
              {steps.map((step: any, idx: number) => (
                <div key={idx} className="flex items-start gap-3">
                  <div className="flex flex-col items-center">
                    <div className="w-6 h-6 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center text-xs font-bold text-primary">
                      {idx + 1}
                    </div>
                    {idx < steps.length - 1 && <div className="w-px h-4 bg-border mt-1" />}
                  </div>
                  <div className="flex-1 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{step.name ?? `Step ${idx + 1}`}</span>
                      <Badge variant="outline" className="text-[10px] capitalize">
                        {(step.type ?? "unknown").replace(/_/g, " ")}
                      </Badge>
                    </div>
                    {step.config?.title && (
                      <p className="text-xs text-muted-foreground mt-0.5">{step.config.title}</p>
                    )}
                    {step.config?.message && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{step.config.message}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Execution history */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{isAr ? "سجل التشغيلات" : "Execution History"}</CardTitle>
          <CardDescription>
            {isAr ? "انقر للاطلاع على سجل الخطوات التفصيلي" : "Click an execution to see step-by-step logs"}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {execLoading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          ) : !executions?.data?.length ? (
            <div className="py-12 text-center">
              <Activity className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">{isAr ? "لا توجد تشغيلات بعد" : "No executions yet"}</p>
              <p className="text-xs text-muted-foreground mt-1">{isAr ? "ستظهر التشغيلات عند حدوث الحدث المُشغِّل" : "Executions appear when the trigger event fires"}</p>
            </div>
          ) : (
            <>
              {executions.data.map((execution) => (
                <ExecutionRow key={execution.id} execution={execution} />
              ))}

              {totalPages > 1 && (
                <div className="flex items-center justify-between px-6 py-4 border-t border-border">
                  <p className="text-xs text-muted-foreground">{executions.total} {isAr ? "تشغيل" : "executions"}</p>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="h-8 w-8 p-0">
                      <ChevronLeft className="w-4 h-4" />
                    </Button>
                    <span className="text-xs min-w-[4rem] text-center">{page} / {totalPages}</span>
                    <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="h-8 w-8 p-0">
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

