import { useTranslation } from "react-i18next";
import { Link, useLocation } from "wouter";
import { useListTickets } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Search, Plus } from "lucide-react";
import { useState } from "react";
import { formatDistanceToNow } from "date-fns";

export default function TicketsPage() {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  
  const { data: tickets, isLoading } = useListTickets({ search });

  const getPriorityColor = (priority: string) => {
    switch(priority) {
      case 'urgent': return 'destructive';
      case 'high': return 'destructive';
      case 'medium': return 'secondary';
      default: return 'outline';
    }
  };

  const getStatusColor = (status: string) => {
    switch(status) {
      case 'open': return 'default';
      case 'in_progress': return 'secondary';
      case 'resolved': return 'outline';
      case 'closed': return 'outline';
      default: return 'secondary';
    }
  };

  const statusLabel = (status: string) => {
    const map: Record<string, string> = {
      open: t("status_open"),
      in_progress: t("status_in_progress"),
      pending: t("status_pending"),
      resolved: t("status_resolved"),
      closed: t("status_closed"),
    };
    return map[status] ?? status.replace("_", " ");
  };

  const priorityLabel = (priority: string) => {
    const map: Record<string, string> = {
      low: t("priority_low"),
      medium: t("priority_medium"),
      high: t("priority_high"),
      urgent: t("priority_urgent"),
    };
    return map[priority] ?? priority;
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">{t("tickets")}</h2>
          <p className="text-muted-foreground">{t("tickets_subtitle")}</p>
        </div>
        <Link href="/tickets/new" className="bg-primary text-primary-foreground px-4 py-2 rounded-md hover:bg-primary/90 text-sm font-medium shadow-sm transition-all active:scale-95 flex items-center gap-2">
          <Plus className="w-4 h-4" />
          {t("new_ticket")}
        </Link>
      </div>

      <div className="flex items-center gap-4 bg-card p-3 rounded-lg border shadow-sm">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder={t("search_tickets")}
            className="pl-9 bg-background border-none focus-visible:ring-0"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <Card className="border-border shadow-sm">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-4">
              {[1,2,3,4,5].map(i => <Skeleton key={i} className="h-16 w-full rounded-md" />)}
            </div>
          ) : tickets?.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              {t("no_tickets_found")}
            </div>
          ) : (
            <div className="divide-y divide-border">
              {tickets?.map((ticket) => (
                <div 
                  key={ticket.id} 
                  className="p-4 hover:bg-accent/50 cursor-pointer transition-colors flex items-center justify-between"
                  onClick={() => setLocation(`/tickets/${ticket.id}`)}
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-foreground">{ticket.title}</span>
                      <Badge variant={getStatusColor(ticket.status) as any} className="capitalize text-[10px] px-1.5 py-0">
                        {statusLabel(ticket.status)}
                      </Badge>
                      <Badge variant={getPriorityColor(ticket.priority) as any} className="capitalize text-[10px] px-1.5 py-0">
                        {priorityLabel(ticket.priority)}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>#{ticket.id}</span>
                      <span>•</span>
                      <span>{t("created_by", { name: ticket.createdByName })}</span>
                      <span>•</span>
                      <span>{formatDistanceToNow(new Date(ticket.createdAt), { addSuffix: true })}</span>
                      {ticket.departmentName && (
                        <>
                          <span>•</span>
                          <span>{ticket.departmentName}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    {ticket.assigneeName ? (
                      <span className="flex items-center gap-1.5 bg-secondary px-2 py-1 rounded-md text-xs">
                        <div className="w-4 h-4 rounded-full bg-primary/20 flex items-center justify-center text-[8px] text-primary">{ticket.assigneeName.charAt(0)}</div>
                        {ticket.assigneeName}
                      </span>
                    ) : (
                      <span className="text-xs border px-2 py-1 rounded-md border-dashed">{t("unassigned")}</span>
                    )}
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
