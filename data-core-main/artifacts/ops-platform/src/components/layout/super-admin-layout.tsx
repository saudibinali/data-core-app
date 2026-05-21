import React, { useState } from "react";
import { Link, useLocation } from "wouter";
import { useAppAuth } from "@/lib/auth";
import { useTheme } from "@/components/theme-provider";
import {
  LayoutDashboard,
  Building2,
  Settings,
  LogOut,
  Moon,
  Sun,
  ShieldCheck,
  ShieldAlert,
  Activity,
  Zap,
  ChevronRight,
  ChevronDown,
  LinkIcon,
  AlertTriangle,
  GitBranch,
  BarChart3,
  Network,
  Package,
  Database,
  Users,
  ClipboardCheck,
  Radar,
  MoreHorizontal,
} from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import {
  canViewPlatformNavItem,
  type PlatformNavItemKey,
} from "@/lib/platform-access";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface NavItem {
  href: string;
  icon: React.ElementType;
  label: string;
  exact?: boolean;
  navKey: PlatformNavItemKey;
}

const primaryNavItems: NavItem[] = [
  { href: "/super-admin", icon: LayoutDashboard, label: "Dashboard", exact: true, navKey: "overview" },
  { href: "/super-admin/tenants", icon: Database, label: "Tenants", navKey: "tenant-registry" },
  { href: "/super-admin/commercial-risk", icon: ShieldAlert, label: "Commercial", navKey: "commercial-risk" },
  { href: "/super-admin/platform-users", icon: Users, label: "Platform Users", navKey: "platform-users" },
  { href: "/super-admin/platform-ops", icon: Radar, label: "Platform Ops", navKey: "platform-ops" },
  { href: "/super-admin/access-review", icon: ClipboardCheck, label: "Access Review", navKey: "access-review" },
];

const moreNavItems: NavItem[] = [
  { href: "/super-admin/workspaces", icon: Building2, label: "Workspaces", navKey: "workspaces" },
  { href: "/super-admin/activity", icon: Activity, label: "Platform Activity", navKey: "platform-activity" },
  { href: "/super-admin/events", icon: Zap, label: "Audit / Event Log", navKey: "event-log" },
  { href: "/super-admin/settings", icon: Settings, label: "Platform Settings", navKey: "platform-settings" },
];

const governanceNavItems = [
  { href: "/super-admin/governance", icon: ShieldCheck, label: "Overview", exact: true },
  { href: "/super-admin/governance/audit-integrity", icon: LinkIcon, label: "Audit Integrity" },
  { href: "/super-admin/governance/violations", icon: AlertTriangle, label: "Policy Violations" },
  { href: "/super-admin/governance/workflows", icon: GitBranch, label: "Workflows" },
  { href: "/super-admin/governance/analytics", icon: BarChart3, label: "Analytics" },
  { href: "/super-admin/governance/topology", icon: Network, label: "Topology & Readiness" },
  { href: "/super-admin/governance/evidence-packages", icon: Package, label: "Evidence Packages" },
];

function NavLink({ item }: { item: NavItem }) {
  const [location] = useLocation();
  const isActive = item.exact ? location === item.href : location.startsWith(item.href);
  return (
    <Link
      href={item.href}
      data-testid={`nav-${item.navKey}`}
      className={cn(
        "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
        isActive
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground",
      )}
    >
      <item.icon className="w-4 h-4" />
      <span className="flex-1">{item.label}</span>
      {isActive && <ChevronRight className="w-3 h-3 opacity-50" />}
    </Link>
  );
}

export default function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { signOut, user: authUser } = useAppAuth();
  const { theme, setTheme } = useTheme();
  const [moreOpen, setMoreOpen] = useState(false);

  const toggleTheme = () => setTheme(theme === "dark" ? "light" : "dark");

  const visiblePrimary = primaryNavItems.filter((item) => canViewPlatformNavItem(authUser ?? {}, item.navKey));
  const visibleMore = moreNavItems.filter((item) => canViewPlatformNavItem(authUser ?? {}, item.navKey));
  const moreActive = visibleMore.some((item) =>
    item.exact ? location === item.href : location.startsWith(item.href),
  );

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <aside className="w-64 border-r border-border bg-sidebar flex flex-col h-full">
        <div className="h-14 flex items-center px-4 border-b border-border">
          <Link href="/super-admin" className="flex items-center gap-2 font-bold text-lg text-sidebar-primary">
            <div className="w-8 h-8 rounded bg-primary flex items-center justify-center">
              <ShieldCheck className="w-4 h-4 text-primary-foreground" />
            </div>
            <span>Platform Admin</span>
          </Link>
        </div>

        <div className="px-3 py-3 border-b border-border">
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
            <ShieldCheck className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
            <span className="text-xs font-medium text-amber-700 dark:text-amber-300">Platform Owner</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-3 flex flex-col gap-1 px-2">
          {visiblePrimary.map((item) => (
            <NavLink key={item.href} item={item} />
          ))}

          {visibleMore.length > 0 && (
            <div data-testid="nav-more-dropdown">
              <button
                type="button"
                onClick={() => setMoreOpen((o) => !o)}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                  moreActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent/50",
                )}
              >
                <MoreHorizontal className="w-4 h-4" />
                <span className="flex-1 text-left">More</span>
                <ChevronDown className={cn("w-3 h-3 transition-transform", moreOpen && "rotate-180")} />
              </button>
              {moreOpen && (
                <div className="ml-2 mt-0.5 flex flex-col gap-0.5 border-l border-border pl-2">
                  {visibleMore.map((item) => (
                    <NavLink key={item.href} item={item} />
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="mt-3 mb-1 px-3">
            <div className="flex items-center gap-2">
              <div className="flex-1 h-px bg-border" />
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest whitespace-nowrap">
                Governance
              </span>
              <div className="flex-1 h-px bg-border" />
            </div>
          </div>

          {governanceNavItems.map((item) => {
            const isActive = item.exact ? location === item.href : location.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                data-testid={`governance-nav-${item.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                className={cn(
                  "flex items-center gap-3 px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground",
                )}
              >
                <item.icon className="w-3.5 h-3.5" />
                <span className="flex-1 text-xs">{item.label}</span>
                {isActive && <ChevronRight className="w-3 h-3 opacity-50" />}
              </Link>
            );
          })}
        </div>

        <div className="mt-auto border-t border-border p-4 flex flex-col gap-2">
          <div className="flex items-center justify-between px-3 py-2">
            <button
              onClick={toggleTheme}
              className="p-1 rounded hover:bg-sidebar-accent text-sidebar-foreground transition-colors"
              title="Toggle theme"
            >
              {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>

          <div className="flex items-center gap-3 mt-2 px-2 py-2 rounded-md border border-border bg-card">
            <img
              src={authUser?.avatarUrl || `https://api.dicebear.com/7.x/initials/svg?seed=${authUser?.fullName || "Admin"}`}
              alt={authUser?.fullName || "Admin"}
              className="w-8 h-8 rounded-full"
            />
            <div className="flex-1 overflow-hidden">
              <p className="text-sm font-medium truncate">{authUser?.fullName || "Platform Owner"}</p>
              <p className="text-xs text-muted-foreground truncate">{authUser?.email ?? ""}</p>
            </div>
            <button
              onClick={() => signOut()}
              className="p-1.5 text-muted-foreground hover:text-foreground rounded-md hover:bg-accent transition-colors"
              title="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      <div className="flex flex-col flex-1 overflow-hidden">
        <header className="h-14 border-b border-border flex items-center px-6 bg-background shrink-0">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <ShieldCheck className="w-4 h-4 text-primary" />
            <span className="font-medium text-foreground">Platform Administration</span>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-6">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
