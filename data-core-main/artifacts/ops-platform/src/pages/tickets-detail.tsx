import { useTranslation } from "react-i18next";
import { useParams, Link } from "wouter";
import { useGetTicket, getGetTicketQueryKey, useUpdateTicket, useListComments, getListCommentsQueryKey, useCreateComment, useListActivity, getListActivityQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Send, Clock, User, Building2, TicketIcon } from "lucide-react";

export default function TicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const ticketId = parseInt(id, 10);
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: ticket, isLoading: isLoadingTicket } = useGetTicket(ticketId, {
    query: { enabled: !!ticketId, queryKey: getGetTicketQueryKey(ticketId) }
  });

  const { data: comments } = useListComments(ticketId, {
    query: { enabled: !!ticketId, queryKey: getListCommentsQueryKey(ticketId) }
  });

  const { data: activity } = useListActivity({ ticketId }, {
    query: { enabled: !!ticketId, queryKey: getListActivityQueryKey({ ticketId }) }
  });

  const updateTicket = useUpdateTicket();
  const createComment = useCreateComment();
  const [commentText, setCommentText] = useState("");

  const handleStatusChange = (status: string) => {
    updateTicket.mutate({
      id: ticketId,
      data: { status: status as any }
    }, {
      onSuccess: () => {
        toast({ title: t("status_updated") });
        queryClient.invalidateQueries({ queryKey: getGetTicketQueryKey(ticketId) });
      }
    });
  };

  const handleComment = () => {
    if (!commentText.trim()) return;
    createComment.mutate({
      ticketId,
      data: { content: commentText }
    }, {
      onSuccess: () => {
        setCommentText("");
        toast({ title: t("comment_added") });
        queryClient.invalidateQueries({ queryKey: ["comments", ticketId] });
      }
    });
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

  if (isLoadingTicket) {
    return <div className="space-y-4"><Skeleton className="h-12 w-1/3" /><Skeleton className="h-[400px] w-full" /></div>;
  }

  if (!ticket) return <div>{t("ticket_not_found")}</div>;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="lg:col-span-2 space-y-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link href="/tickets" className="hover:text-foreground hover:underline">{t("tickets")}</Link>
            <span>/</span>
            <span>T-{ticket.id}</span>
          </div>
          <h2 className="text-3xl font-bold tracking-tight">{ticket.title}</h2>
          <div className="flex items-center gap-3">
            <Badge variant="outline">{statusLabel(ticket.status)}</Badge>
            <Badge variant="secondary">{priorityLabel(ticket.priority)}</Badge>
            <span className="text-sm text-muted-foreground">{formatDistanceToNow(new Date(ticket.createdAt), { addSuffix: true })}</span>
          </div>
        </div>

        <Card>
          <CardContent className="p-6">
            <div className="prose dark:prose-invert max-w-none">
              {ticket.description || <span className="text-muted-foreground italic">{t("no_description")}</span>}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <h3 className="text-lg font-semibold">{t("discussion")}</h3>
          
          <div className="space-y-4">
            {comments?.map(comment => (
              <Card key={comment.id}>
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <img src={comment.authorAvatarUrl || `https://api.dicebear.com/7.x/initials/svg?seed=${comment.authorName}`} className="w-6 h-6 rounded-full" alt={comment.authorName} />
                      <span className="font-medium text-sm">{comment.authorName}</span>
                      {comment.isInternal && <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4">{t("internal_badge")}</Badge>}
                    </div>
                    <span className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true })}</span>
                  </div>
                  <p className="text-sm">{comment.content}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardContent className="p-4 space-y-4">
              <Textarea 
                placeholder={t("comment_placeholder")}
                value={commentText}
                onChange={e => setCommentText(e.target.value)}
                className="min-h-[100px]"
              />
              <div className="flex justify-end">
                <Button onClick={handleComment} disabled={!commentText.trim() || createComment.isPending}>
                  <Send className="w-4 h-4 mr-2" />
                  {t("comment_btn")}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader className="pb-3 border-b">
            <CardTitle className="text-sm">{t("properties")}</CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-4">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground flex items-center gap-2"><TicketIcon className="w-3 h-3" /> {t("status_open").replace("Open", t("properties"))}</label>
              <label className="text-xs text-muted-foreground flex items-center gap-2"><TicketIcon className="w-3 h-3" /> Status</label>
              <Select value={ticket.status} onValueChange={handleStatusChange}>
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">{t("status_open")}</SelectItem>
                  <SelectItem value="in_progress">{t("status_in_progress")}</SelectItem>
                  <SelectItem value="pending">{t("status_pending")}</SelectItem>
                  <SelectItem value="resolved">{t("status_resolved")}</SelectItem>
                  <SelectItem value="closed">{t("status_closed")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground flex items-center gap-2"><User className="w-3 h-3" /> {t("ticket_assignee_label")}</label>
              <div className="text-sm font-medium">{ticket.assigneeName || t("unassigned")}</div>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-muted-foreground flex items-center gap-2"><Building2 className="w-3 h-3" /> {t("ticket_dept_label")}</label>
              <div className="text-sm">{ticket.departmentName || t("none")}</div>
            </div>
            
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground flex items-center gap-2"><User className="w-3 h-3" /> {t("reporter")}</label>
              <div className="text-sm">{ticket.createdByName}</div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3 border-b">
            <CardTitle className="text-sm flex items-center gap-2"><Clock className="w-4 h-4" /> {t("timeline")}</CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <div className="relative space-y-0 pl-4 border-l-2 border-muted ml-2">
              {activity?.map((act) => (
                <div key={act.id} className="relative pl-4 pb-4 last:pb-0">
                  <div className="absolute left-[-5px] top-1.5 w-2 h-2 rounded-full bg-primary ring-4 ring-card" />
                  <div className="flex flex-col gap-1 text-xs">
                    <div>
                      <span className="font-medium text-foreground">{act.userName}</span>{' '}
                      <span className="text-muted-foreground">{act.action.replace('_', ' ')}</span>
                    </div>
                    <div className="text-muted-foreground">{formatDistanceToNow(new Date(act.createdAt), { addSuffix: true })}</div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
