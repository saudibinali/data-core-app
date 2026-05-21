import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import {
  useGetDashboardSummary,
  useGetDashboardRecentActivity,
  useListUsers,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  UserPlus, KeyRound, Building2, Mail, Download, Settings2,
  Users, CheckCircle2, Activity, LayoutDashboard, ChevronRight,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

// ─── Quick admin action tiles ─────────────────────────────────────────────────
const QUICK_ACTIONS = [
  {
    key:   "dash_action_add_user",
    icon:  UserPlus,
    href:  "/users?action=create",
    color: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  },
  {
    key:   "dash_action_invite_user",
    icon:  Mail,
    href:  "/users?action=invite",
    color: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  },
  {
    key:   "dash_action_reset_pwd",
    icon:  KeyRound,
    href:  "/users?action=reset",
    color: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
  {
    key:   "dash_action_create_dept",
    icon:  Building2,
    href:  "/departments",
    color: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
  {
    key:   "dash_action_workspace_settings",
    icon:  Settings2,
    href:  "/settings",
    color: "bg-slate-500/10 text-slate-600 dark:text-slate-400",
  },
  {
    key:   "dash_action_export_data",
    icon:  Download,
    href:  "/users",
    color: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  },
] as const;

// ─── Admin navigation shortcuts ───────────────────────────────────────────────
const ADMIN_SHORTCUTS = [
  { key: "users",       icon: Users,         href: "/users" },
  { key: "departments", icon: Building2,     href: "/departments" },
  { key: "approvals",   icon: CheckCircle2,  href: "/approvals" },
  { key: "settings",    icon: Settings2,     href: "/settings" },
] as const;

// ─── Activity label map ───────────────────────────────────────────────────────
const ACTIVITY_LABEL: Record<string, string> = {
  ticket_created:     "Created a ticket",
  comment_added:      "Added a comment",
  status_changed:     "Updated status",
  assigned:           "Assigned ticket",
  approval_requested: "Requested approval",
  approval_completed: "Completed approval",
  cc_added:           "Added CC user",
  cc_removed:         "Removed CC user",
  priority_changed:   "Changed priority",
};

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const { t } = useTranslation();
  const { data: summary, isLoading: isLoadingSummary } = useGetDashboardSummary();
  const { data: users,   isLoading: isLoadingUsers    } = useListUsers();
  const { data: activities, isLoading: isLoadingActivity } = useGetDashboardRecentActivity({ limit: 15 });

  const activeCount     = users?.filter(u => u.employmentStatus === "active").length      ?? 0;
  const onLeaveCount    = users?.filter(u => u.employmentStatus === "on_leave").length    ?? 0;
  const terminatedCount = users?.filter(u => u.employmentStatus === "terminated").length  ?? 0;

  const recentUsers = [...(users ?? [])].sort((a, b) => b.id - a.id).slice(0, 6);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">{t("dashboard")}</h2>
          <p className="text-sm text-muted-foreground">{t("dash_subtitle")}</p>
        </div>
        <Link
          href="/users?action=create"
          className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md hover:bg-primary/90 text-sm font-medium shadow-sm transition-all active:scale-95"
        >
          <UserPlus className="w-4 h-4" />
          {t("dash_action_add_user")}
        </Link>
      </div>

      {/* ── Quick Actions ──────────────────────────────────────────────────── */}
      <section>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          {t("dash_quick_actions")}
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {QUICK_ACTIONS.map(({ key, icon: Icon, href, color }) => (
            <Link
              key={key}
              href={href}
              className="flex flex-col items-center gap-2.5 p-4 rounded-xl border border-border bg-card hover:border-primary/40 hover:shadow-md transition-all active:scale-95 text-center"
            >
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${color}`}>
                <Icon className="w-5 h-5" />
              </div>
              <span className="text-xs font-medium leading-tight text-foreground">{t(key)}</span>
            </Link>
          ))}
        </div>
      </section>

      {/* ── Workspace Stats ────────────────────────────────────────────────── */}
      <section>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          {t("dash_workspace_stats")}
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatTile
            label={t("dash_total_employees")}
            value={summary?.totalUsers}
            loading={isLoadingSummary}
            colorClass="text-foreground"
          />
          <StatTile
            label={t("dash_active_users")}
            value={activeCount}
            loading={isLoadingUsers}
            colorClass="text-emerald-600 dark:text-emerald-400"
            bgClass="bg-emerald-500/5"
          />
          <StatTile
            label={t("dash_on_leave")}
            value={onLeaveCount}
            loading={isLoadingUsers}
            colorClass="text-amber-600 dark:text-amber-400"
            bgClass="bg-amber-500/5"
          />
          <StatTile
            label={t("total_departments")}
            value={summary?.totalDepartments}
            loading={isLoadingSummary}
            colorClass="text-blue-600 dark:text-blue-400"
            bgClass="bg-blue-500/5"
          />
        </div>
      </section>

      {/* ── Main two-column area ───────────────────────────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-3">

        {/* Admin Activity Feed */}
        <Card className="lg:col-span-2 shadow-sm border-border">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="w-4 h-4 text-primary" />
              {t("dash_admin_activity")}
            </CardTitle>
            <CardDescription className="text-xs">{t("dash_admin_activity_desc")}</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingActivity ? (
              <div className="space-y-3">
                {[1, 2, 3, 4, 5].map(i => (
                  <Skeleton key={i} className="h-10 w-full rounded-md" />
                ))}
              </div>
            ) : !activities?.length ? (
              <div className="flex flex-col items-center justify-center py-12 text-center gap-2">
                <Activity className="w-8 h-8 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">{t("no_recent_activity")}</p>
              </div>
            ) : (
              <div className="relative space-y-0 ps-4 border-s-2 border-muted ms-2">
                {activities.map((activity) => (
                  <div key={activity.id} className="relative ps-5 pb-4 last:pb-0">
                    <div className="absolute start-[-5px] top-1.5 w-2 h-2 rounded-full bg-primary ring-4 ring-background" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm leading-snug">
                        {activity.userName && (
                          <span className="font-medium text-foreground">{activity.userName} </span>
                        )}
                        <span className="text-muted-foreground">
                          {ACTIVITY_LABEL[activity.action] ?? activity.action.replace(/_/g, " ")}
                        </span>
                        {activity.ticketId && (
                          <Link
                            href={`/tickets/${activity.ticketId}`}
                            className="ms-1 text-primary hover:underline font-medium text-xs"
                          >
                            #{activity.ticketId}
                          </Link>
                        )}
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {formatDistanceToNow(new Date(activity.createdAt), { addSuffix: true })}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right column */}
        <div className="flex flex-col gap-6">

          {/* User Presence */}
          <Card className="shadow-sm border-border">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="w-4 h-4 text-primary" />
                {t("dash_user_presence")}
              </CardTitle>
              <CardDescription className="text-xs">{t("dash_user_presence_desc")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-2">
                <div className="text-center p-2 rounded-lg bg-emerald-500/10">
                  <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
                    {isLoadingUsers ? "-" : activeCount}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{t("dash_active_users")}</p>
                </div>
                <div className="text-center p-2 rounded-lg bg-amber-500/10">
                  <p className="text-lg font-bold text-amber-600 dark:text-amber-400">
                    {isLoadingUsers ? "-" : onLeaveCount}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{t("dash_on_leave")}</p>
                </div>
                <div className="text-center p-2 rounded-lg bg-red-500/10">
                  <p className="text-lg font-bold text-red-600 dark:text-red-400">
                    {isLoadingUsers ? "-" : terminatedCount}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{t("dash_terminated")}</p>
                </div>
              </div>

              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">{t("dash_recently_joined")}</p>
                {isLoadingUsers ? (
                  <div className="space-y-2">
                    {[1, 2, 3].map(i => <Skeleton key={i} className="h-8 w-full rounded-md" />)}
                  </div>
                ) : (
                  <div className="space-y-1">
                    {recentUsers.map(user => (
                      <Link
                        key={user.id}
                        href="/users"
                        className="flex items-center gap-2 px-1.5 py-1 rounded-lg hover:bg-accent/60 transition-colors"
                      >
                        <img
                          src={user.avatarUrl ?? `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(user.fullName)}`}
                          alt={user.fullName}
                          className="w-6 h-6 rounded-full shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">{user.fullName}</p>
                          {user.position && (
                            <p className="text-[10px] text-muted-foreground truncate">{user.position}</p>
                          )}
                        </div>
                        <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                          user.employmentStatus === "active"   ? "bg-emerald-500" :
                          user.employmentStatus === "on_leave" ? "bg-amber-500"   :
                                                                 "bg-red-500"
                        }`} />
                      </Link>
                    ))}
                  </div>
                )}
                <Link
                  href="/users"
                  className="mt-3 flex items-center gap-1 text-xs text-primary hover:underline font-medium"
                >
                  {t("dash_view_all_users")}
                  <ChevronRight className="w-3 h-3" />
                </Link>
              </div>
            </CardContent>
          </Card>

          {/* Admin Shortcuts */}
          <Card className="shadow-sm border-border">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <LayoutDashboard className="w-4 h-4 text-primary" />
                {t("dash_admin_shortcuts")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-0.5">
              {ADMIN_SHORTCUTS.map(({ key, icon: Icon, href }) => (
                <Link
                  key={key}
                  href={href}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-accent/60 hover:text-primary transition-colors group"
                >
                  <Icon className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
                  <span className="text-sm font-medium flex-1">{t(key)}</span>
                  <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40 group-hover:text-primary transition-colors" />
                </Link>
              ))}
            </CardContent>
          </Card>

        </div>
      </div>
    </div>
  );
}

// ─── Stat tile component ──────────────────────────────────────────────────────
function StatTile({
  label, value, loading, colorClass, bgClass = "",
}: {
  label: string;
  value?: number;
  loading: boolean;
  colorClass: string;
  bgClass?: string;
}) {
  return (
    <div className={`flex flex-col gap-1 p-4 rounded-xl border border-border bg-card hover:shadow-sm transition-shadow ${bgClass}`}>
      <p className="text-xs text-muted-foreground font-medium">{label}</p>
      {loading ? (
        <Skeleton className="h-7 w-12 mt-0.5" />
      ) : (
        <p className={`text-2xl font-bold tracking-tight ${colorClass}`}>{value ?? 0}</p>
      )}
    </div>
  );
}
