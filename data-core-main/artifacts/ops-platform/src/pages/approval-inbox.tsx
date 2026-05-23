import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Check, X, Clock, AlertTriangle, ArrowLeft } from "lucide-react";

type InboxItem = {
  instanceId: number;
  stepId: number;
  entityType: string;
  entityId: number;
  processCode: string;
  processName: string;
  dueAt: string | null;
  slaWarning: boolean;
  isDelegated: boolean;
  routingSource: string;
  context: Record<string, unknown> | null;
};

async function fetchInbox(): Promise<InboxItem[]> {
  const res = await fetch("/api/self-service/approvals", { credentials: "include" });
  if (res.status === 503) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.migrationHint ?? "Approval runtime unavailable");
  }
  if (!res.ok) throw new Error("Failed to load approvals");
  return res.json();
}

export default function ApprovalInboxPage() {
  const { i18n } = useTranslation();
  const isAr = i18n.language.startsWith("ar");
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["approval-inbox"],
    queryFn: fetchInbox,
  });

  const decide = useMutation({
    mutationFn: async ({ item, decision }: { item: InboxItem; decision: "approve" | "reject" }) => {
      if (item.entityType === "leave_request") {
        const path = decision === "approve" ? "approve" : "reject";
        const res = await fetch(`/api/hr/leave-requests/${item.entityId}/${path}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ comment: "" }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? "Leave action failed");
        }
        return res.json();
      }
      const res = await fetch(`/api/self-service/approvals/${item.instanceId}/steps/${item.stepId}/${decision}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Action failed");
      }
      return res.json();
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["approval-inbox"] });
      toast({ title: isAr ? "تم تحديث الموافقة" : "Approval updated" });
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

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
      {error && (
        <Card className="border-destructive/50">
          <CardContent className="pt-6 text-sm text-destructive">{(error as Error).message}</CardContent>
        </Card>
      )}

      {!isLoading && !error && (!data || data.length === 0) && (
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
                onClick={() => decide.mutate({ item, decision: "reject" })}
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
