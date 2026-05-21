import type { ReactNode } from "react";
import { Link } from "wouter";
import { PublicAuthNav } from "@/components/layout/public-auth-nav";
import { usePublicEnglish } from "@/hooks/use-public-english";
import {
  WORKSPACE_MODULES,
  HCM_DEPENDENCIES,
  WORKSPACE_ROLES,
  PLATFORM_ROLES,
  PLATFORM_CONSOLE_AREAS,
  HR_CAPABILITIES,
  CLIENT_OUTCOMES,
} from "@/lib/about-platform-content";
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
  Network,
  FileText,
  Smartphone,
  Settings,
  Ticket,
  Mail,
  CalendarDays,
  Bell,
  GitFork,
  Database,
  ConciergeBell,
  Clock,
  CreditCard,
  Palette,
  Plug,
  type LucideIcon,
} from "lucide-react";

const LOGO_URL = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/official-logo.png`;

const NAV_SECTIONS: { id: string; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "structure", label: "Structure" },
  { id: "tenancy", label: "Tenancy" },
  { id: "organization", label: "Organization" },
  { id: "hcm", label: "HCM" },
  { id: "self-service", label: "Self-Service" },
  { id: "attendance-payroll", label: "Time & Payroll" },
  { id: "collaboration", label: "Collaboration" },
  { id: "administration", label: "Administration" },
  { id: "security", label: "Security" },
  { id: "visibility", label: "Visibility" },
  { id: "workflows", label: "Workflows" },
  { id: "documents", label: "Documents" },
  { id: "branding", label: "Branding" },
  { id: "experience", label: "Experience" },
  { id: "saas", label: "SaaS" },
  { id: "integration", label: "Integration" },
  { id: "future", label: "Future" },
  { id: "modules", label: "Modules" },
  { id: "value", label: "Value" },
];

const HIGHLIGHTS: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: Layers,
    title: "Dual control planes",
    text: "Workspace operations for each customer organization, plus a platform layer for tenants, entitlements, and commercial administration.",
  },
  {
    icon: Users,
    title: "Integrated HCM",
    text: "Seventeen toggleable workspace modules including HR, payroll, attendance, self-service, and report center with enforced module dependencies.",
  },
  {
    icon: Shield,
    title: "Granular governance",
    text: "Workspace RBAC with custom roles, platform permission codes, protected root owner policy, and access review for platform users.",
  },
  {
    icon: Workflow,
    title: "Process automation",
    text: "Workflow builder, approval queues, notifications, and real-time updates for operational continuity.",
  },
];

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 space-y-5">
      <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground border-b border-border pb-3">
        {title}
      </h2>
      {children}
    </section>
  );
}

function SubTitle({ children }: { children: ReactNode }) {
  return <h3 className="text-lg font-semibold text-foreground mt-2">{children}</h3>;
}

function Prose({ children }: { children: ReactNode }) {
  return <p className="text-muted-foreground leading-relaxed text-base">{children}</p>;
}

function CardGrid({ children }: { children: ReactNode }) {
  return <div className="grid sm:grid-cols-2 gap-4">{children}</div>;
}

function FeatureCard({
  icon: Icon,
  title,
  children,
}: {
  icon?: LucideIcon;
  title: string;
  children: ReactNode;
}) {
  return (
    <article className="rounded-lg border border-border bg-card p-5 hover:border-primary/25 transition-colors h-full">
      {Icon ? <Icon className="w-7 h-7 text-primary mb-3" /> : null}
      <h4 className="font-semibold text-foreground">{title}</h4>
      <div className="mt-2 text-sm text-muted-foreground leading-relaxed">{children}</div>
    </article>
  );
}

function BulletList({ items }: { items: readonly string[] }) {
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item} className="flex gap-2.5 text-sm text-muted-foreground leading-relaxed">
          <span className="mt-2 shrink-0 w-1.5 h-1.5 rounded-full bg-primary" />
          {item}
        </li>
      ))}
    </ul>
  );
}

function ModuleList() {
  return (
    <div className="rounded-lg border border-border divide-y divide-border max-h-[420px] overflow-y-auto">
      {WORKSPACE_MODULES.map((m) => (
        <div key={m.name} className="px-4 py-3 hover:bg-muted/30 transition-colors">
          <p className="font-medium text-sm text-foreground">{m.name}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{m.desc}</p>
        </div>
      ))}
    </div>
  );
}

export default function AboutPlatformPage() {
  usePublicEnglish();

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background" lang="en" dir="ltr">
      <PublicAuthNav variant="about" />

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
        <div className="relative max-w-5xl mx-auto px-4 sm:px-6 lg:px-12 py-14 sm:py-20 text-center">
          <img
            src={LOGO_URL}
            alt="Data Core Center"
            className="mx-auto w-44 sm:w-56 md:w-72 h-auto object-contain drop-shadow-[0_8px_32px_rgba(0,123,255,0.35)]"
          />
          <p className="mt-6 text-xs font-semibold uppercase tracking-[0.35em] text-[#5ba3d0]">
            Enterprise Platform Overview
          </p>
          <h1 className="mt-3 text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-white leading-tight">
            Data Core Center
          </h1>
          <p className="mt-5 text-base sm:text-lg text-slate-300 max-w-3xl mx-auto leading-relaxed">
            A multi-tenant internal operations and human capital management platform. This overview
            describes implemented modules, administrative structures, and operational capabilities
            available in the product today.
          </p>
        </div>
      </section>

      <nav
        className="sticky top-14 sm:top-16 z-20 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80"
        aria-label="Page sections"
      >
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-12 py-2.5 flex gap-3 overflow-x-auto text-xs sm:text-sm whitespace-nowrap scrollbar-none">
          {NAV_SECTIONS.map(({ id, label }) => (
            <a
              key={id}
              href={`#${id}`}
              className="text-muted-foreground hover:text-primary font-medium py-1 transition-colors"
            >
              {label}
            </a>
          ))}
        </div>
      </nav>

      <main className="flex-1">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-12 py-12 sm:py-16 space-y-14 sm:space-y-16">
          {/* Highlights */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {HIGHLIGHTS.map((h) => (
              <FeatureCard key={h.title} icon={h.icon} title={h.title}>
                {h.text}
              </FeatureCard>
            ))}
          </div>

          <Section id="overview" title="Platform Overview">
            <Prose>
              Data Core Center is an enterprise-grade, multi-tenant platform for internal operations
              and workforce management. Each customer organization operates inside a workspace with
              isolated data. Platform operators manage tenants, subscriptions, entitlements, and
              commercial records from a separate super-administration console.
            </Prose>
            <Prose>
              The product combines collaboration tools (tickets, messages, calendar), organizational
              management (departments, groups, users, roles), human capital operations (HR, attendance,
              payroll, self-service), and process automation (workflows, approvals, notifications).
              Access is provisioned by administrators; there is no public self-registration.
            </Prose>
            <div className="rounded-lg border border-primary/20 bg-primary/5 px-5 py-4 text-sm text-muted-foreground">
              <strong className="text-foreground">Product focus:</strong> Human capital and internal
              operations. General ERP domains (finance, procurement, inventory as primary modules) are
              outside the current product nucleus.
            </div>
          </Section>

          <Section id="structure" title="Enterprise Operational Structure">
            <CardGrid>
              <FeatureCard icon={Building2} title="Workspace plane">
                Day-to-day operations for a single organization: modules, users, HR, payroll,
                tickets, and self-service. Data queries are workspace-scoped from authenticated
                context.
              </FeatureCard>
              <FeatureCard icon={Globe} title="Platform plane">
                Cross-tenant administration: tenant registry, commercial records, platform users,
                subscription and entitlement control, governance review, and platform-wide settings.
              </FeatureCard>
            </CardGrid>
            <SubTitle>How organizations operate</SubTitle>
            <Prose>
              A platform owner or operator provisions workspaces and assigns subscription entitlements.
              Workspace administrators invite or create users, enable modules (within entitlement limits),
              configure HR foundation data, and assign roles. Employees and managers use the workspace
              sidebar navigation to reach authorized modules. Super-admin users access the platform
              console at /super-admin with permission-gated navigation items.
            </Prose>
          </Section>

          <Section id="tenancy" title="Multi-Tenant Organization Management">
            <Prose>
              Tenancy is implemented through workspaces. Each workspace represents a customer
              organization with its own users, departments, modules, and operational data. The platform
              tenant registry links workspace profiles to subscription metadata, renewal intelligence,
              health evaluation, usage intelligence, and entitlement overrides.
            </Prose>
            <CardGrid>
              <FeatureCard icon={Database} title="Tenant registry">
                Super-admin Tenants console: lifecycle transitions, subscription association,
                commercial posture, and operational health signals per tenant.
              </FeatureCard>
              <FeatureCard icon={CreditCard} title="Subscription visibility">
                Workspace admins with tenant.subscription.read can view read-only subscription status,
                enabled modules, quotas, and enforcement labels — without in-app payment processing.
              </FeatureCard>
            </CardGrid>
            <SubTitle>SaaS packaging</SubTitle>
            <Prose>
              A commercial module catalog (hr_core, payroll, attendance, workflows, integrations,
              analytics, self_service, and others) supports plan-based entitlements and operator
              overrides with reason and confirmation. Overrides control access; they do not execute
              payroll or payments inside the entitlement registry itself.
            </Prose>
          </Section>

          <Section id="organization" title="Company & Organizational Structure">
            <Prose>
              Within a workspace, organizational structure is managed through departments and groups.
              The users module provides the employee directory. HR employee records support organizational
              attributes including branch and work location linkage via foundation data (work locations,
              positions, employment statuses and types).
            </Prose>
            <CardGrid>
              <FeatureCard icon={Building2} title="Departments & groups">
                Department CRUD and group membership for team-based collaboration and permission scoping.
              </FeatureCard>
              <FeatureCard icon={Users} title="User provisioning">
                Admin invitation by email, direct user creation, pending invitations reconciled at
                login, and password reset from workspace administration.
              </FeatureCard>
            </CardGrid>
            <Prose>
              Users without a workspace assignment see a dedicated blocking screen rather than partial
              access — maintaining clear tenancy boundaries at login.
            </Prose>
          </Section>

          <Section id="hcm" title="Workforce & HR Operations">
            <Prose>
              The Human Resources module is the HCM hub. Routes include /hr (dashboard), /hr/employees,
              employee detail and provisioning, /admin/hr/foundation, /admin/hr/services, admin form
              builder, and /hr/reports (report center).
            </Prose>
            <BulletList items={HR_CAPABILITIES} />
            <div className="mt-4 rounded-md border border-amber-200/50 bg-amber-50/50 dark:bg-amber-950/20 px-4 py-3 text-sm text-muted-foreground">
              <strong className="text-foreground">Module dependencies:</strong> {HCM_DEPENDENCIES}
            </div>
          </Section>

          <Section id="self-service" title="Employee Self-Service">
            <FeatureCard icon={ConciergeBell} title="Employee portal (/self-service)">
              <BulletList
                items={[
                  "Leave requests (/self-service/leave)",
                  "Attendance clock and history (/self-service/attendance)",
                  "Payslip access (/self-service/payslips) with payroll permission rules",
                  "Dynamic HR form submissions",
                  "Approval items routed into the self-service experience",
                  "Gated by self_service.view and enabled self-service module",
                ]}
              />
            </FeatureCard>
            <Prose>
              Legacy /forms routes redirect to self-service, consolidating employee-facing HR
              interactions in one portal.
            </Prose>
          </Section>

          <Section id="attendance-payroll" title="Attendance, Leave & Payroll Operations">
            <CardGrid>
              <FeatureCard icon={Clock} title="Time & attendance">
                Admin: /admin/hr/attendance, workforce operations, attendance import pipelines, and
                attendance integration sources. Employee self-service clock-in/out and daily status.
              </FeatureCard>
              <FeatureCard icon={ClipboardCheck} title="Leave management">
                Canonical leave APIs with employee submission and manager/HR approval paths connected
                to the approvals fabric.
              </FeatureCard>
              <FeatureCard icon={CreditCard} title="Payroll">
                /admin/hr/payroll and run detail pages; payroll operations console; pay period close,
                attendance lock, payroll lock, calculate/approve/finalize; payslip PDF generation and
                secure download tokens.
              </FeatureCard>
              <FeatureCard icon={Lock} title="Payroll confidentiality">
                Salary amounts masked when the viewer lacks hr.payroll.view, calculate, approve, or
                related permissions — supporting segregation of duties.
              </FeatureCard>
            </CardGrid>
          </Section>

          <Section id="collaboration" title="Collaboration & Daily Operations">
            <CardGrid>
              <FeatureCard icon={Ticket} title="Tickets">
                List, create, detail with comments, activity timeline, CC users, and embedded approvals.
              </FeatureCard>
              <FeatureCard icon={Mail} title="Messages">
                Internal threads with unread counts and full-width messaging layout.
              </FeatureCard>
              <FeatureCard icon={CalendarDays} title="Calendar">
                Team events with RSVP.
              </FeatureCard>
              <FeatureCard icon={Bell} title="Notifications">
                Notification center with read and bulk actions (core module).
              </FeatureCard>
            </CardGrid>
          </Section>

          <Section id="administration" title="Administrative Control & Centralized Administration">
            <SubTitle>Workspace administration</SubTitle>
            <BulletList
              items={[
                "Module enablement with dependency validation (HR root for payroll, attendance, self-service, report-center)",
                "Custom roles and permission keys (resource.action pattern)",
                "Workspace settings, theme, language (EN/AR), and profile management",
                "Workspace SMTP configuration",
                "Integrations page and platform stabilization diagnostics for module governance",
                "Workspace governance dashboard (read-only health, metrics, stuck workflows, alerts)",
              ]}
            />
            <SubTitle>Platform administration (/super-admin)</SubTitle>
            <CardGrid>
              {PLATFORM_CONSOLE_AREAS.map((area) => (
                <FeatureCard key={area.title} title={area.title}>
                  {area.text}
                </FeatureCard>
              ))}
            </CardGrid>
          </Section>

          <Section id="security" title="Security, Access Management & Role Governance">
            <Prose>
              Authentication uses employee number and password with bcrypt hashing and JWT bearer
              tokens. The requireAuth middleware loads user status, role, workspace, platform role,
              and root-owner flags on each request.
            </Prose>
            <SubTitle>Workspace roles</SubTitle>
            <div className="space-y-3">
              {WORKSPACE_ROLES.map((r) => (
                <div key={r.role} className="rounded-md border border-border px-4 py-3">
                  <span className="font-medium text-foreground">{r.role}</span>
                  <span className="text-muted-foreground text-sm"> — {r.desc}</span>
                </div>
              ))}
            </div>
            <SubTitle>Platform roles (super_admin users)</SubTitle>
            <BulletList items={PLATFORM_ROLES} />
            <Prose>
              Platform routes use requirePlatformPermission middleware aligned with the platform
              permission matrix. Root platform owner accounts are protected: other administrators
              cannot reset credentials or change email from platform user management; the owner uses
              My Account (/super-admin/account) for self-service profile and password updates.
            </Prose>
          </Section>

          <Section id="visibility" title="Dashboard & Operational Visibility">
            <CardGrid>
              <FeatureCard icon={LineChart} title="Workspace dashboard">
                /dashboard — activity and statistics for authorized users (dashboard.view).
              </FeatureCard>
              <FeatureCard icon={Shield} title="Governance">
                Workspace /governance — operational health console. Platform /super-admin/governance —
                audit integrity, violations, workflows analytics, topology, evidence packages.
              </FeatureCard>
              <FeatureCard icon={Network} title="Activity & events">
                Workspace activity timeline; platform activity and audit/event log for operators.
              </FeatureCard>
            </CardGrid>
          </Section>

          <Section id="workflows" title="Workflow & Process Management">
            <FeatureCard icon={GitFork} title="Workflows module">
              <BulletList
                items={[
                  "/workflows — workflow list and builder",
                  "/workflows/:id — workflow detail, versions, and execution context",
                  "Event-driven steps: notifications, approvals, tasks, conditions, assignments",
                  "Integration with tickets, HR services, forms, and approval queues",
                  "Super-admin governance analytics over workflow health and dependencies",
                ]}
              />
            </FeatureCard>
          </Section>

          <Section id="documents" title="Document & Media Management">
            <BulletList
              items={[
                "Ticket and HR employee document attachments",
                "Report center exports, schedules, and archive-oriented outputs",
                "Commercial invoice PDF upload and tenant billing invoice download (read-only portal)",
                "Payroll payslip PDF generation with controlled download tokens",
                "Branding asset upload with image validation and processing for platform identity",
              ]}
            />
          </Section>

          <Section id="branding" title="Branding & White-Label Capabilities">
            <FeatureCard icon={Palette} title="Platform identity settings">
              Configurable platform name (default Data Core Center), organization name, logo, favicon,
              primary color, tagline, support email, and website URL. Public pages (DCCHOME,
              /about-platform, sign-in) load branding via PlatformBrandingHead. White-label partners
              can adapt presentation while retaining the same operational core.
            </FeatureCard>
          </Section>

          <Section id="experience" title="Responsive Cross-Platform Experience & Mobile Compatibility">
            <CardGrid>
              <FeatureCard icon={Smartphone} title="Responsive web">
                Mobile sheet navigation for workspace and super-admin sidebars; lg breakpoint for
                persistent desktop sidebar; stacked layouts and touch-friendly controls on narrow
                screens.
              </FeatureCard>
              <FeatureCard icon={Globe} title="English & Arabic">
                i18next with dynamic document direction (RTL for Arabic) in workspace experiences;
                platform super-admin console defaults to English layout for cross-tenant consistency.
              </FeatureCard>
            </CardGrid>
            <Prose>
              Delivery is a responsive web application — not a native mobile app in the current
              repository. High-frequency employee actions (approvals, attendance, self-service) are
              accessible via mobile browsers.
            </Prose>
          </Section>

          <Section id="saas" title="Enterprise Scalability & SaaS Architecture Direction">
            <Prose>
              Scalability is supported through workspace isolation, toggleable modules, quota modeling,
              stateless API services, and platform-side tenant governance. Module governance prevents
              invalid enablement orders; workspace access write guards can block mutations under
              read-only enforcement during maintenance.
            </Prose>
            <Prose>
              Contract-first OpenAPI drives Zod validation and generated React Query clients, reducing
              integration drift between UI and API as the platform evolves.
            </Prose>
          </Section>

          <Section id="integration" title="Integration & API Readiness">
            <FeatureCard icon={Plug} title="Implemented integration surfaces">
              <BulletList
                items={[
                  "OpenAPI specification as the contract source of truth with codegen workflow",
                  "Attendance import pipelines and attendance integration sources",
                  "Workspace integrations administration page",
                  "HR employee import template, preview, and confirm flow",
                  "Server-sent events stream for authenticated real-time UI updates",
                  "Commercial and tenant APIs for operator systems (manual commercial records)",
                ]}
              />
            </FeatureCard>
          </Section>

          <Section id="future" title="Automation, AI Readiness & Future Expansion">
            <Prose>
              Operational automation today is delivered through workflows, approvals, notifications,
              scheduled reports, and governance analytics. The commercial entitlement catalog includes
              ai_automation and advanced_analytics module codes for higher-tier packaging — indicating
              direction for assisted operations under explicit administrative policy when implemented.
            </Prose>
            <Prose>
              Catalog modules such as recruitment, onboarding, performance, LMS, and tenant-scoped
              governance_console represent packaging and roadmap alignment; adoption depends on
              entitlement and implementation maturity per module.
            </Prose>
            <SubTitle>Future mobile application direction</SubTitle>
            <Prose>
              Native mobile applications may follow for clock events, approvals, and notifications,
              using the same permission model as the web client. Current investment prioritizes
              responsive web access.
            </Prose>
          </Section>

          <Section id="value" title="What Clients Gain">
            <div className="space-y-6">
              {CLIENT_OUTCOMES.map((block) => (
                <div key={block.title} className="rounded-lg border border-border overflow-hidden">
                  <div className="px-5 py-3 bg-muted/40 border-b border-border font-semibold text-foreground">
                    {block.title}
                  </div>
                  <ul className="px-5 py-4 space-y-2">
                    {block.items.map((item) => (
                      <li key={item} className="flex gap-2 text-sm text-muted-foreground leading-relaxed">
                        <span className="mt-2 shrink-0 w-1.5 h-1.5 rounded-full bg-primary" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </Section>

          <Section id="modules" title="Implemented Workspace Modules">
            <Prose>
              The following modules are seeded in the platform module registry and can be enabled per
              workspace (subject to entitlements and dependency rules):
            </Prose>
            <ModuleList />
          </Section>

          <div
            className="rounded-xl p-8 text-center border border-primary/20"
            style={{
              background:
                "linear-gradient(135deg, rgba(0, 31, 63, 0.06) 0%, rgba(0, 123, 255, 0.05) 100%)",
            }}
          >
            <img src={LOGO_URL} alt="" aria-hidden className="mx-auto w-28 h-auto mb-4 opacity-90" />
            <p className="text-lg font-semibold text-foreground">Data Core Center</p>
            <p className="text-sm text-muted-foreground mt-2 max-w-lg mx-auto">
              Enterprise operational capability built on real modules, routes, and governance already
              in the platform.
            </p>
            <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link
                href="/sign-in"
                className="inline-flex h-11 items-center justify-center rounded-md px-8 text-sm font-semibold text-white"
                style={{ background: "linear-gradient(90deg, #004080 0%, #007bff 100%)" }}
              >
                Authorized sign-in
                <ChevronRight className="w-4 h-4 ml-1" />
              </Link>
              <Link
                href="/dcc-home"
                className="inline-flex h-11 items-center justify-center rounded-md border border-border px-8 text-sm font-medium hover:bg-accent transition-colors"
              >
                Back to home
              </Link>
            </div>
          </div>
        </div>
      </main>

      <footer className="border-t border-border px-4 sm:px-6 lg:px-12 py-8 text-center text-xs text-muted-foreground">
        <p>Data Core Center — access restricted to authorized personnel.</p>
      </footer>
    </div>
  );
}
