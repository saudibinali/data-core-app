import type { ReactNode } from "react";
import { Link } from "wouter";
import { PublicAuthNav } from "@/components/layout/public-auth-nav";
import { usePublicLocale } from "@/lib/public-locale/context";
import {
  Building2,
  Shield,
  Users,
  Workflow,
  LineChart,
  Lock,
  Layers,
  ClipboardCheck,
  Globe,
  ChevronLeft,
  ChevronRight,
  Network,
  FileText,
  Smartphone,
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
import { cn } from "@/lib/utils";

const LOGO_URL = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/official-logo.png`;

const HIGHLIGHT_ICONS: LucideIcon[] = [Layers, Users, Shield, Workflow];

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

export default function AboutPlatformPage() {
  const { locale, dir, isRtl, messages } = usePublicLocale();
  const a = messages.about;
  const s = a.sections;
  const Trail = isRtl ? ChevronLeft : ChevronRight;

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background" dir={dir} lang={locale}>
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
            alt={a.heroTitle}
            className="mx-auto w-44 sm:w-56 md:w-72 h-auto object-contain drop-shadow-[0_8px_32px_rgba(0,123,255,0.35)]"
          />
          <p className="mt-6 text-xs font-semibold uppercase tracking-[0.35em] text-[#5ba3d0]">
            {a.heroEyebrow}
          </p>
          <h1 className="mt-3 text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-white leading-tight">
            {a.heroTitle}
          </h1>
          <p className="mt-5 text-base sm:text-lg text-slate-300 max-w-3xl mx-auto leading-relaxed">
            {a.heroSubtitle}
          </p>
        </div>
      </section>

      <nav
        className="sticky top-14 sm:top-16 z-20 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80"
        aria-label="Page sections"
      >
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-12 py-2.5 flex gap-3 overflow-x-auto text-xs sm:text-sm whitespace-nowrap scrollbar-none">
          {a.nav.map(({ id, label }) => (
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
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {a.highlights.map((h, i) => {
              const Icon = HIGHLIGHT_ICONS[i] ?? Layers;
              return (
                <FeatureCard key={h.title} icon={Icon} title={h.title}>
                  {h.text}
                </FeatureCard>
              );
            })}
          </div>

          <Section id="overview" title={s.overview.title}>
            <Prose>{s.overview.p1}</Prose>
            <Prose>{s.overview.p2}</Prose>
            <div className="rounded-lg border border-primary/20 bg-primary/5 px-5 py-4 text-sm text-muted-foreground">
              <strong className="text-foreground">{s.overview.focusLabel}</strong> {s.overview.focusText}
            </div>
          </Section>

          <Section id="structure" title={s.structure.title}>
            <CardGrid>
              <FeatureCard icon={Building2} title={s.structure.workspacePlane.title}>
                {s.structure.workspacePlane.text}
              </FeatureCard>
              <FeatureCard icon={Globe} title={s.structure.platformPlane.title}>
                {s.structure.platformPlane.text}
              </FeatureCard>
            </CardGrid>
            <SubTitle>{s.structure.howOperateTitle}</SubTitle>
            <Prose>{s.structure.howOperate}</Prose>
          </Section>

          <Section id="tenancy" title={s.tenancy.title}>
            <Prose>{s.tenancy.p1}</Prose>
            <CardGrid>
              <FeatureCard icon={Database} title={s.tenancy.tenantRegistry.title}>
                {s.tenancy.tenantRegistry.text}
              </FeatureCard>
              <FeatureCard icon={CreditCard} title={s.tenancy.subscription.title}>
                {s.tenancy.subscription.text}
              </FeatureCard>
            </CardGrid>
            <SubTitle>{s.tenancy.saasTitle}</SubTitle>
            <Prose>{s.tenancy.saas}</Prose>
          </Section>

          <Section id="organization" title={s.organization.title}>
            <Prose>{s.organization.p1}</Prose>
            <CardGrid>
              <FeatureCard icon={Building2} title={s.organization.deptGroups.title}>
                {s.organization.deptGroups.text}
              </FeatureCard>
              <FeatureCard icon={Users} title={s.organization.provisioning.title}>
                {s.organization.provisioning.text}
              </FeatureCard>
            </CardGrid>
            <Prose>{s.organization.p2}</Prose>
          </Section>

          <Section id="hcm" title={s.hcm.title}>
            <Prose>{s.hcm.p1}</Prose>
            <BulletList items={s.hcm.capabilities} />
            <div className="mt-4 rounded-md border border-amber-200/50 bg-amber-50/50 dark:bg-amber-950/20 px-4 py-3 text-sm text-muted-foreground">
              <strong className="text-foreground">{s.hcm.depsLabel}</strong> {s.hcm.deps}
            </div>
          </Section>

          <Section id="self-service" title={s.selfService.title}>
            <FeatureCard icon={ConciergeBell} title={s.selfService.portalTitle}>
              <BulletList items={s.selfService.bullets} />
            </FeatureCard>
            <Prose>{s.selfService.p1}</Prose>
          </Section>

          <Section id="attendance-payroll" title={s.attendancePayroll.title}>
            <CardGrid>
              <FeatureCard icon={Clock} title={s.attendancePayroll.attendance.title}>
                {s.attendancePayroll.attendance.text}
              </FeatureCard>
              <FeatureCard icon={ClipboardCheck} title={s.attendancePayroll.leave.title}>
                {s.attendancePayroll.leave.text}
              </FeatureCard>
              <FeatureCard icon={CreditCard} title={s.attendancePayroll.payroll.title}>
                {s.attendancePayroll.payroll.text}
              </FeatureCard>
              <FeatureCard icon={Lock} title={s.attendancePayroll.confidentiality.title}>
                {s.attendancePayroll.confidentiality.text}
              </FeatureCard>
            </CardGrid>
          </Section>

          <Section id="collaboration" title={s.collaboration.title}>
            <CardGrid>
              <FeatureCard icon={Ticket} title={s.collaboration.tickets.title}>
                {s.collaboration.tickets.text}
              </FeatureCard>
              <FeatureCard icon={Mail} title={s.collaboration.messages.title}>
                {s.collaboration.messages.text}
              </FeatureCard>
              <FeatureCard icon={CalendarDays} title={s.collaboration.calendar.title}>
                {s.collaboration.calendar.text}
              </FeatureCard>
              <FeatureCard icon={Bell} title={s.collaboration.notifications.title}>
                {s.collaboration.notifications.text}
              </FeatureCard>
            </CardGrid>
          </Section>

          <Section id="administration" title={s.administration.title}>
            <SubTitle>{s.administration.workspaceTitle}</SubTitle>
            <BulletList items={s.administration.workspaceBullets} />
            <SubTitle>{s.administration.platformTitle}</SubTitle>
            <CardGrid>
              {s.administration.platformAreas.map((area) => (
                <FeatureCard key={area.title} title={area.title}>
                  {area.text}
                </FeatureCard>
              ))}
            </CardGrid>
          </Section>

          <Section id="security" title={s.security.title}>
            <Prose>{s.security.p1}</Prose>
            <SubTitle>{s.security.workspaceRolesTitle}</SubTitle>
            <div className="space-y-3">
              {s.security.workspaceRoles.map((r) => (
                <div key={r.role} className="rounded-md border border-border px-4 py-3">
                  <span className="font-medium text-foreground">{r.role}</span>
                  <span className="text-muted-foreground text-sm"> — {r.desc}</span>
                </div>
              ))}
            </div>
            <SubTitle>{s.security.platformRolesTitle}</SubTitle>
            <BulletList items={s.security.platformRoles} />
            <Prose>{s.security.p2}</Prose>
          </Section>

          <Section id="visibility" title={s.visibility.title}>
            <CardGrid>
              <FeatureCard icon={LineChart} title={s.visibility.dashboard.title}>
                {s.visibility.dashboard.text}
              </FeatureCard>
              <FeatureCard icon={Shield} title={s.visibility.governance.title}>
                {s.visibility.governance.text}
              </FeatureCard>
              <FeatureCard icon={Network} title={s.visibility.activity.title}>
                {s.visibility.activity.text}
              </FeatureCard>
            </CardGrid>
          </Section>

          <Section id="workflows" title={s.workflows.title}>
            <FeatureCard icon={GitFork} title={s.workflows.cardTitle}>
              <BulletList items={s.workflows.bullets} />
            </FeatureCard>
          </Section>

          <Section id="documents" title={s.documents.title}>
            <BulletList items={s.documents.bullets} />
          </Section>

          <Section id="branding" title={s.branding.title}>
            <FeatureCard icon={Palette} title={s.branding.cardTitle}>
              {s.branding.text}
            </FeatureCard>
          </Section>

          <Section id="experience" title={s.experience.title}>
            <CardGrid>
              <FeatureCard icon={Smartphone} title={s.experience.responsive.title}>
                {s.experience.responsive.text}
              </FeatureCard>
              <FeatureCard icon={Globe} title={s.experience.i18n.title}>
                {s.experience.i18n.text}
              </FeatureCard>
            </CardGrid>
            <Prose>{s.experience.p1}</Prose>
          </Section>

          <Section id="saas" title={s.saas.title}>
            <Prose>{s.saas.p1}</Prose>
            <Prose>{s.saas.p2}</Prose>
          </Section>

          <Section id="integration" title={s.integration.title}>
            <FeatureCard icon={Plug} title={s.integration.cardTitle}>
              <BulletList items={s.integration.bullets} />
            </FeatureCard>
          </Section>

          <Section id="future" title={s.future.title}>
            <Prose>{s.future.p1}</Prose>
            <Prose>{s.future.p2}</Prose>
            <SubTitle>{s.future.mobileTitle}</SubTitle>
            <Prose>{s.future.mobile}</Prose>
          </Section>

          <Section id="value" title={s.value.title}>
            <div className="space-y-6">
              {s.value.outcomes.map((block) => (
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

          <Section id="modules" title={s.modules.title}>
            <Prose>{s.modules.intro}</Prose>
            <div className="rounded-lg border border-border divide-y divide-border max-h-[420px] overflow-y-auto">
              {a.workspaceModules.map((m) => (
                <div key={m.name} className="px-4 py-3 hover:bg-muted/30 transition-colors">
                  <p className="font-medium text-sm text-foreground">{m.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{m.desc}</p>
                </div>
              ))}
            </div>
          </Section>

          <div
            className="rounded-xl p-8 text-center border border-primary/20"
            style={{
              background:
                "linear-gradient(135deg, rgba(0, 31, 63, 0.06) 0%, rgba(0, 123, 255, 0.05) 100%)",
            }}
          >
            <img src={LOGO_URL} alt="" aria-hidden className="mx-auto w-28 h-auto mb-4 opacity-90" />
            <p className="text-lg font-semibold text-foreground">{a.cta.tagline}</p>
            <p className="text-sm text-muted-foreground mt-2 max-w-lg mx-auto">{a.cta.subtitle}</p>
            <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link
                href="/sign-in"
                className="inline-flex h-11 items-center justify-center rounded-md px-8 text-sm font-semibold text-white"
                style={{ background: "linear-gradient(90deg, #004080 0%, #007bff 100%)" }}
              >
                {a.cta.signIn}
                <Trail className={cn("w-4 h-4", isRtl ? "me-1" : "ms-1")} />
              </Link>
              <Link
                href="/dcc-home"
                className="inline-flex h-11 items-center justify-center rounded-md border border-border px-8 text-sm font-medium hover:bg-accent transition-colors"
              >
                {a.cta.home}
              </Link>
            </div>
          </div>
        </div>
      </main>

      <footer className="border-t border-border px-4 sm:px-6 lg:px-12 py-8 text-center text-xs text-muted-foreground">
        <p>{a.footer}</p>
      </footer>
    </div>
  );
}
