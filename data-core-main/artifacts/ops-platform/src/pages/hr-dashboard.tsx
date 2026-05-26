import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { useGetHrDashboard } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { usePermissions } from "@/hooks/use-permissions";
import {
  Users, UserCheck, UserPlus, Briefcase, ClipboardList,
  Building2, ChevronRight, Settings2, HeartPulse, FileText,
  CheckCircle2, BriefcaseBusiness, Layers, DollarSign, Clock, CalendarDays,
  Activity, Scale, ShieldCheck, ConciergeBell, Plug,
} from "lucide-react";
import { PlatformHealthCard } from "@/components/hr/platform-health-card";

const EMPLOYMENT_TYPE_LABELS: Record<string, string> = {
  full_time: "Full-time",
  part_time: "Part-time",
  contractor: "Contractor",
  intern: "Intern",
  temporary: "Temporary",
};

const EMPLOYMENT_TYPE_COLORS: Record<string, string> = {
  full_time:  "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  part_time:  "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300",
  contractor: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  intern:     "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  temporary:  "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300",
};

function StatCard({ icon: Icon, label, value, color, href }: {
  icon: React.ElementType;
  label: string;
  value: number | string;
  color: string;
  href?: string;
}) {
  const inner = (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="text-3xl font-bold mt-1">{value}</p>
          </div>
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${color}`}>
            <Icon className="w-6 h-6" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
  if (href) return <Link href={href}>{inner}</Link>;
  return inner;
}

export default function HrDashboardPage() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language.startsWith("ar");
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("admin") || hasPermission("hr.manage");

  const { data, isLoading } = useGetHrDashboard();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BriefcaseBusiness className="w-6 h-6 text-primary" />
            {isAr ? "لوحة تحكم الموارد البشرية" : "HR Dashboard"}
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {isAr
              ? "منصة موارد بشرية متكاملة — موظفون، حضور، إجازات، رواتب"
              : "Integrated HCM — employees, time, leave, and payroll"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <>
              <Link href="/admin/hr/foundation">
                <button className="flex items-center gap-2 text-sm px-3 py-2 rounded-md border border-border hover:bg-accent transition-colors">
                  <Layers className="w-4 h-4" />
                  {isAr ? "البيانات الأساسية" : "Foundation Data"}
                </button>
              </Link>
              <Link href="/admin/hr/services">
                <button className="flex items-center gap-2 text-sm px-3 py-2 rounded-md border border-border hover:bg-accent transition-colors">
                  <Settings2 className="w-4 h-4" />
                  {isAr ? "إدارة الخدمات" : "Manage Services"}
                </button>
              </Link>
              <Link href="/admin/hr/payroll">
                <button className="flex items-center gap-2 text-sm px-3 py-2 rounded-md border border-border hover:bg-accent transition-colors">
                  <DollarSign className="w-4 h-4" />
                  {isAr ? "الرواتب" : "Payroll"}
                </button>
              </Link>
              <Link href="/admin/hr/attendance">
                <button className="flex items-center gap-2 text-sm px-3 py-2 rounded-md border border-border hover:bg-accent transition-colors">
                  <Clock className="w-4 h-4" />
                  {isAr ? "الحضور" : "Attendance"}
                </button>
              </Link>
              <Link href="/admin/hr/leave">
                <button className="flex items-center gap-2 text-sm px-3 py-2 rounded-md border border-border hover:bg-accent transition-colors">
                  <CalendarDays className="w-4 h-4" />
                  {isAr ? "إدارة الإجازات" : "Leave"}
                </button>
              </Link>
              <Link href="/admin/platform/stabilization">
                <button className="flex items-center gap-2 text-sm px-3 py-2 rounded-md border border-border hover:bg-accent transition-colors">
                  <ShieldCheck className="w-4 h-4" />
                  {isAr ? "استقرار المنصة" : "Stabilization"}
                </button>
              </Link>
            </>
          )}
          <Link href="/hr/services">
            <button className="flex items-center gap-2 text-sm px-3 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
              <ClipboardList className="w-4 h-4" />
              {isAr ? "خدمات الموظفين" : "Employee Services"}
            </button>
          </Link>
        </div>
      </div>

      {isAdmin && <PlatformHealthCard isAr={isAr} />}

      {/* Quick nav links */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { href: "/hr/employees",          icon: Users,         label: isAr ? "الموظفون" : "Employees",   color: "bg-blue-500/10 text-blue-600 dark:text-blue-400",    show: true },
          { href: "/hr/services",           icon: ClipboardList, label: isAr ? "الخدمات" : "Services",     color: "bg-violet-500/10 text-violet-600 dark:text-violet-400", show: true },
          { href: "/admin/hr/forms",        icon: ClipboardList, label: isAr ? "إدارة النماذج" : "Forms",  color: "bg-teal-500/10 text-teal-600 dark:text-teal-400",       show: isAdmin },
          { href: "/admin/hr/payroll",      icon: DollarSign,    label: isAr ? "الرواتب" : "Payroll",      color: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", show: isAdmin },
          { href: "/admin/hr/attendance",   icon: Clock,         label: isAr ? "الحضور" : "Attendance", color: "bg-sky-500/10 text-sky-600 dark:text-sky-400", show: isAdmin },
          { href: "/admin/hr/leave",       icon: CalendarDays,  label: isAr ? "إدارة الإجازات" : "Leave Management", color: "bg-violet-500/10 text-violet-600 dark:text-violet-400", show: isAdmin },
          { href: "/admin/hr/workforce-ops", icon: Activity,    label: isAr ? "عمليات القوى العاملة" : "Workforce Ops", color: "bg-orange-500/10 text-orange-600 dark:text-orange-400", show: isAdmin },
          { href: "/admin/integrations",     icon: Plug,        label: isAr ? "مركز التكاملات" : "Integrations", color: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400", show: isAdmin },
          { href: "/admin/hr/payroll-ops",   icon: Scale,       label: isAr ? "عمليات الرواتب" : "Payroll Ops", color: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400", show: isAdmin },
          { href: "/self-service",           icon: ConciergeBell, label: isAr ? "الخدمات الذاتية" : "Self-Service", color: "bg-violet-500/10 text-violet-600 dark:text-violet-400", show: true },
          { href: "/hr/reports",            icon: FileText,      label: isAr ? "مركز التقارير" : "Report Center", color: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400", show: isAdmin },
          { href: "/approvals",             icon: CheckCircle2,  label: isAr ? "الموافقات" : "Approvals",  color: "bg-amber-500/10 text-amber-600 dark:text-amber-400",   show: true },
          { href: "/departments",           icon: Building2,     label: isAr ? "الأقسام" : "Departments",  color: "bg-rose-500/10 text-rose-600 dark:text-rose-400",      show: true },
        ].filter((x) => x.show).map(({ href, icon: Icon, label, color }) => (
          <Link key={href} href={href}>
            <div className="flex items-center gap-3 p-3 rounded-xl border border-border hover:bg-accent/50 transition-colors cursor-pointer">
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${color}`}>
                <Icon className="w-4 h-4" />
              </div>
              <span className="text-sm font-medium">{label}</span>
              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground ml-auto shrink-0" />
            </div>
          </Link>
        ))}
      </div>

      {/* Stat cards */}
      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={i}><CardContent className="p-5"><Skeleton className="h-16 w-full" /></CardContent></Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          <StatCard icon={Users}        label={isAr ? "إجمالي الموظفين" : "Total Employees"}    value={data?.totalEmployees ?? 0}    color="bg-blue-500/10 text-blue-600 dark:text-blue-400"    href="/hr/employees" />
          <StatCard icon={UserCheck}    label={isAr ? "موظفون نشطون" : "Active Employees"}       value={data?.activeEmployees ?? 0}   color="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" />
          <StatCard icon={UserPlus}     label={isAr ? "موظفون جدد (30 يوم)" : "New Hires (30d)"} value={data?.newHiresThisMonth ?? 0} color="bg-violet-500/10 text-violet-600 dark:text-violet-400" />
          <StatCard icon={Briefcase}    label={isAr ? "الخدمات النشطة" : "Active Services"}      value={data?.activeServices ?? 0}    color="bg-amber-500/10 text-amber-600 dark:text-amber-400"     href="/hr/services" />
          <StatCard icon={ClipboardList} label={isAr ? "طلبات معلقة" : "Pending Requests"}      value={data?.pendingSubmissions ?? 0} color="bg-rose-500/10 text-rose-600 dark:text-rose-400"        href="/approvals" />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* By Department */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="w-4 h-4 text-muted-foreground" />
              {isAr ? "الموظفون حسب القسم" : "Employees by Department"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
            ) : !data?.byDepartment?.length ? (
              <p className="text-sm text-muted-foreground text-center py-6">{isAr ? "لا توجد بيانات" : "No data yet"}</p>
            ) : (
              <div className="space-y-2">
                {(data.byDepartment as any[]).map((d, i) => {
                  const max = Math.max(...(data.byDepartment as any[]).map((x: any) => x.cnt));
                  const pct = max > 0 ? Math.round((d.cnt / max) * 100) : 0;
                  return (
                    <div key={i} className="flex items-center gap-3">
                      <span className="text-sm w-28 truncate shrink-0">{d.departmentName ?? (isAr ? "غير محدد" : "Unassigned")}</span>
                      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-sm font-medium w-6 text-right">{d.cnt}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* By Employment Type */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Briefcase className="w-4 h-4 text-muted-foreground" />
              {isAr ? "نوع التوظيف" : "Employment Type Breakdown"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
            ) : !data?.byEmploymentType?.length ? (
              <p className="text-sm text-muted-foreground text-center py-6">{isAr ? "لا توجد بيانات" : "No data yet"}</p>
            ) : (
              <div className="flex flex-wrap gap-2 pt-2">
                {(data.byEmploymentType as any[]).map((d, i) => (
                  <div key={i} className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium ${EMPLOYMENT_TYPE_COLORS[d.type] ?? "bg-muted text-foreground"}`}>
                    <span>{EMPLOYMENT_TYPE_LABELS[d.type] ?? d.type}</span>
                    <span className="font-bold">{d.cnt}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Employees */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <UserPlus className="w-4 h-4 text-muted-foreground" />
              {isAr ? "أحدث الموظفين" : "Recently Added Employees"}
            </CardTitle>
            <Link href="/hr/employees">
              <button className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors">
                {isAr ? "عرض الكل" : "View all"} <ChevronRight className="w-3 h-3" />
              </button>
            </Link>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
            ) : !data?.recentEmployees?.length ? (
              <div className="text-center py-10 text-muted-foreground">
                <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">{isAr ? "لم يُضف موظفون بعد" : "No employees added yet"}</p>
                {isAdmin && (
                  <Link href="/hr/employees">
                    <button className="mt-3 text-xs text-primary hover:underline">{isAr ? "إضافة موظف" : "Add an employee"}</button>
                  </Link>
                )}
              </div>
            ) : (
              <div className="divide-y divide-border">
                {(data.recentEmployees as any[]).map((emp) => (
                  <Link key={emp.id} href={`/hr/employees/${emp.id}`}>
                    <div className="flex items-center gap-3 py-3 hover:bg-accent/50 rounded-md px-2 -mx-2 transition-colors cursor-pointer">
                      <img
                        src={emp.avatarUrl || `https://api.dicebear.com/7.x/initials/svg?seed=${emp.fullName}`}
                        alt={emp.fullName}
                        className="w-9 h-9 rounded-full shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{emp.fullName}</p>
                        <p className="text-xs text-muted-foreground truncate">{emp.position ?? (isAr ? "غير محدد" : "No position")} · {emp.departmentName ?? (isAr ? "غير محدد" : "Unassigned")}</p>
                      </div>
                      {emp.hireDate && (
                        <span className="text-xs text-muted-foreground shrink-0">{emp.hireDate}</span>
                      )}
                      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
