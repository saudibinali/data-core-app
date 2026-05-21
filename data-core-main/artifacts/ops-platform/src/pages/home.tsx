import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "wouter";
import { format } from "date-fns";
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor,
  useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, rectSortingStrategy, useSortable, arrayMove,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  useGetMe, useGetDashboardSummary, useGetDashboardRecentActivity,
  useListTickets, useListApprovals, useListMessages, useListNotifications,
  useUpdateApproval, useMarkNotificationRead,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Ticket, CheckCircle2, Bell, Mail, GripVertical, ChevronDown, ChevronUp,
  EyeOff, Eye, Zap, Activity, Plus, ArrowRight, Clock, AlertCircle,
  Settings2, Check, X, User, Calendar, MessageSquare,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { useHomePrefs } from "@/hooks/use-home-prefs";

// ─── Widget Registry ──────────────────────────────────────────────────────────

interface WidgetDef {
  id: string;
  labelKey: string;
  icon: React.ElementType;
  defaultWide: boolean;
  hideable: boolean;
}

const WIDGET_DEFS: WidgetDef[] = [
  { id: "quick-actions",      labelKey: "widget_quick_actions",    icon: Zap,          defaultWide: true,  hideable: false },
  { id: "my-tickets",         labelKey: "widget_my_tickets",       icon: Ticket,       defaultWide: false, hideable: true  },
  { id: "pending-approvals",  labelKey: "widget_pending_approvals",icon: CheckCircle2, defaultWide: false, hideable: true  },
  { id: "unread-messages",    labelKey: "widget_unread_messages",  icon: Mail,         defaultWide: false, hideable: true  },
  { id: "notifications",      labelKey: "widget_notifications",    icon: Bell,         defaultWide: false, hideable: true  },
  { id: "recent-activity",    labelKey: "widget_recent_activity",  icon: Activity,     defaultWide: true,  hideable: true  },
];

const DEFAULT_ORDER = WIDGET_DEFS.map((w) => w.id);

// ─── Greeting ─────────────────────────────────────────────────────────────────

function getGreetingKey(): string {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return "good_morning";
  if (h >= 12 && h < 18) return "good_afternoon";
  return "good_evening";
}

// ─── Welcome Header ───────────────────────────────────────────────────────────

function WelcomeHeader() {
  const { t } = useTranslation();
  
  const { data: me, isLoading } = useGetMe();
  const now = useMemo(() => new Date(), []);

  const greeting = t(getGreetingKey());
  const name = me?.firstName || me?.fullName || "";
  const avatarSrc =
    me?.avatarUrl ||
    `https://api.dicebear.com/7.x/initials/svg?seed=${me?.fullName ?? "User"}`;

  return (
    <div className="relative rounded-2xl overflow-hidden bg-gradient-to-br from-primary/10 via-primary/5 to-background border border-border p-6 md:p-8">
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
        {/* Avatar */}
        <div className="relative shrink-0">
          {isLoading ? (
            <Skeleton className="w-16 h-16 rounded-full" />
          ) : (
            <img
              src={avatarSrc}
              alt={me?.fullName ?? "User"}
              className="w-16 h-16 rounded-full ring-2 ring-primary/20 object-cover"
            />
          )}
          <span className="absolute bottom-0.5 right-0.5 w-3.5 h-3.5 bg-green-500 rounded-full ring-2 ring-background" />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-7 w-48" />
              <Skeleton className="h-4 w-64" />
            </div>
          ) : (
            <>
              <h1 className="text-2xl font-bold text-foreground">
                {greeting}, {name}
              </h1>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-sm text-muted-foreground">
                {me?.employeeNumber && (
                  <span className="flex items-center gap-1">
                    <User className="w-3.5 h-3.5" />
                    {me.employeeNumber}
                  </span>
                )}
                {me?.position && (
                  <span className="flex items-center gap-1">
                    <span className="w-1 h-1 rounded-full bg-muted-foreground/40" />
                    {me.position}
                  </span>
                )}
                {me?.departmentName && (
                  <span className="flex items-center gap-1">
                    <span className="w-1 h-1 rounded-full bg-muted-foreground/40" />
                    {me.departmentName}
                  </span>
                )}
              </div>
            </>
          )}
        </div>

        {/* Date/Time */}
        <div className="shrink-0 text-right hidden sm:block">
          <p className="text-2xl font-semibold tabular-nums text-foreground">
            {format(now, "HH:mm")}
          </p>
          <p className="text-sm text-muted-foreground">
            {format(now, "EEEE, d MMMM yyyy")}
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Widget Shell ─────────────────────────────────────────────────────────────

interface WidgetShellProps {
  id: string;
  icon: React.ElementType;
  title: string;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onHide?: () => void;
  isCustomizing: boolean;
  dragHandleProps?: React.HTMLAttributes<HTMLButtonElement>;
  isDragging?: boolean;
  style?: React.CSSProperties;
  wide?: boolean;
  children: React.ReactNode;
  badge?: number;
  action?: React.ReactNode;
}

function WidgetShell({
  id, icon: Icon, title, isCollapsed, onToggleCollapse, onHide,
  isCustomizing, dragHandleProps, isDragging, style, wide, children, badge, action,
}: WidgetShellProps) {
  return (
    <Card
      style={style}
      className={cn(
        "shadow-sm border-border transition-all duration-200",
        wide && "col-span-2",
        isDragging && "shadow-xl opacity-80 scale-[1.02] z-50",
        isCustomizing && "ring-2 ring-primary/30",
      )}
    >
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          {isCustomizing && (
            <button
              {...dragHandleProps}
              className="p-1 rounded text-muted-foreground/50 hover:text-muted-foreground cursor-grab active:cursor-grabbing transition-colors shrink-0"
              tabIndex={-1}
              title="Drag to reorder"
            >
              <GripVertical className="w-4 h-4" />
            </button>
          )}
          <div className="p-1.5 rounded-md bg-primary/10 shrink-0">
            <Icon className="w-3.5 h-3.5 text-primary" />
          </div>
          <CardTitle className="text-sm font-semibold flex-1">{title}</CardTitle>
          {badge != null && badge > 0 && !isCollapsed && (
            <span className="bg-primary text-primary-foreground text-xs font-bold px-2 py-0.5 rounded-full">
              {badge}
            </span>
          )}
          {action && !isCollapsed && !isCustomizing && (
            <div className="shrink-0">{action}</div>
          )}
          {isCustomizing && onHide && (
            <button
              onClick={onHide}
              className="p-1 rounded text-muted-foreground/50 hover:text-destructive transition-colors"
              title="Hide widget"
            >
              <EyeOff className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={onToggleCollapse}
            className="p-1 rounded text-muted-foreground/50 hover:text-muted-foreground transition-colors"
            title={isCollapsed ? "Expand" : "Collapse"}
          >
            {isCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>
        </div>
      </CardHeader>
      {!isCollapsed && <CardContent className="pt-0">{children}</CardContent>}
    </Card>
  );
}

function SortableWidgetShell(props: Omit<WidgetShellProps, "dragHandleProps" | "isDragging" | "style">) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.id,
  });
  const style: React.CSSProperties = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div ref={setNodeRef} className={cn(props.wide && "col-span-2")}>
      <WidgetShell
        {...props}
        dragHandleProps={{ ...attributes, ...listeners } as React.HTMLAttributes<HTMLButtonElement>}
        isDragging={isDragging}
        style={style}
      />
    </div>
  );
}

// ─── Quick Actions Widget ─────────────────────────────────────────────────────

function QuickActionsWidget() {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const actions = [
    { label: t("new_ticket"),   icon: Plus,          href: "/tickets/new",           color: "bg-blue-500/10 text-blue-600 dark:text-blue-400" },
    { label: t("new_email"),    icon: Mail,           href: "/messages?compose=true", color: "bg-purple-500/10 text-purple-600 dark:text-purple-400" },
    { label: t("tickets"),      icon: Ticket,         href: "/tickets",               color: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
    { label: t("approvals"),    icon: CheckCircle2,   href: "/approvals",             color: "bg-green-500/10 text-green-600 dark:text-green-400" },
    { label: t("calendar"),     icon: Calendar,       href: "/calendar",              color: "bg-rose-500/10 text-rose-600 dark:text-rose-400" },
    { label: t("notifications"),icon: Bell,           href: "/notifications",         color: "bg-orange-500/10 text-orange-600 dark:text-orange-400" },
  ];

  return (
    <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
      {actions.map((a) => (
        <Link
          key={a.href}
          href={a.href}
          className="flex flex-col items-center gap-2 p-3 rounded-xl border border-border hover:border-primary/40 hover:bg-accent/50 transition-all group"
        >
          <div className={cn("p-2.5 rounded-lg transition-transform group-hover:scale-110", a.color)}>
            <a.icon className="w-5 h-5" />
          </div>
          <span className="text-xs font-medium text-center text-muted-foreground group-hover:text-foreground leading-tight">
            {a.label}
          </span>
        </Link>
      ))}
    </div>
  );
}

// ─── My Tickets Widget ────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  open:        "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  in_progress: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  pending:     "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  resolved:    "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  closed:      "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-300",
};

const PRIORITY_DOT: Record<string, string> = {
  low:    "bg-gray-400",
  medium: "bg-amber-500",
  high:   "bg-orange-500",
  urgent: "bg-red-500",
};

function MyTicketsWidget() {
  const { t } = useTranslation();
  const { data: rawTickets, isLoading } = useListTickets({ status: "open" });
  const tickets = rawTickets?.slice(0, 5);

  return (
    <div className="space-y-2">
      {isLoading ? (
        [1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)
      ) : !tickets?.length ? (
        <div className="flex flex-col items-center justify-center py-8 text-center gap-2">
          <CheckCircle2 className="w-8 h-8 text-green-500/50" />
          <p className="text-sm text-muted-foreground">{t("home_no_open_tickets")}</p>
        </div>
      ) : (
        tickets.map((ticket) => (
          <Link
            key={ticket.id}
            href={`/tickets/${ticket.id}`}
            className="flex items-start gap-3 p-3 rounded-lg border border-border hover:border-primary/40 hover:bg-accent/50 transition-all group"
          >
            <span className={cn("mt-1.5 w-2 h-2 rounded-full shrink-0", PRIORITY_DOT[ticket.priority] ?? "bg-gray-400")} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">{ticket.title}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {formatDistanceToNow(new Date(ticket.updatedAt), { addSuffix: true })}
                {ticket.departmentName && ` · ${ticket.departmentName}`}
              </p>
            </div>
            <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0", STATUS_COLORS[ticket.status])}>
              {t(`status_${ticket.status}`)}
            </span>
          </Link>
        ))
      )}
      <Link
        href="/tickets"
        className="flex items-center justify-center gap-1.5 w-full py-2 text-xs text-primary hover:underline font-medium"
      >
        {t("view_all_tickets")} <ArrowRight className="w-3.5 h-3.5" />
      </Link>
    </div>
  );
}

// ─── Pending Approvals Widget ─────────────────────────────────────────────────

function PendingApprovalsWidget() {
  const { t } = useTranslation();
  const { data: rawApprovals, isLoading, refetch } = useListApprovals({ status: "pending" });
  const approvals = rawApprovals?.slice(0, 5);
  const { mutate: updateApproval, isPending } = useUpdateApproval();

  function handleAction(id: number, status: "approved" | "rejected") {
    updateApproval(
      { id, data: { status } },
      { onSuccess: () => refetch() },
    );
  }

  return (
    <div className="space-y-2">
      {isLoading ? (
        [1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)
      ) : !approvals?.length ? (
        <div className="flex flex-col items-center justify-center py-8 text-center gap-2">
          <CheckCircle2 className="w-8 h-8 text-green-500/50" />
          <p className="text-sm text-muted-foreground">{t("home_no_pending_approvals")}</p>
        </div>
      ) : (
        approvals.map((approval) => (
          <div key={approval.id} className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">
                {t("ticket_ref", { id: approval.ticketId })}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t("home_requested_by")} {approval.requestedByName} ·{" "}
                {formatDistanceToNow(new Date(approval.createdAt), { addSuffix: true })}
              </p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => handleAction(approval.id, "approved")}
                disabled={isPending}
                className="p-1.5 rounded-md bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-400 dark:hover:bg-green-900/50 transition-colors"
                title={t("approve")}
              >
                <Check className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => handleAction(approval.id, "rejected")}
                disabled={isPending}
                className="p-1.5 rounded-md bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50 transition-colors"
                title={t("reject")}
              >
                <X className="w-3.5 h-3.5" />
              </button>
              <Link
                href={`/tickets/${approval.ticketId}`}
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              >
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>
        ))
      )}
      <Link
        href="/approvals"
        className="flex items-center justify-center gap-1.5 w-full py-2 text-xs text-primary hover:underline font-medium"
      >
        {t("view_all_approvals")} <ArrowRight className="w-3.5 h-3.5" />
      </Link>
    </div>
  );
}

// ─── Unread Messages Widget ───────────────────────────────────────────────────

function UnreadMessagesWidget() {
  const { t } = useTranslation();
  const { data: messages, isLoading } = useListMessages({ folder: "inbox" });
  const unread = (messages?.filter((m) => !m.isRead) ?? []).slice(0, 5);

  return (
    <div className="space-y-2">
      {isLoading ? (
        [1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)
      ) : !unread.length ? (
        <div className="flex flex-col items-center justify-center py-8 text-center gap-2">
          <Mail className="w-8 h-8 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">{t("home_no_unread_messages")}</p>
        </div>
      ) : (
        unread.map((msg) => (
          <Link
            key={msg.id}
            href={`/messages?id=${msg.id}`}
            className="flex items-start gap-3 p-3 rounded-lg border border-border hover:border-primary/40 hover:bg-accent/50 transition-all group"
          >
            <img
              src={msg.senderAvatar ?? `https://api.dicebear.com/7.x/initials/svg?seed=${msg.senderName}`}
              alt={msg.senderName}
              className="w-8 h-8 rounded-full shrink-0 mt-0.5"
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold truncate group-hover:text-primary">{msg.senderName}</p>
                <span className="text-[10px] text-muted-foreground shrink-0">
                  {formatDistanceToNow(new Date(msg.createdAt), { addSuffix: true })}
                </span>
              </div>
              <p className="text-xs font-medium truncate text-foreground/80">{msg.subject}</p>
              <p className="text-xs text-muted-foreground truncate mt-0.5">{msg.bodyPreview}</p>
            </div>
          </Link>
        ))
      )}
      <Link
        href="/messages"
        className="flex items-center justify-center gap-1.5 w-full py-2 text-xs text-primary hover:underline font-medium"
      >
        {t("view_all_messages")} <ArrowRight className="w-3.5 h-3.5" />
      </Link>
    </div>
  );
}

// ─── Notifications Widget ─────────────────────────────────────────────────────

function NotificationsWidget() {
  const { t } = useTranslation();
  const { data: rawNotifs, isLoading, refetch } = useListNotifications({ unreadOnly: true });
  const notifs = rawNotifs?.slice(0, 5);
  const { mutate: markRead } = useMarkNotificationRead();

  function handleMarkRead(id: number) {
    markRead({ id }, { onSuccess: () => refetch() });
  }

  return (
    <div className="space-y-2">
      {isLoading ? (
        [1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)
      ) : !notifs?.length ? (
        <div className="flex flex-col items-center justify-center py-8 text-center gap-2">
          <Bell className="w-8 h-8 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">{t("home_no_notifications")}</p>
        </div>
      ) : (
        notifs.map((n) => (
          <div
            key={n.id}
            className="flex items-start gap-3 p-3 rounded-lg border border-border bg-card group"
          >
            <div className="mt-1 w-2 h-2 rounded-full bg-primary shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium leading-snug">{n.title}</p>
              {n.message && <p className="text-xs text-muted-foreground mt-0.5 truncate">{n.message}</p>}
              <p className="text-[10px] text-muted-foreground mt-1">
                {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
              </p>
            </div>
            <button
              onClick={() => handleMarkRead(n.id)}
              className="p-1 rounded text-muted-foreground/40 hover:text-primary opacity-0 group-hover:opacity-100 transition-all shrink-0"
              title={t("mark_as_read")}
            >
              <Check className="w-3.5 h-3.5" />
            </button>
          </div>
        ))
      )}
      <Link
        href="/notifications"
        className="flex items-center justify-center gap-1.5 w-full py-2 text-xs text-primary hover:underline font-medium"
      >
        {t("view_all_notifications")} <ArrowRight className="w-3.5 h-3.5" />
      </Link>
    </div>
  );
}

// ─── Recent Activity Widget ───────────────────────────────────────────────────

function RecentActivityWidget() {
  const { t } = useTranslation();
  const { data: activities, isLoading } = useGetDashboardRecentActivity({ limit: 8 });

  return (
    <div>
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-10 w-full rounded-md" />)}
        </div>
      ) : !activities?.length ? (
        <div className="flex flex-col items-center justify-center py-8 text-center gap-2">
          <Activity className="w-8 h-8 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">{t("no_recent_activity")}</p>
        </div>
      ) : (
        <div className="relative pl-4 border-l-2 border-muted ml-2 space-y-0">
          {activities.map((activity) => (
            <div key={activity.id} className="relative pl-5 pb-4 last:pb-0">
              <div className="absolute left-[-5px] top-1.5 w-2 h-2 rounded-full bg-primary ring-4 ring-background" />
              <div className="flex items-start gap-2 text-sm flex-wrap">
                <span className="font-medium">{activity.userName}</span>
                <span className="text-muted-foreground">{activity.action.replace(/_/g, " ")}</span>
                {activity.ticketId && (
                  <Link href={`/tickets/${activity.ticketId}`} className="text-primary hover:underline font-medium">
                    {t("ticket_ref", { id: activity.ticketId })}
                  </Link>
                )}
                <span className="text-muted-foreground text-xs ml-auto">
                  {formatDistanceToNow(new Date(activity.createdAt), { addSuffix: true })}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Widget Content Router ────────────────────────────────────────────────────

function WidgetContent({ id }: { id: string }) {
  switch (id) {
    case "quick-actions":     return <QuickActionsWidget />;
    case "my-tickets":        return <MyTicketsWidget />;
    case "pending-approvals": return <PendingApprovalsWidget />;
    case "unread-messages":   return <UnreadMessagesWidget />;
    case "notifications":     return <NotificationsWidget />;
    case "recent-activity":   return <RecentActivityWidget />;
    default:                  return null;
  }
}

// ─── Main Home Page ───────────────────────────────────────────────────────────

export default function HomePage() {
  const { t } = useTranslation();
  const [isCustomizing, setIsCustomizing] = useState(false);
  const { data: summary } = useGetDashboardSummary();

  const { order, collapsed, hidden, reorder, toggleCollapsed, toggleHidden } =
    useHomePrefs(DEFAULT_ORDER);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const widgetMap = useMemo(
    () => Object.fromEntries(WIDGET_DEFS.map((w) => [w.id, w])),
    [],
  );

  const visibleOrder = order.filter((id) => !hidden.includes(id));
  const hiddenWidgets = WIDGET_DEFS.filter((w) => hidden.includes(w.id));

  const badges: Record<string, number> = {
    "my-tickets":        summary?.openTickets ?? 0,
    "pending-approvals": summary?.pendingApprovals ?? 0,
    "unread-messages":   summary?.unreadNotifications ?? 0,
    "notifications":     summary?.unreadNotifications ?? 0,
  };

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = visibleOrder.indexOf(String(active.id));
    const newIdx = visibleOrder.indexOf(String(over.id));
    if (oldIdx !== -1 && newIdx !== -1) {
      const newVisible = arrayMove(visibleOrder, oldIdx, newIdx);
      const newOrder = [
        ...newVisible,
        ...order.filter((id) => !newVisible.includes(id)),
      ];
      reorder(newOrder);
    }
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Welcome Header */}
      <WelcomeHeader />

      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-muted-foreground">
          {isCustomizing ? t("home_customizing") : t("home_workspace")}
        </h2>
        <Button
          variant={isCustomizing ? "default" : "outline"}
          size="sm"
          className="gap-2"
          onClick={() => setIsCustomizing((v) => !v)}
        >
          <Settings2 className="w-4 h-4" />
          {isCustomizing ? t("home_done") : t("home_customize")}
        </Button>
      </div>

      {/* Hidden Widgets restore panel */}
      {isCustomizing && hiddenWidgets.length > 0 && (
        <div className="rounded-xl border border-dashed border-border p-4">
          <p className="text-xs text-muted-foreground font-medium mb-3 uppercase tracking-wider">
            {t("home_hidden_widgets")}
          </p>
          <div className="flex flex-wrap gap-2">
            {hiddenWidgets.map((w) => (
              <button
                key={w.id}
                onClick={() => toggleHidden(w.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border text-sm text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors"
              >
                <Eye className="w-3.5 h-3.5" />
                {t(w.labelKey)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Widget Grid */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={visibleOrder} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {visibleOrder.map((id) => {
              const def = widgetMap[id];
              if (!def) return null;
              return (
                <SortableWidgetShell
                  key={id}
                  id={id}
                  icon={def.icon}
                  title={t(def.labelKey)}
                  isCollapsed={collapsed.includes(id)}
                  onToggleCollapse={() => toggleCollapsed(id)}
                  onHide={def.hideable ? () => toggleHidden(id) : undefined}
                  isCustomizing={isCustomizing}
                  wide={def.defaultWide}
                  badge={badges[id]}
                >
                  <WidgetContent id={id} />
                </SortableWidgetShell>
              );
            })}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
