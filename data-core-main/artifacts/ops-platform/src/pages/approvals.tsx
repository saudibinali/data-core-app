import { useTranslation } from "react-i18next";
import { useListApprovals, useUpdateApproval } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDistanceToNow } from "date-fns";
import { CheckSquare, Check, X, ArrowRight } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";

export default function ApprovalsPage() {
  const { t } = useTranslation();
  const { data: approvals, isLoading } = useListApprovals({ status: "pending" });
  const updateApproval = useUpdateApproval();
  const queryClient = useQueryClient();

  const handleAction = (id: number, status: 'approved' | 'rejected') => {
    updateApproval.mutate({
      id,
      data: { status }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/approvals"] });
      }
    });
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">{t("approvals")}</h2>
        <p className="text-muted-foreground">{t("approvals_subtitle")}</p>
      </div>

      <Card className="border-border shadow-sm">
        <CardContent className="p-0">
          {isLoading ? (
             <div className="p-4 space-y-4">
               {[1,2,3].map(i => <Skeleton key={i} className="h-24 w-full rounded-md" />)}
             </div>
          ) : approvals?.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground flex flex-col items-center justify-center">
              <CheckSquare className="w-8 h-8 mb-4 opacity-20" />
              <p>{t("no_pending_approvals")}</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {approvals?.map(app => (
                <div key={app.id} className="p-6 hover:bg-accent/50 transition-colors">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px] uppercase tracking-wider bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200 border-none">
                          {t("pending_badge")}
                        </Badge>
                        <span className="text-sm font-medium text-muted-foreground">{formatDistanceToNow(new Date(app.createdAt), { addSuffix: true })}</span>
                      </div>
                      <h3 className="font-semibold text-lg flex items-center gap-2">
                        {t("approval_request")}
                        <Link href={`/tickets/${app.ticketId}`} className="text-primary hover:underline group flex items-center text-sm ml-2">
                          {t("view_ticket_link")} <ArrowRight className="w-3 h-3 ml-1 group-hover:translate-x-0.5 transition-transform" />
                        </Link>
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        {t("requested_by", { name: app.requestedByName })}
                      </p>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      <Button variant="outline" className="text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/20" onClick={() => handleAction(app.id, 'rejected')}>
                        <X className="w-4 h-4 mr-2" /> {t("reject")}
                      </Button>
                      <Button className="bg-green-600 hover:bg-green-700 text-white" onClick={() => handleAction(app.id, 'approved')}>
                        <Check className="w-4 h-4 mr-2" /> {t("approve")}
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
