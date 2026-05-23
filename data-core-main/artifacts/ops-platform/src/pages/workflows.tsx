import { useState } from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import {
  useListWorkflows,
  useUpdateWorkflow,
  useDeleteWorkflow,
} from "@workspace/api-client-react";
import { usePermissions } from "@/hooks/use-permissions";
import {
  GitFork, Play, Pause, Trash2, Plus, RefreshCw,
  CheckCircle2, XCircle, Clock, ChevronRight, Zap,
  Activity,
} from "lucide-react";
import CreateWorkflowSheet from "@/components/workflows/CreateWorkflowSheet";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";

const MODULE_COLORS: Record<string, string> = {
  tickets:     "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  users:       "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300",
  approvals:   "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  departments: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  groups:      "bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300",
  calendar:    "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300",
  system:      "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300",
};

function ModuleBadge({ module }: { module: string }) {
  const color = MODULE_COLORS[module] ?? MODULE_COLORS["system"]!;
  return (
    <span className={`px-1.5 py-0.5 rounded text-xs font-medium capitalize ${color}`}>
      {module}
    </span>
  );
}

export default function WorkflowsPage() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language.startsWith("ar");
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("workflow.manage");
  const { toast } = useToast();

  const [deleteId,     setDeleteId]     = useState<number | null>(null);
  const [createOpen,   setCreateOpen]   = useState(false);

  const { data: workflows, isLoading, refetch, isFetching } = useListWorkflows();

  const updateWorkflow = useUpdateWorkflow({
    mutation: {
      onSuccess: () => {
        void refetch();
        toast({ title: "Workflow updated" });
      },
    },
  });

  const deleteWorkflow = useDeleteWorkflow({
    mutation: {
      onSuccess: () => {
        setDeleteId(null);
        void refetch();
        toast({ title: "Workflow deleted" });
      },
    },
  });

  function toggleActive(id: number, current: boolean) {
    updateWorkflow.mutate({ id, data: { isActive: !current } });
  }

  const stats = {
    total:  workflows?.length ?? 0,
    active: workflows?.filter((w) => w.isActive).length ?? 0,
    runs:   workflows?.reduce((sum, w) => sum + (w.executionCount ?? 0), 0) ?? 0,
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <GitFork className="w-6 h-6 text-primary" />
            {isAr ? "سير العمل" : "Workflows"}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {isAr
              ? "قوالب العمليات ومسارات الموافقة المرتبطة بالهيكل التنظيمي"
              : "Business process templates and org-aware approval routing"}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link href="/process-templates">
            <Button variant="secondary" size="sm">
              {isAr ? "قوالب العمليات" : "Process Templates"}
            </Button>
          </Link>
          <Link href="/self-service/approvals">
            <Button variant="secondary" size="sm">
              {isAr ? "صندوق الموافقات" : "Approval Inbox"}
            </Button>
          </Link>
          <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching} className="gap-2">
            <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
            {isAr ? "تحديث" : "Refresh"}
          </Button>
          {isAdmin && (
            <Button size="sm" className="gap-2" onClick={() => setCreateOpen(true)}>
              <Plus className="w-4 h-4" />
              {isAr ? "إنشاء سير عمل" : "Create Workflow"}
            </Button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: isAr ? "إجمالي سير العمل" : "Total Workflows", value: stats.total,  icon: GitFork,     color: "text-primary" },
          { label: isAr ? "نشط"              : "Active",          value: stats.active, icon: CheckCircle2, color: "text-emerald-600" },
          { label: isAr ? "إجمالي التشغيلات" : "Total Runs",      value: stats.runs,   icon: Activity,    color: "text-blue-600" },
        ].map((s) => (
          <Card key={s.label} className="py-4">
            <CardContent className="px-4 pb-0 pt-0 flex items-center gap-3">
              <s.icon className={`w-8 h-8 ${s.color} opacity-80`} />
              <div>
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className="text-2xl font-bold">{s.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Workflow list */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{isAr ? "تعريفات سير العمل" : "Workflow Definitions"}</CardTitle>
          <CardDescription>
            {isAr ? "سير العمل المُكوَّنة لمساحة العمل هذه" : "Configured automation workflows for this workspace"}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : !workflows?.length ? (
            <div className="py-16 text-center">
              <GitFork className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-muted-foreground text-sm">
                {isAr ? "لا توجد سير عمل بعد" : "No workflows yet"}
              </p>
              <p className="text-muted-foreground text-xs mt-1">
                {isAr ? "سيتم إنشاء القوالب الافتراضية عند إعادة تشغيل الخادم" : "Default templates are seeded on server restart"}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {workflows.map((wf) => (
                <div key={wf.id} className="flex items-start gap-4 px-6 py-4 hover:bg-muted/30 transition-colors">
                  {/* Status indicator */}
                  <div className="mt-1 shrink-0">
                    {wf.isActive
                      ? <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      : <XCircle className="w-4 h-4 text-muted-foreground/50" />
                    }
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link href={`/workflows/${wf.id}`} className="text-sm font-semibold hover:text-primary transition-colors">
                        {isAr && wf.nameAr ? wf.nameAr : wf.name}
                      </Link>
                      <ModuleBadge module={wf.module} />
                      {!wf.isActive && (
                        <Badge variant="outline" className="text-xs text-muted-foreground">
                          {isAr ? "متوقف" : "Paused"}
                        </Badge>
                      )}
                    </div>
                    {(isAr ? wf.descriptionAr : wf.description) && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                        {isAr ? wf.descriptionAr : wf.description}
                      </p>
                    )}
                    <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Zap className="w-3 h-3" />
                        <span className="font-mono">{wf.triggerEvent}</span>
                      </span>
                      <span className="flex items-center gap-1">
                        <Activity className="w-3 h-3" />
                        {wf.executionCount ?? 0} {isAr ? "تشغيل" : "runs"}
                      </span>
                      {wf.steps && (
                        <span>{Array.isArray(wf.steps) ? wf.steps.length : 0} {isAr ? "خطوات" : "steps"}</span>
                      )}
                      {wf.lastExecutedAt && (
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatDistanceToNow(new Date(wf.lastExecutedAt), { addSuffix: true })}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    {isAdmin && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          title={wf.isActive ? (isAr ? "إيقاف" : "Pause") : (isAr ? "تفعيل" : "Activate")}
                          onClick={() => toggleActive(wf.id, wf.isActive)}
                          disabled={updateWorkflow.isPending}
                        >
                          {wf.isActive
                            ? <Pause className="w-3.5 h-3.5 text-amber-600" />
                            : <Play  className="w-3.5 h-3.5 text-emerald-600" />
                          }
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                          title={isAr ? "حذف" : "Delete"}
                          onClick={() => setDeleteId(wf.id)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </>
                    )}
                    <Link href={`/workflows/${wf.id}`}>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                        <ChevronRight className="w-4 h-4" />
                      </Button>
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Workflow sheet */}
      <CreateWorkflowSheet
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => { void refetch(); }}
      />

      {/* Delete confirm */}
      <AlertDialog open={deleteId !== null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{isAr ? "تأكيد الحذف" : "Delete Workflow"}</AlertDialogTitle>
            <AlertDialogDescription>
              {isAr
                ? "هل أنت متأكد من حذف سير العمل هذا؟ لا يمكن التراجع عن هذا الإجراء."
                : "Are you sure you want to delete this workflow? This action cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{isAr ? "إلغاء" : "Cancel"}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteId && deleteWorkflow.mutate({ id: deleteId })}
              disabled={deleteWorkflow.isPending}
            >
              {isAr ? "حذف" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
