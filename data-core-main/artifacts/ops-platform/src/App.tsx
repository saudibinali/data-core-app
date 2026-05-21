import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { KeyRound, X, Hash, Lock, Eye, EyeOff, ShieldOff } from "lucide-react";
import { usePermissions } from "@/hooks/use-permissions";
import { Switch, Route, useLocation, Router as WouterRouter, Redirect, Link } from 'wouter';
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useListModules } from "@workspace/api-client-react";
import { useRealtime } from "@/hooks/use-realtime";
import { AuthProvider, useAppAuth } from "@/lib/auth";
import { PlatformBrandingHead } from "@/components/platform-branding-head";
import SetupPage from "@/pages/setup";
import SetupDatabasePage from "@/pages/setup-database";
import AppLayout from "@/components/layout/app-layout";
import { WorkspaceAccessProvider } from "@/lib/workspace-access-context";
import { WorkspaceReadOnlyBanner } from "@/components/workspace/WorkspaceReadOnlyBanner";
import SuperAdminLayout from "@/components/layout/super-admin-layout";
import DccHomePage from "@/pages/dcc-home";
import AboutPlatformPage from "@/pages/about-platform";
import ContactPage from "@/pages/contact";
import { PublicAuthNav } from "@/components/layout/public-auth-nav";
import { PublicLocaleProvider } from "@/lib/public-locale";
import { usePublicLocale } from "@/lib/public-locale/context";
import DashboardPage from "@/pages/dashboard";
import HomePage from "@/pages/home";
import TicketsPage from "@/pages/tickets";
import NewTicketPage from "@/pages/tickets-new";
import TicketDetailPage from "@/pages/tickets-detail";
import DepartmentsPage from "@/pages/departments";
import GroupsPage from "@/pages/groups";
import MessagesPage from "@/pages/messages";
import UsersPage from "@/pages/users";
import NotificationsPage from "@/pages/notifications";
import SettingsPage from "@/pages/settings";
import SuperAdminOverview from "@/pages/super-admin-overview";
import SuperAdminWorkspaces from "@/pages/super-admin-workspaces";
import SuperAdminWorkspaceNew from "@/pages/super-admin-workspace-new";
import SuperAdminWorkspaceDetail from "@/pages/super-admin-workspace-detail";
import SuperAdminActivity from "@/pages/super-admin-activity";
import SuperAdminEvents from "@/pages/super-admin-events";
import SuperAdminSettings from "@/pages/super-admin-settings";
import SuperAdminGovernance from "@/pages/super-admin-governance";
import SuperAdminGovernanceAudit from "@/pages/super-admin-governance-audit";
import SuperAdminGovernanceViolations from "@/pages/super-admin-governance-violations";
import SuperAdminGovernanceWorkflows from "@/pages/super-admin-governance-workflows";
import SuperAdminGovernanceAnalytics from "@/pages/super-admin-governance-analytics";
import SuperAdminGovernanceTopology from "@/pages/super-admin-governance-topology";
import SuperAdminGovernanceReadiness from "@/pages/super-admin-governance-readiness";
import SuperAdminGovernanceEvidence from "@/pages/super-admin-governance-evidence";
import SuperAdminTenants from "@/pages/super-admin-tenants";
import SuperAdminCommercialRisk from "@/pages/super-admin-commercial-risk";
import SuperAdminPlatformUsers from "@/pages/super-admin-platform-users";
import SuperAdminPlatformOps from "@/pages/super-admin-platform-ops";
import SuperAdminAccount from "@/pages/super-admin-account";
import SuperAdminAccessReview from "@/pages/super-admin-access-review";
import PlatformActivatePage from "@/pages/platform-activate";
import CalendarPage from "@/pages/calendar";
import RolesPage from "@/pages/roles";
import WorkflowsPage from "@/pages/workflows";
import WorkflowDetailPage from "@/pages/workflow-detail";
import GovernanceDashboard from "@/pages/governance-dashboard";
import GovernanceHistoryPage from "@/pages/governance-history";
import FormsPage from "@/pages/forms";
import FormsSubmitPage from "@/pages/forms-submit";
import AdminFormsPage from "@/pages/admin-forms";
import AdminFormsNewPage from "@/pages/admin-forms-new";
import AdminFormsDetailPage from "@/pages/admin-forms-detail";
import HrDashboardPage from "@/pages/hr-dashboard";
import HrEmployeesPage from "@/pages/hr-employees";
import HrEmployeeNewPage from "@/pages/hr-employee-new";
import HrEmployeeDetailPage from "@/pages/hr-employee-detail";
import HrServicesPage from "@/pages/hr-services";
import HrServicesAdminPage from "@/pages/hr-services-admin";
import HrServicesAdminNewPage from "@/pages/hr-services-admin-new";
import HrFoundationPage from "@/pages/hr-foundation";
import HrPayrollPage from "@/pages/hr-payroll";
import HrPayrollRunPage from "@/pages/hr-payroll-run";
import HrAttendancePage from "@/pages/hr-attendance";
import HrWorkforceOpsPage from "@/pages/hr-workforce-ops";
import WorkspaceIntegrationsPage from "@/pages/workspace-integrations";
import HrPayrollOpsPage from "@/pages/hr-payroll-ops";
import PlatformStabilizationPage from "@/pages/platform-stabilization";
import ReportCenterPage from "@/pages/report-center";
import HrMePayslipsPage from "@/pages/hr-me-payslips";
import HrMeLeavePage from "@/pages/hr-me-leave";
import HrMeAttendancePage from "@/pages/hr-me-attendance";
import SelfServicePage from "@/pages/self-service";
import SubscriptionStatusPage from "@/pages/subscription-status";
import { usePlatformBranding } from "@/hooks/use-platform-branding";
import {
  DEFAULT_LOGO,
  resolveBrandingAssetUrl,
} from "@/lib/platform-branding";
import NotFound from "@/pages/not-found";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Shared UI helpers ─────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background">
      <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function LanguageToggle() {
  const { i18n } = useTranslation();
  const isAr = i18n.language.startsWith("ar");
  return (
    <button
      onClick={() => i18n.changeLanguage(isAr ? "en" : "ar")}
      className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200 transition-colors px-3 py-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800"
    >
      <Globe className="w-4 h-4" />
      <span>{isAr ? "EN" : "ع"}</span>
    </button>
  );
}

// ── Sign-in form ──────────────────────────────────────────────────────────────

function EmployeeSignInForm() {
  const auth = useAppAuth();
  const { t } = useTranslation();
  const { data: branding } = usePlatformBranding();
  const [, setLocation] = useLocation();
  const [employeeNumber, setEmployeeNumber] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const userData = await auth.signIn(employeeNumber.trim(), password);
      setLocation(userData.role === "super_admin" ? "/super-admin" : "/home");
    } catch (err: any) {
      setError(err.message || t("sign_in_error"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      dir="ltr"
      lang="en"
      className="bg-white dark:bg-zinc-950 rounded-2xl w-[420px] max-w-full overflow-hidden shadow-xl border border-zinc-200 dark:border-zinc-800"
    >
      <div className="px-8 pt-10 pb-7 flex flex-col items-center gap-4 border-b border-zinc-100 dark:border-zinc-800">
        {(resolveBrandingAssetUrl(branding?.logoUrl) || DEFAULT_LOGO) && (
          <img
            src={resolveBrandingAssetUrl(branding?.logoUrl) || DEFAULT_LOGO}
            alt={branding?.platformName ?? "Logo"}
            className="h-auto min-h-[72px] max-h-28 w-auto max-w-[min(320px,calc(100vw-4rem))] object-contain"
            data-testid="sign-in-platform-logo"
            onError={(e) => {
              const img = e.currentTarget;
              if (img.src !== `${window.location.origin}${DEFAULT_LOGO}`) {
                img.src = `${window.location.origin}${DEFAULT_LOGO}`;
              } else {
                img.style.display = "none";
              }
            }}
          />
        )}
        <div className="text-center">
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
            {branding?.platformName || t("sign_in_title")}
          </h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {branding?.tagline || t("sign_in_subtitle")}
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="px-8 py-6 space-y-4">
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {t("sign_in_emp_number_label")}
          </label>
          <div className="relative">
            <Hash className="absolute top-1/2 -translate-y-1/2 start-3 w-4 h-4 text-zinc-400 pointer-events-none" />
            <input
              type="text"
              value={employeeNumber}
              onChange={(e) => setEmployeeNumber(e.target.value)}
              placeholder={t("sign_in_emp_number_placeholder")}
              autoComplete="username"
              autoFocus
              required
              disabled={loading}
              className="w-full ps-9 pe-3 py-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition disabled:opacity-60"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {t("sign_in_password_label")}
          </label>
          <div className="relative">
            <Lock className="absolute top-1/2 -translate-y-1/2 start-3 w-4 h-4 text-zinc-400 pointer-events-none" />
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("sign_in_password_placeholder")}
              autoComplete="current-password"
              required
              disabled={loading}
              className="w-full ps-9 pe-10 py-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition disabled:opacity-60"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute top-1/2 -translate-y-1/2 end-3 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition"
              tabIndex={-1}
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-3.5 py-2.5 text-sm text-red-700 dark:text-red-400">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading || !employeeNumber.trim() || !password}
          className="w-full py-2.5 px-4 bg-primary text-primary-foreground rounded-lg font-medium text-sm hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          {loading ? t("signing_in") : t("sign_in_button")}
        </button>
      </form>

      <div className="px-8 pb-6 text-center space-y-2">
        <p className="text-xs text-zinc-400 dark:text-zinc-500">
          Contact your system administrator if you need login assistance.
        </p>
        <Link
          href="/dcc-home"
          className="text-xs font-medium text-primary hover:underline inline-flex items-center gap-1"
        >
          ← Back to Data Core Center home
        </Link>
      </div>
    </div>
  );
}

function SignInPage() {
  const auth = useAppAuth();
  const [, setLocation] = useLocation();
  const { locale, dir } = usePublicLocale();

  useEffect(() => {
    if (auth.isLoaded && auth.isSignedIn) {
      setLocation(auth.user?.role === "super_admin" ? "/super-admin" : "/home");
    }
  }, [auth.isLoaded, auth.isSignedIn, auth.user?.role, setLocation]);

  return (
    <div className="flex min-h-[100dvh] flex-col bg-zinc-50 dark:bg-zinc-900" lang={locale} dir={dir}>
      <PublicAuthNav variant="sign-in" />
      <div className="flex flex-1 flex-col items-center justify-center px-4 pb-16">
        <EmployeeSignInForm />
      </div>
    </div>
  );
}

// ── No workspace ──────────────────────────────────────────────────────────────

function NoWorkspacePage() {
  const { signOut } = useAppAuth();
  const { t } = useTranslation();
  return (
    <div className="flex min-h-[100dvh] flex-col bg-zinc-50 dark:bg-zinc-900">
      <div className="flex items-center justify-end px-6 py-4">
        <LanguageToggle />
      </div>
      <div className="flex flex-1 flex-col items-center justify-center px-4 gap-4 text-center pb-16">
        <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center mb-2">
          <svg className="w-6 h-6 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">{t("no_workspace_title")}</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-xs">{t("no_workspace_desc")}</p>
        <button
          onClick={() => signOut()}
          className="mt-2 text-sm text-zinc-600 dark:text-zinc-400 underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
        >
          {t("sign_out")}
        </button>
      </div>
    </div>
  );
}

// ── Access denied + permissions ───────────────────────────────────────────────

function AccessDenied() {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center p-8">
      <div className="w-16 h-16 rounded-full bg-red-50 dark:bg-red-950/30 flex items-center justify-center">
        <ShieldOff className="w-8 h-8 text-red-500 dark:text-red-400" />
      </div>
      <div>
        <h1 className="text-xl font-bold mb-1">{t("access_denied")}</h1>
        <p className="text-sm text-muted-foreground max-w-sm">{t("access_denied_desc")}</p>
      </div>
      <button
        onClick={() => setLocation("/home")}
        className="px-4 py-2 rounded-md border border-border text-sm font-medium hover:bg-accent transition-colors"
      >
        {t("go_home")}
      </button>
    </div>
  );
}

function PermissionGate({ permission, children }: { permission?: string; children: React.ReactNode }) {
  const { hasPermission, userRole } = usePermissions();
  if (!userRole) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (permission && !hasPermission(permission)) return <AccessDenied />;
  return <>{children}</>;
}

// ── Must-reset-password banner ────────────────────────────────────────────────

function MustResetPasswordBanner({ accountPath = "/settings" }: { accountPath?: string }) {
  const [dismissed, setDismissed] = useState(false);
  const [, setLocation] = useLocation();
  if (dismissed) return null;
  const label = accountPath === "/super-admin/account" ? "My Account" : "Settings";
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-sm">
      <div className="flex items-center gap-2">
        <KeyRound className="w-4 h-4 shrink-0" />
        <span>
          You are required to change your password before continuing. Go to{" "}
          <button onClick={() => setLocation(accountPath)} className="underline font-medium hover:text-amber-900 dark:hover:text-amber-200">
            {label}
          </button>{" "}
          to update it.
        </span>
      </div>
      <button onClick={() => setDismissed(true)} className="shrink-0 hover:text-amber-900 dark:hover:text-amber-200">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

// ── Realtime ──────────────────────────────────────────────────────────────────

function RealtimeUpdates() {
  useRealtime();
  return null;
}

// ── Route guards ──────────────────────────────────────────────────────────────

function HomeRedirect() {
  const auth = useAppAuth();

  if (!auth.isLoaded) return <Spinner />;
  if (!auth.isSignedIn) return <Redirect to="/dcc-home" />;
  return <Redirect to={auth.user?.role === "super_admin" ? "/super-admin" : "/home"} />;
}

function ProtectedRoute({
  component: Component,
  fullWidth,
  requiredRoles,
  requiredPermission,
  moduleKey,
}: {
  component: React.ComponentType<any>;
  fullWidth?: boolean;
  requiredRoles?: string[];
  requiredPermission?: string;
  moduleKey?: string;
}) {
  const auth = useAppAuth();
  const { data: modules } = useListModules();

  if (!auth.isLoaded) return <Spinner />;
  if (!auth.isSignedIn) return <Redirect to="/sign-in" />;

  const role = auth.user?.role ?? "";

  if (role === "super_admin") return <Redirect to="/super-admin" />;

  if (!auth.user?.workspaceId) return <NoWorkspacePage />;

  if (requiredRoles && !requiredRoles.includes(role)) return <Redirect to="/home" />;

  if (moduleKey) {
    const mod = (modules ?? []).find((m) => m.key === moduleKey);
    if (mod && !mod.enabled) return <Redirect to="/home" />;
  }

  return (
    <WorkspaceAccessProvider>
      <AppLayout
        banner={
          <div className="shrink-0 flex flex-col">
            {auth.user.mustResetPassword ? <MustResetPasswordBanner /> : null}
            <WorkspaceReadOnlyBanner />
          </div>
        }
        fullWidth={fullWidth}
      >
        <PermissionGate permission={requiredPermission}>
          <Component />
        </PermissionGate>
      </AppLayout>
    </WorkspaceAccessProvider>
  );
}

function SuperAdminRoute({ component: Component }: { component: React.ComponentType<any> }) {
  const auth = useAppAuth();

  if (!auth.isLoaded) return <Spinner />;
  if (!auth.isSignedIn) return <Redirect to="/sign-in" />;
  if (auth.user?.role !== "super_admin") return <Redirect to="/sign-in" />;

  return (
    <SuperAdminLayout
      banner={auth.user.mustResetPassword ? <MustResetPasswordBanner accountPath="/super-admin/account" /> : null}
    >
      <Component />
    </SuperAdminLayout>
  );
}

// ── Database-not-configured screen ───────────────────────────────────────────

function DatabaseNotConfigured() {
  const isDev = import.meta.env.DEV;
  return (
    <div className="flex min-h-[100dvh] flex-col bg-zinc-50 dark:bg-zinc-900">
      <div className="flex items-center justify-end px-6 py-4">
        <LanguageToggle />
      </div>
      <div className="flex flex-1 flex-col items-center justify-center px-4 pb-16">
        <div className="w-full max-w-[520px] space-y-6">
          {/* Icon + heading */}
          <div className="text-center space-y-3">
            <div className="inline-flex w-16 h-16 rounded-full bg-amber-100 dark:bg-amber-900/30 items-center justify-center">
              <svg className="w-8 h-8 text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Database not configured</h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-sm mx-auto">
              The server started but has no database connection. Set <code className="px-1.5 py-0.5 rounded bg-zinc-200 dark:bg-zinc-800 text-xs font-mono text-zinc-800 dark:text-zinc-200">DATABASE_URL</code> and restart.
            </p>
          </div>

          {/* Instructions card */}
          <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-zinc-100 dark:border-zinc-800">
              <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                {isDev ? "Development setup" : "Production setup"}
              </h2>
            </div>
            <div className="px-6 py-5 space-y-4 text-sm">
              {isDev ? (
                <>
                  <p className="text-zinc-600 dark:text-zinc-400">
                    Create a <code className="px-1 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 font-mono text-xs">.env</code> file in the project root with your PostgreSQL connection string:
                  </p>
                  <pre className="rounded-lg bg-zinc-950 text-green-400 text-xs p-4 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
{`DATABASE_URL=postgresql://user:password@localhost:5432/ops_db`}
                  </pre>
                  <p className="text-zinc-500 dark:text-zinc-400">
                    Then restart the server. The database schema will be applied automatically.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-zinc-600 dark:text-zinc-400">
                    Set the following environment variable before starting the server:
                  </p>
                  <pre className="rounded-lg bg-zinc-950 text-green-400 text-xs p-4 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
{`DATABASE_URL=postgresql://user:password@host:5432/database`}
                  </pre>
                  <div className="space-y-2 text-zinc-500 dark:text-zinc-400">
                    <p>On Linux / Docker:</p>
                    <pre className="rounded-lg bg-zinc-100 dark:bg-zinc-800 text-xs p-3 font-mono overflow-x-auto">
{`export DATABASE_URL="postgresql://..." && node dist/index.mjs`}
                    </pre>
                    <p>In Docker Compose or Kubernetes, set it as an environment variable in your deployment config. Schema migrations run automatically on startup.</p>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Retry button */}
          <div className="text-center">
            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Retry after configuring
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Setup guard ───────────────────────────────────────────────────────────────

type SetupState = "checking" | "db-missing" | "needed" | "done";

function useSetupCheck() {
  const [state, setState] = useState<SetupState>("checking");

  useEffect(() => {
    fetch("/api/setup/status")
      .then((r) => r.json())
      .then((data: { initialized: boolean; databaseReady?: boolean }) => {
        if (data.databaseReady === false) {
          setState("db-missing");
        } else {
          setState(data.initialized ? "done" : "needed");
        }
      })
      .catch(() => setState("done")); // fail open - let normal auth handle it
  }, []);

  return {
    isChecking:  state === "checking",
    dbMissing:   state === "db-missing",
    setupNeeded: state === "needed",
    markDbReady: () => setState("needed"),
    markDone:    () => setState("done"),
  };
}

// ── App root ──────────────────────────────────────────────────────────────────

function AppRoutes() {
  const { isChecking, dbMissing, setupNeeded, markDbReady, markDone } = useSetupCheck();

  if (isChecking) return <Spinner />;

  if (dbMissing) return <SetupDatabasePage onComplete={markDbReady} />;

  if (setupNeeded) {
    return <SetupPage onInitialized={markDone} />;
  }

  return (
    <>
      <RealtimeUpdates />
      <Switch>
        <Route path="/setup">{() => <Redirect to="/sign-in" />}</Route>
        <Route path="/">{() => <HomeRedirect />}</Route>
        <Route path="/dcc-home">{() => <DccHomePage />}</Route>
        <Route path="/about-platform">{() => <AboutPlatformPage />}</Route>
        <Route path="/contact">{() => <ContactPage />}</Route>
        <Route path="/landing">{() => <Redirect to="/dcc-home" />}</Route>
        <Route path="/sign-in/*?">{() => <SignInPage />}</Route>
        <Route path="/platform/activate">{() => <PlatformActivatePage />}</Route>

        {/* Super Admin Panel */}
        <Route path="/super-admin">{() => <SuperAdminRoute component={SuperAdminOverview} />}</Route>
        <Route path="/super-admin/workspaces">{() => <SuperAdminRoute component={SuperAdminWorkspaces} />}</Route>
        <Route path="/super-admin/workspaces/new">{() => <SuperAdminRoute component={SuperAdminWorkspaceNew} />}</Route>
        <Route path="/super-admin/workspaces/:id">{() => <SuperAdminRoute component={SuperAdminWorkspaceDetail} />}</Route>
        <Route path="/super-admin/tenants">{() => <SuperAdminRoute component={SuperAdminTenants} />}</Route>
        <Route path="/super-admin/commercial-risk">{() => <SuperAdminRoute component={SuperAdminCommercialRisk} />}</Route>
        <Route path="/super-admin/platform-users">{() => <SuperAdminRoute component={SuperAdminPlatformUsers} />}</Route>
        <Route path="/super-admin/platform-ops">{() => <SuperAdminRoute component={SuperAdminPlatformOps} />}</Route>
        <Route path="/super-admin/access-review">{() => <SuperAdminRoute component={SuperAdminAccessReview} />}</Route>
        <Route path="/super-admin/activity">{() => <SuperAdminRoute component={SuperAdminActivity} />}</Route>
        <Route path="/super-admin/events">{() => <SuperAdminRoute component={SuperAdminEvents} />}</Route>
        <Route path="/super-admin/settings">{() => <SuperAdminRoute component={SuperAdminSettings} />}</Route>
        <Route path="/super-admin/account">{() => <SuperAdminRoute component={SuperAdminAccount} />}</Route>

        {/* Governance Console - super_admin only, read-only review area */}
        <Route path="/super-admin/governance/audit-integrity">{() => <SuperAdminRoute component={SuperAdminGovernanceAudit} />}</Route>
        <Route path="/super-admin/governance/violations">{() => <SuperAdminRoute component={SuperAdminGovernanceViolations} />}</Route>
        <Route path="/super-admin/governance/workflows">{() => <SuperAdminRoute component={SuperAdminGovernanceWorkflows} />}</Route>
        <Route path="/super-admin/governance/analytics">{() => <SuperAdminRoute component={SuperAdminGovernanceAnalytics} />}</Route>
        <Route path="/super-admin/governance/topology">{() => <SuperAdminRoute component={SuperAdminGovernanceTopology} />}</Route>
        <Route path="/super-admin/governance/readiness">{() => <SuperAdminRoute component={SuperAdminGovernanceReadiness} />}</Route>
        <Route path="/super-admin/governance/evidence-packages">{() => <SuperAdminRoute component={SuperAdminGovernanceEvidence} />}</Route>
        <Route path="/super-admin/governance">{() => <SuperAdminRoute component={SuperAdminGovernance} />}</Route>

        {/* Workspace Routes */}
        <Route path="/home">{() => <ProtectedRoute component={HomePage} moduleKey="home" />}</Route>
        <Route path="/dashboard">{() => <ProtectedRoute component={DashboardPage} requiredPermission="dashboard.view" moduleKey="dashboard" />}</Route>
        <Route path="/tickets">{() => <ProtectedRoute component={TicketsPage} requiredPermission="tickets.view" moduleKey="tickets" />}</Route>
        <Route path="/tickets/new">{() => <ProtectedRoute component={NewTicketPage} requiredPermission="tickets.create" moduleKey="tickets" />}</Route>
        <Route path="/tickets/:id">{() => <ProtectedRoute component={TicketDetailPage} requiredPermission="tickets.view" moduleKey="tickets" />}</Route>
        <Route path="/departments">{() => <ProtectedRoute component={DepartmentsPage} requiredPermission="departments.view" moduleKey="departments" />}</Route>
        <Route path="/groups">{() => <ProtectedRoute component={GroupsPage} requiredPermission="groups.view" moduleKey="groups" />}</Route>
        <Route path="/messages">{() => <ProtectedRoute component={MessagesPage} fullWidth requiredPermission="messages.view" moduleKey="messages" />}</Route>
        <Route path="/users">{() => <ProtectedRoute component={UsersPage} requiredPermission="users.view" moduleKey="users" />}</Route>
        <Route path="/notifications">{() => <ProtectedRoute component={NotificationsPage} requiredPermission="notifications.view" moduleKey="notifications" />}</Route>
        <Route path="/approvals">{() => <Redirect to="/self-service" />}</Route>
        <Route path="/calendar">{() => <ProtectedRoute component={CalendarPage} requiredPermission="calendar.view" moduleKey="calendar" />}</Route>
        <Route path="/roles">{() => <ProtectedRoute component={RolesPage} requiredPermission="roles.view" moduleKey="roles" />}</Route>
        <Route path="/workflows">{() => <ProtectedRoute component={WorkflowsPage} requiredPermission="workflow.view" moduleKey="workflows" />}</Route>
        <Route path="/workflows/:id">{() => <ProtectedRoute component={WorkflowDetailPage} requiredPermission="workflow.view" moduleKey="workflows" />}</Route>
        <Route path="/governance/history">{() => <ProtectedRoute component={GovernanceHistoryPage} requiredRoles={["admin", "super_admin"]} />}</Route>
        <Route path="/governance">{() => <ProtectedRoute component={GovernanceDashboard} requiredRoles={["admin", "super_admin"]} />}</Route>
        <Route path="/forms">{() => <Redirect to="/self-service" />}</Route>
        <Route path="/forms/:id">{() => <Redirect to="/self-service" />}</Route>
        <Route path="/admin/forms">{() => <ProtectedRoute component={AdminFormsPage} requiredRoles={["admin"]} moduleKey="hr" />}</Route>
        <Route path="/admin/forms/new">{() => <ProtectedRoute component={AdminFormsNewPage} requiredRoles={["admin"]} moduleKey="hr" />}</Route>
        <Route path="/admin/forms/:id">{() => <ProtectedRoute component={AdminFormsDetailPage} requiredRoles={["admin"]} moduleKey="hr" />}</Route>
        <Route path="/admin/hr/forms">{() => <ProtectedRoute component={AdminFormsPage} requiredRoles={["admin"]} moduleKey="hr" />}</Route>
        <Route path="/admin/hr/forms/new">{() => <ProtectedRoute component={AdminFormsNewPage} requiredRoles={["admin"]} moduleKey="hr" />}</Route>
        <Route path="/admin/hr/forms/:id">{() => <ProtectedRoute component={AdminFormsDetailPage} requiredRoles={["admin"]} moduleKey="hr" />}</Route>
        <Route path="/self-service">{() => <ProtectedRoute component={SelfServicePage} requiredPermission="self_service.view" moduleKey="self-service" />}</Route>
        <Route path="/subscription/status">{() => <ProtectedRoute component={SubscriptionStatusPage} requiredPermission="tenant.subscription.read" moduleKey="subscription" />}</Route>
        <Route path="/billing/invoices">{() => <Redirect to="/subscription/status" />}</Route>
        <Route path="/hr">{() => <ProtectedRoute component={HrDashboardPage} requiredPermission="hr.manage" moduleKey="hr" />}</Route>
        <Route path="/hr/reports">{() => <ProtectedRoute component={ReportCenterPage} requiredPermission="hr.manage" moduleKey="report-center" />}</Route>
        <Route path="/hr/employees">{() => <ProtectedRoute component={HrEmployeesPage} requiredPermission="hr.manage" moduleKey="hr" />}</Route>
        <Route path="/hr/employees/new">{() => <ProtectedRoute component={HrEmployeeNewPage} requiredRoles={["admin", "manager"]} moduleKey="hr" />}</Route>
        <Route path="/hr/employees/:id">{() => <ProtectedRoute component={HrEmployeeDetailPage} requiredPermission="hr.manage" moduleKey="hr" />}</Route>
        <Route path="/hr/services">{() => <ProtectedRoute component={HrServicesPage} requiredPermission="hr.manage" moduleKey="hr" />}</Route>
        <Route path="/admin/hr/services">{() => <ProtectedRoute component={HrServicesAdminPage} requiredRoles={["admin", "manager"]} moduleKey="hr" />}</Route>
        <Route path="/admin/hr/services/new">{() => <ProtectedRoute component={HrServicesAdminNewPage} requiredRoles={["admin", "manager"]} moduleKey="hr" />}</Route>
        <Route path="/admin/hr/services/:id">{() => <ProtectedRoute component={HrServicesAdminNewPage} requiredRoles={["admin", "manager"]} moduleKey="hr" />}</Route>
        <Route path="/admin/hr/foundation">{() => <ProtectedRoute component={HrFoundationPage} requiredRoles={["admin", "manager"]} moduleKey="hr" />}</Route>
        <Route path="/admin/hr/payroll">{() => <ProtectedRoute component={HrPayrollPage} requiredPermission="hr.payroll.admin" moduleKey="payroll" />}</Route>
        <Route path="/admin/hr/payroll/runs/:id">{() => <ProtectedRoute component={HrPayrollRunPage} requiredPermission="hr.payroll.admin" moduleKey="payroll" />}</Route>
        <Route path="/admin/hr/attendance">{() => <ProtectedRoute component={HrAttendancePage} requiredPermission="hr.manage" moduleKey="attendance" />}</Route>
        <Route path="/admin/hr/workforce-ops">{() => <ProtectedRoute component={HrWorkforceOpsPage} requiredPermission="hr.manage" moduleKey="hr" />}</Route>
        <Route path="/admin/integrations">{() => <ProtectedRoute component={WorkspaceIntegrationsPage} requiredPermission="hr.manage" moduleKey="hr" />}</Route>
        <Route path="/admin/hr/payroll-ops">{() => <ProtectedRoute component={HrPayrollOpsPage} requiredPermission="hr.manage" moduleKey="hr" />}</Route>
        <Route path="/admin/platform/stabilization">{() => <ProtectedRoute component={PlatformStabilizationPage} requiredPermission="hr.manage" moduleKey="hr" />}</Route>
        <Route path="/self-service/payslips">{() => <ProtectedRoute component={HrMePayslipsPage} requiredPermission="self_service.view" moduleKey="self-service" />}</Route>
        <Route path="/self-service/leave">{() => <ProtectedRoute component={HrMeLeavePage} requiredPermission="self_service.view" moduleKey="self-service" />}</Route>
        <Route path="/self-service/attendance">{() => <ProtectedRoute component={HrMeAttendancePage} requiredPermission="self_service.view" moduleKey="self-service" />}</Route>
        <Route path="/settings">{() => <ProtectedRoute component={SettingsPage} />}</Route>
        <Route component={NotFound} />
      </Switch>
    </>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <PlatformBrandingHead />
      <AuthProvider>
        <PublicLocaleProvider>
          <TooltipProvider>
            <WouterRouter base={basePath}>
              <AppRoutes />
            </WouterRouter>
            <Toaster />
          </TooltipProvider>
        </PublicLocaleProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
