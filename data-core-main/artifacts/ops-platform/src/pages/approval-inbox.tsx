import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { Textarea } from "@/components/ui/textarea";
import { useLeaveCutover } from "@/lib/leave-cutover-flags";
import {
  approveHrLeaveRequest,
  approveSelfServiceApprovalStep,
  getListSelfServiceApprovalsQueryKey,
  rejectHrLeaveRequest,
  rejectSelfServiceApprovalStep,
  useListSelfServiceApprovals,
  type SelfServiceApprovalInboxItem,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Check, X, Clock, AlertTriangle, ArrowLeft } from "lucide-react";

function inboxErrorMessage(e: unknown): string {
  if (e && typeof e === "object" && "data" in e) {
    const data = (e as { data?: { migrationHint?: string } }).data;
    if (data?.migrationHint) return data.migrationHint;
  }
  if (e instanceof Error) return e.message;
  return "Failed to load approvals";
}

export default function ApprovalInboxPage() {
  const { i18n } = useTranslation();
  const isAr = i18n.language.startsWith("ar");
  const { toast } = useToast();
  const qc = useQueryClient();
  const leaveCutover = useLeaveCutover();
  const [rejectNotes, setRejectNotes] = useState<Record<number, string>>({});

  const { data, isLoading, error, refetch } = useListSelfServiceApprovals({});

  const decide = useMutation({
    mutationFn: async ({ item, decision, comment }: { item: SelfServiceApprovalInboxItem; decision: "approve" | "reject"; comment?: string }) => {
      if (item.entityType === "leave_request") {
        const body = { comment: comment ?? "" };
        if (decision === "approve") {
          return approveHrLeaveRequest(item.entityId, body);
        }
        return rejectHrLeaveRequest(item.entityId, body);
      }
      const notes = comment ?? "";
      if (decision === "approve") {
        return approveSelfServiceApprovalStep(item.instanceId, item.stepId, { notes });
      }
      return rejectSelfServiceApprovalStep(item.instanceId, item.stepId, { notes });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: getListSelfServiceApprovalsQueryKey() });
      toast({ title: isAr ? "تم تحديث الموافقة" : "Approval updated" });
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const displayError = error ? inboxErrorMessage(error) : null;

  return (
    <div className="space-y-6 p-4 md:p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3">
        <Link href="/self-service">
          <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div>
          <h1 className="text-2xl font-semibold">{isAr ? "صندوق الموافقات" : "Approval Inbox"}</h1>
          <p className="text-sm text-muted-foreground">
            {isAr ? "طلبات معلقة مرتبطة بالهيكل التنظيمي" : "Pending approvals routed via org hierarchy"}
          </p>
        </div>
      </div>

      {isLoading && <Skeleton className="h-32 w-full" />}
      {displayError && (
        <Card className="border-destructive/50">
          <CardContent className="pt-6 text-sm text-destructive">{displayError}</CardContent>
        </Card>
      )}

      {!isLoading && !displayError && (!data || data.length === 0) && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            {isAr ? "لا توجد موافقات معلقة" : "No pending approvals"}
          </CardContent>
        </Card>
      )}

      {data?.map((item) => (
        <Card key={item.stepId} className={item.slaWarning ? "border-amber-500/60" : undefined}>
          <CardHeader className="pb-2 flex flex-row items-start justify-between gap-2">
            <div>
              <CardTitle className="text-base">{item.processName}</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                {item.entityType} #{item.entityId} · {item.routingSource.replace(/_/g, " ")}
              </p>
              {item.instanceId != null && (
                <Link
                  href={
                    item.entityType === "leave_request"
                      ? "/admin/hr/leave"
                      : item.entityType === "form_submission"
                        ? `/forms`
                        : item.entityType === "ticket"
                          ? `/tickets/${item.entityId}`
                          : "/workflows"
                  }
                  className="text-xs text-primary hover:underline mt-1 inline-block"
                >
                  {isAr ? "عرض السياق" : "View context"}
                </Link>
              )}
              {typeof item.context?.employeeId === "number" && (
                <Link
                  href={`/hr/employees/${item.context.employeeId}`}
                  className="text-xs text-muted-foreground hover:underline block"
                >
                  {isAr ? "ملف الموظف" : "Employee record"}
                </Link>
              )}
            </div>
            <div className="flex flex-wrap gap-1 justify-end">
              {item.isDelegated && <Badge variant="secondary">{isAr ? "تفويض" : "Delegated"}</Badge>}
              {item.slaWarning && (
                <Badge variant="outline" className="text-amber-600 border-amber-500">
                  <AlertTriangle className="h-3 w-3 mr-1" /> SLA
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {item.context && typeof item.context.leaveType === "string" && (
              <div className="text-sm text-muted-foreground">
                {String(item.context.leaveType)} · {String(item.context.startDate ?? "")} → {String(item.context.endDate ?? "")}
              </div>
            )}
            {item.dueAt && (
              <p className="text-xs flex items-center gap-1 text-muted-foreground">
                <Clock className="h-3 w-3" />
                {isAr ? "الاستحقاق:" : "Due:"} {new Date(item.dueAt).toLocaleString()}
              </p>
            )}
            <Textarea
              className="text-sm min-h-[60px]"
              placeholder={isAr ? "سبب الرفض (مطلوب عند الرفض)" : "Rejection reason (required when rejecting)"}
              value={rejectNotes[item.stepId] ?? ""}
              onChange={(e) => setRejectNotes((prev) => ({ ...prev, [item.stepId]: e.target.value }))}
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => decide.mutate({ item, decision: "approve" })}
                disabled={decide.isPending}
              >
                <Check className="h-4 w-4 mr-1" /> {isAr ? "موافقة" : "Approve"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const comment = rejectNotes[item.stepId]?.trim() ?? "";
                  if (!comment) {
                    toast({
                      title: isAr ? "سبب الرفض مطلوب" : "Rejection reason is required",
                      variant: "destructive",
                    });
                    return;
                  }
                  decide.mutate({ item, decision: "reject", comment });
                }}
                disabled={decide.isPending}
              >
                <X className="h-4 w-4 mr-1" /> {isAr ? "رفض" : "Reject"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}

      <Button variant="ghost" size="sm" onClick={() => void refetch()}>
        {isAr ? "تحديث" : "Refresh"}
      </Button>
    </div>
  );
}

