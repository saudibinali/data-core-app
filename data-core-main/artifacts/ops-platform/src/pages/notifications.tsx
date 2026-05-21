import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useListNotifications,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useDeleteNotification,
  useDeleteManyNotifications,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { formatDistanceToNow } from "date-fns";
import {
  Bell, Check, Ticket as TicketIcon, CalendarDays, Mail,
  CheckCircle2, LayoutList, ArrowRight, Trash2, X, FileText,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";

// ─── Types ────────────────────────────────────────────────────────────────────

type NotifType = "mention" | "ticket_update" | "approval_request" | "approval_decision"
  | "comment_added" | "assigned" | "calendar" | "mail" | "message" | string;

interface NavTarget { dest: string; href: string }

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TICKET_TYPES   = new Set(["ticket_update", "mention", "comment_added", "assigned"]);
const APPROVAL_TYPES = new Set(["approval_request", "approval_decision"]);
const CALENDAR_TYPES = new Set(["calendar"]);
const MESSAGE_TYPES  = new Set(["mail", "message"]);
const REPORT_TYPES   = new Set(["export_completed", "export_failed"]);

function getNavTarget(
  type: NotifType,
  ticketId: number | null | undefined,
  t: (key: string, opts?: Record<string, unknown>) => string,
): NavTarget | null {
  if (TICKET_TYPES.has(type) && ticketId)
    return { dest: t("notif_dest_ticket", { id: ticketId }), href: `/tickets/${ticketId}` };
  if (APPROVAL_TYPES.has(type))
    return { dest: t("notif_dest_approvals"), href: "/approvals" };
  if (CALENDAR_TYPES.has(type))
    return { dest: t("notif_dest_calendar"), href: "/calendar" };
  if (MESSAGE_TYPES.has(type))
    return { dest: t("notif_dest_messages"), href: "/messages" };
  if (REPORT_TYPES.has(type))
    return { dest: t("notif_dest_reports", { defaultValue: "Report Center" }), href: "/hr/reports" };
  return null;
}

function getNotifIcon(type: NotifType) {
  if (TICKET_TYPES.has(type))   return <TicketIcon  className="w-5 h-5 text-blue-500"   />;
  if (APPROVAL_TYPES.has(type)) return <CheckCircle2 className="w-5 h-5 text-green-500" />;
  if (CALENDAR_TYPES.has(type)) return <CalendarDays className="w-5 h-5 text-violet-500"/>;
  if (MESSAGE_TYPES.has(type))  return <Mail         className="w-5 h-5 text-amber-500" />;
  if (REPORT_TYPES.has(type))   return <FileText     className="w-5 h-5 text-indigo-500" />;
  return                               <Bell         className="w-5 h-5 text-primary"   />;
}

// ─── Filter Tabs ──────────────────────────────────────────────────────────────

type FilterKey = "all" | "tickets" | "calendar" | "messages" | "approvals";

function useFilterTabs(t: (key: string) => string) {
  return [
    { key: "all"       as FilterKey, label: t("filter_all"),             Icon: LayoutList    },
    { key: "tickets"   as FilterKey, label: t("notif_filter_tickets"),   Icon: TicketIcon    },
    { key: "calendar"  as FilterKey, label: t("notif_filter_calendar"),  Icon: CalendarDays  },
    { key: "messages"  as FilterKey, label: t("notif_filter_messages"),  Icon: Mail          },
    { key: "approvals" as FilterKey, label: t("notif_filter_approvals"), Icon: CheckCircle2  },
  ];
}

function matchesFilter(type: NotifType, filter: FilterKey): boolean {
  if (filter === "all")       return true;
  if (filter === "tickets")   return TICKET_TYPES.has(type);
  if (filter === "calendar")  return CALENDAR_TYPES.has(type);
  if (filter === "messages")  return MESSAGE_TYPES.has(type);
  if (filter === "approvals") return APPROVAL_TYPES.has(type);
  return true;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function NotificationsPage() {
  const { t } = useTranslation();
  const [, navigate] = useLocation();

  const { data: notifications, isLoading } = useListNotifications({});
  const markAllRead   = useMarkAllNotificationsRead();
  const markRead      = useMarkNotificationRead();
  const deleteOne     = useDeleteNotification();
  const deleteMany    = useDeleteManyNotifications();
  const queryClient   = useQueryClient();

  const [activeFilter, setActiveFilter]   = useState<FilterKey>("all");
  const [selected, setSelected]           = useState<Set<number>>(new Set());
  // When pending is set, we show a nav confirmation for that notification
  const [pending, setPending]             = useState<{ id: number; nav: NavTarget } | null>(null);

  const filterTabs = useFilterTabs(t);

  // ── invalidate helpers ─────────────────────────────────────────────────────

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
  };

  // ── mark all read ─────────────────────────────────────────────────────────

  const handleMarkAll = () => markAllRead.mutate(undefined, { onSuccess: invalidate });

  // ── click on a notification row ────────────────────────────────────────────

  const handleNotifClick = (notif: { id: number; isRead: boolean; type: string; ticketId?: number | null }) => {
    if (!notif.isRead) {
      markRead.mutate({ id: notif.id }, { onSuccess: invalidate });
    }
    const nav = getNavTarget(notif.type, notif.ticketId, t);
    if (nav) {
      navigate(nav.href);
    }
  };

  // ── delete single ──────────────────────────────────────────────────────────

  const handleDeleteOne = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    deleteOne.mutate({ id }, { onSuccess: () => {
      setSelected(prev => { const next = new Set(prev); next.delete(id); return next; });
      invalidate();
    }});
  };

  // ── delete selected ────────────────────────────────────────────────────────

  const handleDeleteSelected = () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    deleteMany.mutate({ data: { ids } }, { onSuccess: () => {
      setSelected(new Set());
      invalidate();
    }});
  };

  // ── select helpers ─────────────────────────────────────────────────────────

  const filtered = (notifications ?? []).filter(n => matchesFilter(n.type as NotifType, activeFilter));

  const toggleSelect = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const allFilteredSelected = filtered.length > 0 && filtered.every(n => selected.has(n.id));

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelected(prev => {
        const next = new Set(prev);
        filtered.forEach(n => next.delete(n.id));
        return next;
      });
    } else {
      setSelected(prev => {
        const next = new Set(prev);
        filtered.forEach(n => next.add(n.id));
        return next;
      });
    }
  };

  // ── unread counts per tab ──────────────────────────────────────────────────

  const unreadCount = (key: FilterKey) =>
    (notifications ?? []).filter(n => !n.isRead && matchesFilter(n.type as NotifType, key)).length;

  const selectedCount = selected.size;

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 max-w-4xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">{t("notifications")}</h2>
          <p className="text-muted-foreground">{t("notifications_subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          {selectedCount > 0 && (
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDeleteSelected}
              disabled={deleteMany.isPending}
              className="gap-1.5"
            >
              <Trash2 className="w-4 h-4" />
              {t("delete_selected_count", { count: selectedCount })}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={handleMarkAll} disabled={markAllRead.isPending}>
            <Check className="w-4 h-4 me-2" /> {t("mark_all_read")}
          </Button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex flex-wrap gap-2">
        {filterTabs.map(({ key, label, Icon }) => {
          const count = key === "all" ? 0 : unreadCount(key);
          const isActive = activeFilter === key;
          return (
            <button
              key={key}
              onClick={() => { setActiveFilter(key); setSelected(new Set()); }}
              className={[
                "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground border-border hover:border-primary/50 hover:text-foreground",
              ].join(" ")}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
              {count > 0 && (
                <Badge
                  variant={isActive ? "secondary" : "default"}
                  className="h-4 min-w-4 px-1 text-[10px] leading-none rounded-full"
                >
                  {count}
                </Badge>
              )}
            </button>
          );
        })}
      </div>

      {/* List */}
      <Card className="border-border shadow-sm">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-4">
              {[1, 2, 3, 4, 5].map(i => (
                <Skeleton key={i} className="h-16 w-full rounded-md" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground flex flex-col items-center justify-center">
              <Bell className="w-8 h-8 mb-4 opacity-20" />
              <p>
                {activeFilter === "all"
                  ? t("all_caught_up")
                  : t("notif_no_filter_results")}
              </p>
            </div>
          ) : (
            <>
              {/* Select-all bar - shown when list is non-empty */}
              <div className="flex items-center gap-3 px-4 py-2 border-b bg-muted/30">
                <Checkbox
                  checked={allFilteredSelected}
                  onCheckedChange={toggleSelectAll}
                  aria-label="Select all"
                />
                <span className="text-xs text-muted-foreground">
                  {selectedCount > 0
                    ? t("selected_count", { count: selectedCount })
                    : t("select_all")}
                </span>
              </div>

              <div className="divide-y divide-border">
                {filtered.map(notif => {
                  const hasNav = getNavTarget(notif.type, notif.ticketId, t) !== null;
                  const isSelected = selected.has(notif.id);

                  return (
                    <div
                      key={notif.id}
                      onClick={() => handleNotifClick(notif)}
                      className={[
                        "p-4 flex gap-3 transition-colors group",
                        hasNav ? "cursor-pointer" : "cursor-default",
                        isSelected
                          ? "bg-primary/10"
                          : notif.isRead
                            ? "opacity-60 bg-transparent hover:bg-muted/40"
                            : "bg-primary/5 hover:bg-primary/10",
                      ].join(" ")}
                    >
                      {/* Checkbox */}
                      <div
                        className="flex-shrink-0 flex items-center justify-center mt-1"
                        onClick={e => toggleSelect(e, notif.id)}
                      >
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => {}}
                          className="pointer-events-none"
                        />
                      </div>

                      {/* Icon */}
                      <div className="mt-0.5 flex-shrink-0">
                        <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center">
                          {getNotifIcon(notif.type as NotifType)}
                        </div>
                      </div>

                      {/* Body */}
                      <div className="flex-1 min-w-0 space-y-0.5">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-semibold text-sm leading-snug truncate">{notif.title}</p>
                          <span className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0">
                            {formatDistanceToNow(new Date(notif.createdAt), { addSuffix: true })}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground leading-snug">{notif.message}</p>

                        {/* Navigate hint */}
                        {hasNav && (
                          <p className="text-xs text-primary/70 flex items-center gap-1 pt-0.5">
                            <ArrowRight className="w-3 h-3" />
                            {getNavTarget(notif.type, notif.ticketId, t)?.dest}
                          </p>
                        )}
                      </div>

                      {/* Unread dot + delete button */}
                      <div className="flex-shrink-0 flex flex-col items-center gap-2 mt-1">
                        {!notif.isRead && (
                          <span className="w-2.5 h-2.5 rounded-full bg-primary block" />
                        )}
                        <button
                          onClick={e => handleDeleteOne(e, notif.id)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                          title={t("delete")}
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
