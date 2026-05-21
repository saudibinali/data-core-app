import type { ReactNode } from "react";
import { Link } from "wouter";
import { PublicAuthNav } from "@/components/layout/public-auth-nav";
import { usePublicEnglish } from "@/hooks/use-public-english";
import {
  Building2,
  Shield,
  Users,
  Workflow,
  LineChart,
  Cloud,
  Lock,
  Layers,
  ClipboardCheck,
  Globe,
  ChevronRight,
} from "lucide-react";

const LOGO_URL = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/official-logo.png`;

const CAPABILITIES = [
  {
    icon: Building2,
    title: "Multi-Tenant Operations",
    text: "Workspace-isolated environments with a platform control plane for tenants, entitlements, subscriptions, and commercial posture.",
  },
  {
    icon: Users,
    title: "Workforce & HR",
    text: "Employee lifecycle, foundation data, HR services, leave, provisioning, and structured organizational departments and groups.",
  },
  {
    icon: ClipboardCheck,
    title: "Attendance & Payroll",
    text: "Time capture, payroll periods, run approval, payslip distribution, and export pathways with segregation of duties.",
  },
  {
    icon: Workflow,
    title: "Process Automation",
    text: "Event-driven workflows, approvals, notifications, and operational tasks aligned with enterprise policy.",
  },
  {
    icon: Shield,
    title: "Governance & Audit",
    text: "Activity visibility, governance consoles, access review discipline, and protected platform ownership standards.",
  },
  {
    icon: Lock,
    title: "Security & Access",
    text: "Role and permission matrices, module enablement, JWT session validation, and fail-closed entitlement controls.",
  },
  {
    icon: LineChart,
    title: "Reporting & Insights",
    text: "Dashboards, HR exports, scheduled reports, and operational intelligence for administrators and platform operators.",
  },
  {
    icon: Cloud,
    title: "Cloud & Integration",
    text: "Contract-first APIs, OpenAPI-driven clients, import pipelines, and readiness for enterprise connectors.",
  },
];

const PILLARS = [
  {
    title: "Operational Philosophy",
    items: [
      "Access is granted—not assumed. No public self-registration.",
      "Permissions are explicit across workspace and platform planes.",
      "Commercial packaging is separate from payment processing.",
      "Module enablement respects HCM dependency integrity.",
    ],
  },
  {
    title: "Enterprise Architecture",
    items: [
      "API-centric, contract-first design with validated schemas.",
      "Workspace-scoped data with platform administration overlay.",
      "Event-driven workflows and real-time operational updates.",
      "Human capital nucleus with collaboration modules integrated.",
    ],
  },
  {
    title: "Long-Term Direction",
    items: [
      "Depth in workforce, attendance, and payroll operations.",
      "Mature platform control plane and entitlement execution.",
      "White-label branding and partner-ready identity surfaces.",
      "Responsive web today; native mobile as a phased extension.",
    ],
  },
];

function SectionTitle({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground scroll-mt-24">
      {children}
    </h2>
  );
}

export default function AboutPlatformPage() {
  usePublicEnglish();

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background" lang="en" dir="ltr">
      <PublicAuthNav variant="about" />

      {/* Hero */}
      <section
        className="relative overflow-hidden border-b border-white/10"
        style={{
          background: "linear-gradient(180deg, #000000 0%, #0a1628 45%, #0f2744 100%)",
        }}
      >
        <div
          className="absolute inset-0 opacity-30 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 80% 50% at 50% 0%, rgba(0, 123, 255, 0.35) 0%, transparent 70%)",
          }}
        />
        <div className="relative max-w-5xl mx-auto px-4 sm:px-6 lg:px-12 py-16 sm:py-24 text-center">
          <img
            src={LOGO_URL}
            alt="Data Core Center — official logo"
            className="mx-auto w-48 sm:w-64 md:w-80 h-auto object-contain drop-shadow-[0_8px_32px_rgba(0,123,255,0.35)]"
            width={320}
            height={320}
          />
          <p className="mt-8 text-xs font-semibold uppercase tracking-[0.35em] text-[#5ba3d0]">
            About Platform
          </p>
          <h1 className="mt-4 text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-white leading-tight">
            Enterprise Platform Overview
          </h1>
          <p className="mt-6 text-base sm:text-lg text-slate-300 max-w-3xl mx-auto leading-relaxed">
            Data Core Center is a multi-tenant operational system for workforce administration, human
            capital processes, and internal business operations—built for organizations that require
            strong governance, administrative clarity, and scalable tenancy.
          </p>
          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/sign-in"
              className="inline-flex h-11 w-full sm:w-auto items-center justify-center rounded-md px-8 text-sm font-semibold text-white transition-colors"
              style={{ background: "linear-gradient(90deg, #004080 0%, #007bff 100%)" }}
            >
              Authorized sign-in
              <ChevronRight className="w-4 h-4 ml-1" />
            </Link>
            <a
              href="#executive-summary"
              className="inline-flex h-11 w-full sm:w-auto items-center justify-center rounded-md border border-white/20 px-8 text-sm font-medium text-slate-200 hover:bg-white/5 transition-colors"
            >
              Read overview
            </a>
          </div>
        </div>
      </section>

      <main className="flex-1">
        {/* Quick nav */}
        <nav
          className="sticky top-14 sm:top-16 z-20 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80"
          aria-label="About sections"
        >
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-12 py-3 flex gap-4 overflow-x-auto text-sm whitespace-nowrap scrollbar-none">
            {[
              ["executive-summary", "Summary"],
              ["vision", "Vision"],
              ["capabilities", "Capabilities"],
              ["pillars", "Pillars"],
              ["security", "Security"],
              ["audiences", "Audiences"],
            ].map(([id, label]) => (
              <a
                key={id}
                href={`#${id}`}
                className="text-muted-foreground hover:text-primary font-medium transition-colors"
              >
                {label}
              </a>
            ))}
          </div>
        </nav>

        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-12 py-12 sm:py-16 space-y-16 sm:space-y-20">
          <section id="executive-summary" className="space-y-4">
            <SectionTitle id="executive-summary">Executive Summary</SectionTitle>
            <p className="text-muted-foreground leading-relaxed text-base sm:text-lg">
              Data Core Center unifies workspace operations and platform administration in one
              controlled environment. Customer organizations run day-to-day workforce and collaboration
              processes inside isolated workspaces. Platform operators govern tenants, entitlements,
              commercial records, and cross-tenant visibility without commingling tenant operational data.
            </p>
            <p className="text-muted-foreground leading-relaxed">
              The product is oriented toward sustained operational use: employee records, attendance and
              payroll cycles, approval chains, and audit-friendly administrative actions. Delivery is
              through a responsive web application with English and Arabic support, suitable for desktop
              and mobile browsers. Access is provisioned by administrators; the platform does not offer
              open public registration.
            </p>
          </section>

          <section id="vision" className="space-y-4">
            <SectionTitle id="vision">Platform Vision</SectionTitle>
            <p className="text-muted-foreground leading-relaxed">
              The vision is to provide a dependable operational core where administrative authority is
              explicit, tenant boundaries are respected, and processes can be standardized without losing
              workspace-level configurability. Data Core Center reduces fragmentation across HR,
              employee services, manager workflows, and platform operations—while preserving modular
              enablement aligned with contractual entitlements.
            </p>
            <div className="grid sm:grid-cols-2 gap-4 pt-2">
              <div className="rounded-lg border border-border bg-card p-5">
                <div className="flex items-center gap-2 text-primary font-semibold mb-2">
                  <Layers className="w-5 h-5" />
                  Workspace Plane
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  HR, attendance, payroll, tickets, messaging, calendars, approvals, workflows, and
                  employee self-service—governed by workspace roles and permissions.
                </p>
              </div>
              <div className="rounded-lg border border-border bg-card p-5">
                <div className="flex items-center gap-2 text-primary font-semibold mb-2">
                  <Globe className="w-5 h-5" />
                  Platform Plane
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Tenant registry, subscriptions, entitlements, quotas, commercial records, platform
                  users, governance consoles, and operational activity review.
                </p>
              </div>
            </div>
          </section>

          <section id="capabilities" className="space-y-6">
            <SectionTitle id="capabilities">Operational Capabilities</SectionTitle>
            <p className="text-muted-foreground leading-relaxed">
              The platform integrates human capital management with internal operations tooling under
              shared identity, permissions, and visibility models.
            </p>
            <div className="grid sm:grid-cols-2 gap-4">
              {CAPABILITIES.map((cap) => (
                <article
                  key={cap.title}
                  className="rounded-lg border border-border bg-card p-5 hover:border-primary/30 transition-colors"
                >
                  <cap.icon className="w-8 h-8 text-primary mb-3" />
                  <h3 className="font-semibold text-foreground">{cap.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{cap.text}</p>
                </article>
              ))}
            </div>
          </section>

          <section id="pillars" className="space-y-6">
            <SectionTitle id="pillars">Strategic Pillars</SectionTitle>
            <div className="space-y-6">
              {PILLARS.map((pillar) => (
                <div key={pillar.title} className="rounded-lg border border-border overflow-hidden">
                  <div className="px-5 py-3 bg-muted/50 border-b border-border">
                    <h3 className="font-semibold text-foreground">{pillar.title}</h3>
                  </div>
                  <ul className="px-5 py-4 space-y-2">
                    {pillar.items.map((item) => (
                      <li key={item} className="flex gap-2 text-sm text-muted-foreground leading-relaxed">
                        <span className="text-primary mt-1.5 shrink-0 w-1.5 h-1.5 rounded-full bg-primary" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>

          <section id="security" className="space-y-4">
            <SectionTitle id="security">Security, Privacy & Reliability</SectionTitle>
            <p className="text-muted-foreground leading-relaxed">
              Authentication uses industry-standard password protection and token validation on every
              protected request. Authorization combines workspace scope, role and permission checks,
              platform permission middleware, and domain-specific guards for sensitive areas such as
              payroll visibility. Configuration and entitlement flows fail closed when codes or fields
              are invalid.
            </p>
            <p className="text-muted-foreground leading-relaxed">
              Business continuity themes include health monitoring integration, read-only workspace
              enforcement during maintenance, structured workflow lifecycles, export and document
              retrieval for recovery verification, and real-time channels for operational consoles.
              Deploying organizations retain responsibility for environment hardening and regulatory
              compliance; the platform provides structural governance support.
            </p>
          </section>

          <section id="audiences" className="space-y-4">
            <SectionTitle id="audiences">Who This Platform Serves</SectionTitle>
            <p className="text-muted-foreground leading-relaxed">
              Data Core Center is designed for executive leadership, enterprise operations teams, HR and
              payroll administrators, platform operators managing multiple tenants, and strategic partners
              offering white-label or managed deployments. The presentation is commercially serious and
              technically credible—without reliance on unverifiable claims or generic marketing filler.
            </p>
            <div
              className="rounded-xl p-6 sm:p-8 text-center border border-primary/20"
              style={{
                background: "linear-gradient(135deg, rgba(0, 31, 63, 0.08) 0%, rgba(0, 123, 255, 0.06) 100%)",
              }}
            >
              <img
                src={LOGO_URL}
                alt=""
                aria-hidden
                className="mx-auto w-32 h-auto opacity-90 mb-4"
              />
              <p className="text-lg font-semibold text-foreground">Data Core Center</p>
              <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
                Operational maturity for workforce-centric enterprises at scale.
              </p>
              <Link
                href="/dcc-home"
                className="inline-flex mt-6 text-sm font-medium text-primary hover:underline"
              >
                ← Return to home
              </Link>
            </div>
          </section>
        </div>
      </main>

      <footer className="border-t border-border px-4 sm:px-6 lg:px-12 py-8 text-center text-xs text-muted-foreground">
        <p>Data Core Center — access restricted to authorized personnel.</p>
        <p className="mt-1">Accounts are provisioned by administrators.</p>
      </footer>
    </div>
  );
}
