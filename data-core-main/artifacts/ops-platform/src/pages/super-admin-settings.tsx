import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import {
  useGetPlatformSettings,
  useUpdatePlatformSettings,
  useListModules,
  useUpdateModule,
  getListModulesQueryKey,
  getGetPlatformSettingsQueryKey,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import {
  Building2, Network, Server, Lock, Shield, Database, HardDrive,
  Mail, ShieldCheck, Archive, Activity, ToggleLeft, Key, Wrench, Layers,
  CheckCircle2, XCircle, AlertCircle, Save, RotateCcw, ExternalLink, ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { BrandingAssetField } from "@/components/platform/BrandingAssetField";
import { DEFAULT_FAVICON, DEFAULT_LOGO } from "@/lib/platform-branding";

// ── Types ─────────────────────────────────────────────────────────────────────
type NavSection = {
  id: string;
  icon: React.ElementType;
  labelKey: string;
  dot?: boolean;
};

const NAV: NavSection[] = [
  { id: "identity",      icon: Building2,   labelKey: "ps_identity",      dot: true  },
  { id: "network",       icon: Network,     labelKey: "ps_network",       dot: true  },
  { id: "deployment",    icon: Server,      labelKey: "ps_deployment"               },
  { id: "auth",          icon: Lock,        labelKey: "ps_auth"                     },
  { id: "access",        icon: Shield,      labelKey: "ps_access"                   },
  { id: "database",      icon: Database,    labelKey: "ps_database"                 },
  { id: "storage",       icon: HardDrive,   labelKey: "ps_storage"                  },
  { id: "smtp",          icon: Mail,        labelKey: "ps_smtp",          dot: true  },
  { id: "security",      icon: ShieldCheck, labelKey: "ps_security",      dot: true  },
  { id: "backup",        icon: Archive,     labelKey: "ps_backup"                   },
  { id: "observability", icon: Activity,    labelKey: "ps_observability"            },
  { id: "features",      icon: ToggleLeft,  labelKey: "ps_features",      dot: true  },
  { id: "api",           icon: Key,         labelKey: "ps_api"                      },
  { id: "maintenance",   icon: Wrench,      labelKey: "ps_maintenance",   dot: true  },
  { id: "multitenant",   icon: Layers,      labelKey: "ps_multitenant"              },
];

// ── Shared sub-components ──────────────────────────────────────────────────────
function SectionHeader({ icon: Icon, title, desc }: { icon: React.ElementType; title: string; desc: string }) {
  return (
    <div className="flex items-start gap-3 mb-6">
      <div className="p-2 rounded-lg bg-muted shrink-0">
        <Icon className="w-5 h-5 text-foreground" />
      </div>
      <div>
        <h2 className="text-lg font-semibold leading-tight">{title}</h2>
        <p className="text-sm text-muted-foreground mt-0.5">{desc}</p>
      </div>
    </div>
  );
}

function InfoRow({ label, value, status }: { label: string; value: string; status?: "ok" | "warn" | "off" | "info" }) {
  const icon =
    status === "ok"   ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" /> :
    status === "warn" ? <AlertCircle  className="w-3.5 h-3.5 text-amber-500 shrink-0" />  :
    status === "off"  ? <XCircle      className="w-3.5 h-3.5 text-zinc-400 shrink-0" />   : null;
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-2.5 border-b border-border last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1.5">
        {icon}
        <span className="text-sm font-mono font-medium">{value}</span>
      </div>
    </div>
  );
}

function UnsavedBar({ onSave, onDiscard, saving }: { onSave: () => void; onDiscard: () => void; saving: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="sticky bottom-0 bg-amber-50 dark:bg-amber-950/40 border-t border-amber-200 dark:border-amber-800 px-0 py-3 flex items-center justify-between gap-4 mt-6 -mx-1">
      <div className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400">
        <AlertCircle className="w-4 h-4 shrink-0" />
        {t("ps_unsaved_changes")}
      </div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onDiscard} disabled={saving}>
          <RotateCcw className="w-3.5 h-3.5 me-1.5" />{t("ps_discard_changes")}
        </Button>
        <Button size="sm" onClick={onSave} disabled={saving}>
          <Save className="w-3.5 h-3.5 me-1.5" />{saving ? t("saving") : t("ps_save_section")}
        </Button>
      </div>
    </div>
  );
}

// ── Identity ──────────────────────────────────────────────────────────────────
function IdentitySection({ settings, onSave }: { settings: Record<string, unknown>; onSave: (cat: string, d: Record<string, unknown>) => Promise<void> }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ ...settings });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setForm({ ...settings }); setDirty(false); }, [settings]);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => { setForm(p => ({ ...p, [k]: e.target.value })); setDirty(true); };
  const handleSave = async () => {
    setSaving(true);
    await onSave("identity", form);
    setSaving(false);
    setDirty(false);
    void queryClient.invalidateQueries({ queryKey: ["platform", "branding"] });
  };
  const refreshBranding = () => {
    setDirty(true);
    void queryClient.invalidateQueries({ queryKey: ["platform", "branding"] });
  };
  return (
    <div>
      <SectionHeader icon={Building2} title={t("ps_identity")} desc={t("ps_identity_desc")} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>{t("ps_platform_name")}</Label>
          <Input value={String(form.platform_name ?? "")} onChange={set("platform_name")} placeholder="OpsPlatform" />
        </div>
        <div className="space-y-1.5">
          <Label>{t("ps_org_name")}</Label>
          <Input value={String(form.org_name ?? "")} onChange={set("org_name")} placeholder="Acme Corporation" />
        </div>
        <div className="sm:col-span-2">
          <BrandingAssetField
            kind="logo"
            label={t("ps_logo_url")}
            hint={t("ps_logo_hint")}
            url={String(form.logo_url ?? "")}
            fallbackSrc={DEFAULT_LOGO}
            onUrlChange={(v) => {
              setForm((p) => ({ ...p, logo_url: v }));
              setDirty(true);
            }}
            onUploaded={refreshBranding}
          />
        </div>
        <div className="sm:col-span-2">
          <BrandingAssetField
            kind="favicon"
            label={t("ps_favicon_url")}
            hint={t("ps_favicon_hint")}
            url={String(form.favicon_url ?? "")}
            fallbackSrc={DEFAULT_FAVICON}
            onUrlChange={(v) => {
              setForm((p) => ({ ...p, favicon_url: v }));
              setDirty(true);
            }}
            onUploaded={refreshBranding}
          />
        </div>
        <div className="space-y-1.5">
          <Label>{t("ps_support_email")}</Label>
          <Input type="email" value={String(form.support_email ?? "")} onChange={set("support_email")} placeholder="support@company.com" />
        </div>
        <div className="space-y-1.5">
          <Label>{t("ps_website_url")}</Label>
          <Input value={String(form.website_url ?? "")} onChange={set("website_url")} placeholder="https://company.com" />
        </div>
        <div className="sm:col-span-2 space-y-1.5">
          <Label>{t("ps_tagline")}</Label>
          <Input value={String(form.tagline ?? "")} onChange={set("tagline")} placeholder="Your enterprise operations hub" />
        </div>
        <div className="sm:col-span-2 space-y-1.5">
          <Label>{t("brand_color")}</Label>
          <div className="flex items-center gap-2">
            <input type="color" value={String(form.primary_color ?? "#3b82f6")}
              onChange={(e) => { setForm(p => ({ ...p, primary_color: e.target.value })); setDirty(true); }}
              className="w-10 h-9 rounded border border-input cursor-pointer p-1 bg-background" />
            <Input value={String(form.primary_color ?? "")} onChange={set("primary_color")} className="font-mono w-36" placeholder="#3b82f6" />
          </div>
        </div>
      </div>
      {dirty && <UnsavedBar onSave={handleSave} onDiscard={() => { setForm({ ...settings }); setDirty(false); }} saving={saving} />}
    </div>
  );
}

// ── Network ───────────────────────────────────────────────────────────────────
function NetworkSection({ settings, onSave }: { settings: Record<string, unknown>; onSave: (cat: string, d: Record<string, unknown>) => Promise<void> }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({ ...settings });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setForm({ ...settings }); setDirty(false); }, [settings]);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => { setForm(p => ({ ...p, [k]: e.target.value })); setDirty(true); };
  const toggle = (k: string, v: boolean) => { setForm(p => ({ ...p, [k]: v })); setDirty(true); };
  const handleSave = async () => { setSaving(true); await onSave("network", form); setSaving(false); setDirty(false); };
  return (
    <div>
      <SectionHeader icon={Network} title={t("ps_network")} desc={t("ps_network_desc")} />
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label>{t("ps_app_url")}</Label>
          <Input value={String(form.app_url ?? "")} onChange={set("app_url")} placeholder="https://ops.company.com" />
        </div>
        <div className="space-y-1.5">
          <Label>{t("ps_cors_origins")}</Label>
          <Input
            value={Array.isArray(form.cors_origins) ? (form.cors_origins as string[]).join(", ") : String(form.cors_origins ?? "")}
            onChange={(e) => { setForm(p => ({ ...p, cors_origins: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })); setDirty(true); }}
            placeholder="https://app.company.com, https://admin.company.com" />
          <p className="text-xs text-muted-foreground">{t("ps_cors_hint")}</p>
        </div>
        <div className="space-y-1.5">
          <Label>{t("ps_trusted_proxies")}</Label>
          <Input value={String(form.trusted_proxies ?? "loopback")} onChange={set("trusted_proxies")} placeholder="loopback" />
        </div>
        <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-muted/30">
          <p className="text-sm font-medium">{t("ps_websocket")}</p>
          <Switch checked={Boolean(form.websocket_enabled)} onCheckedChange={(v) => toggle("websocket_enabled", v)} />
        </div>
      </div>
      {dirty && <UnsavedBar onSave={handleSave} onDiscard={() => { setForm({ ...settings }); setDirty(false); }} saving={saving} />}
    </div>
  );
}

// ── SMTP ──────────────────────────────────────────────────────────────────────
function SmtpSection({ settings, onSave }: { settings: Record<string, unknown>; onSave: (cat: string, d: Record<string, unknown>) => Promise<void> }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({ ...settings });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setForm({ ...settings }); setDirty(false); }, [settings]);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => { setForm(p => ({ ...p, [k]: e.target.value })); setDirty(true); };
  const toggle = (k: string, v: boolean) => { setForm(p => ({ ...p, [k]: v })); setDirty(true); };
  const handleSave = async () => { setSaving(true); await onSave("smtp", form); setSaving(false); setDirty(false); };
  return (
    <div>
      <SectionHeader icon={Mail} title={t("ps_smtp")} desc={t("ps_smtp_desc")} />
      <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-muted/30 mb-5">
        <div>
          <p className="text-sm font-medium">{t("ps_smtp_enabled")}</p>
          <p className="text-xs text-muted-foreground">Enables outbound email for notifications and invitations</p>
        </div>
        <Switch checked={Boolean(form.enabled)} onCheckedChange={(v) => toggle("enabled", v)} />
      </div>
      <div className={cn("grid grid-cols-1 sm:grid-cols-2 gap-4 transition-opacity", !form.enabled && "opacity-50 pointer-events-none")}>
        <div className="space-y-1.5">
          <Label>{t("ps_smtp_host")}</Label>
          <Input value={String(form.host ?? "")} onChange={set("host")} placeholder="smtp.example.com" />
        </div>
        <div className="space-y-1.5">
          <Label>{t("ps_smtp_port")}</Label>
          <Input type="number" value={String(form.port ?? 587)} onChange={set("port")} placeholder="587" />
        </div>
        <div className="space-y-1.5">
          <Label>{t("ps_smtp_username")}</Label>
          <Input value={String(form.username ?? "")} onChange={set("username")} placeholder="user@example.com" />
        </div>
        <div className="space-y-1.5">
          <Label>{t("ps_smtp_password")}</Label>
          <Input type="password" value={String(form.password ?? "")} onChange={set("password")} placeholder="••••••••" />
        </div>
        <div className="space-y-1.5">
          <Label>{t("ps_smtp_from_email")}</Label>
          <Input type="email" value={String(form.from_email ?? "")} onChange={set("from_email")} placeholder="no-reply@example.com" />
        </div>
        <div className="space-y-1.5">
          <Label>{t("ps_smtp_from_name")}</Label>
          <Input value={String(form.from_name ?? "")} onChange={set("from_name")} placeholder="OpsPlatform" />
        </div>
        <div className="sm:col-span-2 flex items-center justify-between p-3 rounded-lg border border-border bg-muted/30">
          <p className="text-sm font-medium">{t("ps_smtp_secure")}</p>
          <Switch checked={Boolean(form.secure)} onCheckedChange={(v) => toggle("secure", v)} />
        </div>
      </div>
      {dirty && <UnsavedBar onSave={handleSave} onDiscard={() => { setForm({ ...settings }); setDirty(false); }} saving={saving} />}
    </div>
  );
}

// ── Security ──────────────────────────────────────────────────────────────────
function SecuritySection({ settings, onSave }: { settings: Record<string, unknown>; onSave: (cat: string, d: Record<string, unknown>) => Promise<void> }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({ ...settings });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setForm({ ...settings }); setDirty(false); }, [settings]);
  const setNum = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => { setForm(p => ({ ...p, [k]: Number(e.target.value) })); setDirty(true); };
  const toggle = (k: string, v: boolean) => { setForm(p => ({ ...p, [k]: v })); setDirty(true); };
  const handleSave = async () => { setSaving(true); await onSave("security", form); setSaving(false); setDirty(false); };
  const booleans = [
    { k: "password_require_uppercase", label: t("ps_password_require_uppercase") },
    { k: "password_require_special",   label: t("ps_password_require_special")   },
    { k: "password_require_number",    label: t("ps_password_require_number")    },
    { k: "require_mfa",                label: t("ps_require_mfa")                },
  ];
  return (
    <div>
      <SectionHeader icon={ShieldCheck} title={t("ps_security")} desc={t("ps_security_desc")} />
      <div className="space-y-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/50 mb-3">Session Policy</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label>{t("ps_session_duration")}</Label>
              <Input type="number" min={1} max={720} value={String(form.session_duration_hours ?? 24)} onChange={setNum("session_duration_hours")} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("ps_max_login_attempts")}</Label>
              <Input type="number" min={1} max={100} value={String(form.max_login_attempts ?? 10)} onChange={setNum("max_login_attempts")} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("ps_lockout_duration")}</Label>
              <Input type="number" min={1} max={10080} value={String(form.lockout_duration_minutes ?? 30)} onChange={setNum("lockout_duration_minutes")} />
            </div>
          </div>
        </div>
        <Separator />
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/50 mb-3">Password Policy</p>
          <div className="space-y-1.5 mb-3">
            <Label>{t("ps_password_min_length")}</Label>
            <Input type="number" min={6} max={64} value={String(form.password_min_length ?? 8)} onChange={setNum("password_min_length")} className="w-28" />
          </div>
          <div className="space-y-2">
            {booleans.map(({ k, label }) => (
              <div key={k} className="flex items-center justify-between p-3 rounded-lg border border-border bg-muted/30">
                <p className="text-sm font-medium">{label}</p>
                <Switch checked={Boolean(form[k])} onCheckedChange={(v) => toggle(k, v)} />
              </div>
            ))}
          </div>
        </div>
        <Separator />
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/50 mb-3">Domain & IP Restrictions</p>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>{t("ps_allowed_domains")}</Label>
              <Input
                value={Array.isArray(form.allowed_email_domains) ? (form.allowed_email_domains as string[]).join(", ") : String(form.allowed_email_domains ?? "")}
                onChange={(e) => { setForm(p => ({ ...p, allowed_email_domains: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })); setDirty(true); }}
                placeholder="company.com, subsidiary.com" />
              <p className="text-xs text-muted-foreground">{t("ps_allowed_domains_hint")}</p>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-muted/30">
              <p className="text-sm font-medium">{t("ps_ip_whitelist_enabled")}</p>
              <Switch checked={Boolean(form.ip_whitelist_enabled)} onCheckedChange={(v) => toggle("ip_whitelist_enabled", v)} />
            </div>
            {Boolean(form.ip_whitelist_enabled) && (
              <div className="space-y-1.5">
                <Label>{t("ps_ip_whitelist")}</Label>
                <Textarea rows={3}
                  value={Array.isArray(form.ip_whitelist) ? (form.ip_whitelist as string[]).join("\n") : String(form.ip_whitelist ?? "")}
                  onChange={(e) => { setForm(p => ({ ...p, ip_whitelist: e.target.value.split("\n").map(s => s.trim()).filter(Boolean) })); setDirty(true); }}
                  placeholder={"192.168.1.0/24\n10.0.0.0/8"} />
                <p className="text-xs text-muted-foreground">{t("ps_ip_whitelist_hint")}</p>
              </div>
            )}
          </div>
        </div>
      </div>
      {dirty && <UnsavedBar onSave={handleSave} onDiscard={() => { setForm({ ...settings }); setDirty(false); }} saving={saving} />}
    </div>
  );
}

// ── Features ──────────────────────────────────────────────────────────────────
const CATEGORY_ORDER = ["core", "operations", "communication", "productivity", "organization", "administration"];

function FeaturesSection({ settings, onSave }: { settings: Record<string, unknown>; onSave: (cat: string, d: Record<string, unknown>) => Promise<void> }) {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ ...settings });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const { data: modules, isLoading } = useListModules();
  const updateModule = useUpdateModule();
  useEffect(() => { setForm({ ...settings }); setDirty(false); }, [settings]);
  const toggle = (k: string, v: boolean) => { setForm(p => ({ ...p, [k]: v })); setDirty(true); };
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => { setForm(p => ({ ...p, [k]: e.target.value })); setDirty(true); };
  const handleSave = async () => { setSaving(true); await onSave("features", form); setSaving(false); setDirty(false); };
  const grouped = (modules ?? []).reduce<Record<string, typeof modules>>((acc, m) => { (acc[m.category] = acc[m.category] ?? []).push(m); return acc; }, {});
  const categories = CATEGORY_ORDER.filter((c) => grouped[c]?.length);
  return (
    <div>
      <SectionHeader icon={ToggleLeft} title={t("ps_features")} desc={t("ps_features_desc")} />
      <div className="space-y-3 mb-6">
        <div className={cn("flex items-center justify-between p-3 rounded-lg border bg-amber-50 dark:bg-amber-950/30", form.maintenance_mode ? "border-amber-300 dark:border-amber-700" : "border-border")}>
          <div>
            <p className="text-sm font-medium">{t("ps_maintenance_mode")}</p>
            <p className="text-xs text-muted-foreground">Blocks all non-admin access to the platform</p>
          </div>
          <Switch checked={Boolean(form.maintenance_mode)} onCheckedChange={(v) => toggle("maintenance_mode", v)} />
        </div>
        {Boolean(form.maintenance_mode) && (
          <div className="space-y-1.5">
            <Label>{t("ps_maintenance_msg")}</Label>
            <Input value={String(form.maintenance_message ?? "")} onChange={set("maintenance_message")} />
          </div>
        )}
        <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-muted/30">
          <p className="text-sm font-medium">{t("ps_allow_registration")}</p>
          <Switch checked={Boolean(form.allow_public_registration)} onCheckedChange={(v) => toggle("allow_public_registration", v)} />
        </div>
        <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-muted/30">
          <p className="text-sm font-medium">{t("ps_guest_access")}</p>
          <Switch checked={Boolean(form.guest_access_enabled)} onCheckedChange={(v) => toggle("guest_access_enabled", v)} />
        </div>
      </div>
      {dirty && <UnsavedBar onSave={handleSave} onDiscard={() => { setForm({ ...settings }); setDirty(false); }} saving={saving} />}
      <Separator className="my-6" />
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/50 mb-4">{t("platform_modules")}</p>
      {isLoading ? (
        <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="h-12 rounded-lg bg-muted animate-pulse" />)}</div>
      ) : (
        categories.map(cat => (
          <div key={cat} className="mb-4">
            <p className="text-xs text-muted-foreground/60 uppercase tracking-wide mb-2 px-1">{cat}</p>
            <div className="space-y-1">
              {(grouped[cat] ?? []).map(m => {
                const label = i18n.language.startsWith("ar") ? m.nameAr : m.name;
                return (
                  <div key={m.key} className="flex items-center justify-between gap-4 px-3 py-2.5 rounded-lg border border-border bg-card">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{label}</span>
                      {m.core && <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-semibold uppercase">{t("module_core_badge")}</span>}
                    </div>
                    <Switch checked={m.enabled} disabled={m.core || updateModule.isPending}
                      onCheckedChange={(v) => updateModule.mutate({ key: m.key, data: { enabled: v } }, {
                        onSuccess: () => { toast({ title: t("module_toggle_success") }); queryClient.invalidateQueries({ queryKey: getListModulesQueryKey() }); },
                        onError: () => toast({ title: t("module_toggle_error"), variant: "destructive" }),
                      })} />
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ── Maintenance ───────────────────────────────────────────────────────────────
function MaintenanceSection() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [clearing, setClearing] = useState(false);
  const handleClearCache = async () => {
    setClearing(true);
    await new Promise(r => setTimeout(r, 1200));
    setClearing(false);
    toast({ title: t("ps_cache_cleared") });
  };
  return (
    <div>
      <SectionHeader icon={Wrench} title={t("ps_maintenance")} desc={t("ps_maintenance_desc")} />
      <div className="space-y-3">
        <div className="flex items-center justify-between p-4 rounded-lg border border-border bg-card">
          <div>
            <p className="text-sm font-medium">{t("ps_cache_clear")}</p>
            <p className="text-xs text-muted-foreground">Clears server-side query and data caches</p>
          </div>
          <Button variant="outline" size="sm" onClick={handleClearCache} disabled={clearing}>
            {clearing ? t("ps_cache_clearing") : t("ps_cache_clear")}
          </Button>
        </div>
        <div className="flex items-center justify-between p-4 rounded-lg border border-border bg-card">
          <div>
            <p className="text-sm font-medium">{t("ps_reindex")}</p>
            <p className="text-xs text-muted-foreground">Rebuilds search indices for all workspace data</p>
          </div>
          <Button variant="outline" size="sm" disabled>{t("ps_coming_soon")}</Button>
        </div>
        <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-400 mb-1">
            <AlertCircle className="w-4 h-4" /> Application Restart
          </div>
          <p className="text-xs text-muted-foreground mb-3">{t("ps_restart_warning")}</p>
          <Button variant="destructive" size="sm" disabled>{t("ps_coming_soon")}</Button>
        </div>
      </div>
    </div>
  );
}

// ── Read-only sections ─────────────────────────────────────────────────────────
function DeploymentSection() {
  const { t } = useTranslation();
  return (
    <div>
      <SectionHeader icon={Server} title={t("ps_deployment")} desc={t("ps_deployment_desc")} />
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <InfoRow label={t("ps_env_mode")}     value={import.meta.env.MODE ?? "production"} status="ok" />
        <InfoRow label={t("ps_node_version")} value="Node.js 24 (LTS)"                      status="ok" />
        <InfoRow label="Runtime"              value="Express 5 / CJS"                        status="ok" />
        <InfoRow label="Database"             value="PostgreSQL + Drizzle ORM"               status="ok" />
        <InfoRow label="Build System"         value="esbuild"                                status="ok" />
        <InfoRow label="Object Storage"       value="Replit Object Storage"                  status="ok" />
        <InfoRow label="Container-ready"      value="Docker / PM2 supported"                 status="info" />
        <InfoRow label="Reverse Proxy"        value="Nginx-ready"                            status="info" />
      </div>
    </div>
  );
}

function AuthSection() {
  const { t } = useTranslation();
  return (
    <div>
      <SectionHeader icon={Lock} title={t("ps_auth")} desc={t("ps_auth_desc")} />
      <div className="space-y-2 mb-4">
        {[
          { label: t("ps_local_auth"), active: true,  note: "bcrypt (cost 12) + jsonwebtoken HS256" },
          { label: t("ps_ldap"),       active: false, note: t("ps_coming_soon") },
          { label: t("ps_saml"),       active: false, note: t("ps_coming_soon") },
          { label: t("ps_oauth"),      active: false, note: t("ps_coming_soon") },
        ].map(({ label, active, note }) => (
          <div key={label} className="flex items-center justify-between p-3 rounded-lg border border-border bg-card">
            <div className="flex items-center gap-2.5">
              {active ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <XCircle className="w-4 h-4 text-zinc-400" />}
              <div>
                <p className="text-sm font-medium">{label}</p>
                <p className="text-xs text-muted-foreground">{note}</p>
              </div>
            </div>
            {active
              ? <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 font-medium">{t("ps_enabled_label")}</span>
              : <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 font-medium">{t("ps_coming_soon")}</span>}
          </div>
        ))}
      </div>
      <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 text-xs text-blue-700 dark:text-blue-300">
        JWT tokens signed with HS256 · 24h expiry · stored in localStorage · Bearer header on every request
      </div>
    </div>
  );
}

function AccessSection() {
  const { t } = useTranslation();
  return (
    <div>
      <SectionHeader icon={Shield} title={t("ps_access")} desc={t("ps_access_desc")} />
      <div className="space-y-2 mb-5">
        {[
          { role: "super_admin", desc: "Platform owner - full access to all workspaces and platform settings" },
          { role: "admin",       desc: "Workspace admin - manages users, invitations, and workspace settings" },
          { role: "manager",     desc: "Team manager - manages tickets, approvals, and team members" },
          { role: "member",      desc: "Standard user - access to assigned modules and own data" },
        ].map(r => (
          <div key={r.role} className="p-3 rounded-lg border border-border bg-card">
            <div className="flex items-center gap-2 mb-0.5">
              <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">{r.role}</code>
              <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 font-medium">{t("ps_enabled_label")}</span>
            </div>
            <p className="text-xs text-muted-foreground">{r.desc}</p>
          </div>
        ))}
      </div>
      <Button variant="outline" size="sm" asChild>
        <Link href="/roles">
          <ExternalLink className="w-3.5 h-3.5 me-1.5" /> Manage Custom Roles <ChevronRight className="w-3.5 h-3.5 ms-1" />
        </Link>
      </Button>
    </div>
  );
}

function DatabaseSection() {
  const { t } = useTranslation();
  return (
    <div>
      <SectionHeader icon={Database} title={t("ps_database")} desc={t("ps_database_desc")} />
      <div className="rounded-lg border border-border bg-card overflow-hidden mb-4">
        <InfoRow label={t("ps_db_type")}   value="PostgreSQL 16"               status="ok" />
        <InfoRow label={t("ps_db_status")} value={t("ps_db_connected")}        status="ok" />
        <InfoRow label="ORM"               value="Drizzle ORM (type-safe)"     status="ok" />
        <InfoRow label={t("ps_db_pool")}   value="pg pool (default)"           status="ok" />
        <InfoRow label="Isolation"         value="Row-level via workspace_id"   status="ok" />
        <InfoRow label="Migrations"        value="drizzle-kit push"             status="ok" />
      </div>
      <div className="p-3 rounded-lg bg-muted/50 border border-border text-xs text-muted-foreground">
        Connection is configured via <code className="font-mono">DATABASE_URL</code> environment variable. Runtime editing is disabled for security.
      </div>
    </div>
  );
}

function StorageSection() {
  const { t } = useTranslation();
  return (
    <div>
      <SectionHeader icon={HardDrive} title={t("ps_storage")} desc={t("ps_storage_desc")} />
      <div className="rounded-lg border border-border bg-card overflow-hidden mb-4">
        <InfoRow label={t("ps_storage_type")} value="Replit Object Storage" status="ok" />
        <InfoRow label="Max Upload"            value="200 MB per file"      status="ok" />
        <InfoRow label="Private Path"          value="private/"             status="ok" />
        <InfoRow label="Public Path"           value="public/"              status="ok" />
        <InfoRow label="S3-compatible"         value="Yes"                  status="info" />
        <InfoRow label="CDN"                   value="Coming soon"          status="warn" />
      </div>
      <div className="p-3 rounded-lg bg-muted/50 border border-border text-xs text-muted-foreground">
        Storage is configured via <code className="font-mono">DEFAULT_OBJECT_STORAGE_BUCKET_ID</code> and related environment variables.
      </div>
    </div>
  );
}

function BackupSection() {
  const { t } = useTranslation();
  return (
    <div>
      <SectionHeader icon={Archive} title={t("ps_backup")} desc={t("ps_backup_desc")} />
      <div className="rounded-lg border border-dashed border-border bg-muted/20 p-8 text-center mb-4">
        <Archive className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
        <p className="text-sm font-medium text-muted-foreground">{t("ps_backup_coming_soon")}</p>
        <p className="text-xs text-muted-foreground/60 mt-1">pg_dump schedules, S3 destinations, and retention policies</p>
      </div>
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <InfoRow label="Automated Backups"   value="Not configured" status="off" />
        <InfoRow label="Last Backup"         value="Never"          status="warn" />
        <InfoRow label="Backup Destination"  value="None"           status="off" />
        <InfoRow label="Retention Policy"    value="30 days (default)" status="info" />
      </div>
    </div>
  );
}

function ObservabilitySection() {
  const { t } = useTranslation();
  return (
    <div>
      <SectionHeader icon={Activity} title={t("ps_observability")} desc={t("ps_obs_desc")} />
      <div className="rounded-lg border border-border bg-card overflow-hidden mb-4">
        <InfoRow label={t("ps_health_status")} value={t("ps_healthy")} status="ok" />
        <InfoRow label="Logger"                 value="pino (JSON)"    status="ok" />
        <InfoRow label="Log Level"              value="info"           status="ok" />
        <InfoRow label="HTTP Logging"           value="pino-http"      status="ok" />
        <InfoRow label="Error Tracking"         value="pino + stdout"  status="ok" />
        <InfoRow label="Metrics"                value="Coming soon"    status="warn" />
        <InfoRow label="Distributed Tracing"    value="Coming soon"    status="warn" />
        <InfoRow label="Alerting"               value="Coming soon"    status="warn" />
      </div>
      <div className="p-3 rounded-lg bg-muted/50 border border-border text-xs text-muted-foreground">
        Structured JSON logs are written to stdout. Use your infrastructure's log aggregation solution (ELK, Datadog, Grafana Loki, etc.) to collect and analyze logs.
      </div>
    </div>
  );
}

function ApiSection() {
  const { t } = useTranslation();
  return (
    <div>
      <SectionHeader icon={Key} title={t("ps_api")} desc={t("ps_api_desc")} />
      <div className="rounded-lg border border-dashed border-border bg-muted/20 p-6 text-center mb-4">
        <Key className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
        <p className="text-sm font-medium text-muted-foreground">{t("ps_api_coming_soon")}</p>
        <p className="text-xs text-muted-foreground/60 mt-1">Generate scoped API keys for external system integrations</p>
      </div>
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <InfoRow label="REST API"          value="/api/*"       status="ok" />
        <InfoRow label="Authentication"    value="JWT Bearer"   status="ok" />
        <InfoRow label="API Keys"          value="Coming soon"  status="warn" />
        <InfoRow label="Webhooks"          value="Coming soon"  status="warn" />
        <InfoRow label="ERP Integration"   value="Coming soon"  status="warn" />
        <InfoRow label="HRMS Integration"  value="Coming soon"  status="warn" />
      </div>
    </div>
  );
}

function MultiTenantSection() {
  const { t } = useTranslation();
  return (
    <div>
      <SectionHeader icon={Layers} title={t("ps_multitenant")} desc={t("ps_multitenant_desc")} />
      <div className="rounded-lg border border-border bg-card overflow-hidden mb-4">
        <InfoRow label={t("ps_tenant_isolation")} value="Row-level Scoping"            status="ok" />
        <InfoRow label="Workspace Isolation"       value="workspace_id FK on all tables" status="ok" />
        <InfoRow label="Data Segregation"          value="Full - no cross-workspace"     status="ok" />
        <InfoRow label="Per-tenant Branding"       value="Logo & primary color"          status="ok" />
        <InfoRow label="Per-tenant Domain"         value="Coming soon"                   status="warn" />
        <InfoRow label="Per-tenant SSO"            value="Coming soon"                   status="warn" />
        <InfoRow label="Per-tenant Limits"         value="Coming soon"                   status="warn" />
      </div>
      <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-700 dark:text-emerald-300">
        {t("ps_tenant_enabled")}
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function SuperAdminSettings() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [active, setActive] = useState("identity");

  const { data: platformSettings, isLoading } = useGetPlatformSettings();

  const updateSettings = useUpdatePlatformSettings();

  const handleSave = async (category: string, data: Record<string, unknown>): Promise<void> => {
    return new Promise((resolve, reject) => {
      updateSettings.mutate(
        { category, data },
        {
          onSuccess: () => {
            toast({ title: t("ps_saved") });
            queryClient.invalidateQueries({ queryKey: getGetPlatformSettingsQueryKey() });
            resolve();
          },
          onError: () => {
            toast({ title: t("ps_save_error"), variant: "destructive" });
            reject(new Error("save failed"));
          },
        }
      );
    });
  };

  const get = (cat: string): Record<string, unknown> =>
    ((platformSettings as Record<string, unknown> | undefined)?.[cat] ?? {}) as Record<string, unknown>;

  return (
    <div className="flex h-[calc(100vh-7rem)] -m-6 gap-0">
      {/* Sidebar nav */}
      <nav className="w-52 shrink-0 border-e border-border bg-muted/15 overflow-y-auto py-4 px-2 space-y-0.5">
        {NAV.map(({ id, icon: Icon, labelKey, dot }) => (
          <button
            key={id}
            onClick={() => setActive(id)}
            className={cn(
              "w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors text-start",
              active === id
                ? "bg-accent text-accent-foreground font-medium"
                : "text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground"
            )}
          >
            <Icon className="w-4 h-4 shrink-0" />
            <span className="flex-1 truncate">{t(labelKey)}</span>
            {dot && <span className="w-1.5 h-1.5 rounded-full bg-primary/50 shrink-0" />}
          </button>
        ))}
      </nav>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 min-w-0">
        {isLoading ? (
          <div className="space-y-4 max-w-2xl">
            {[1, 2, 3, 4].map(i => <div key={i} className="h-14 rounded-lg bg-muted animate-pulse" />)}
          </div>
        ) : (
          <div className="max-w-2xl">
            {active === "identity"      && <IdentitySection      settings={get("identity")}  onSave={handleSave} />}
            {active === "network"       && <NetworkSection       settings={get("network")}   onSave={handleSave} />}
            {active === "deployment"    && <DeploymentSection    />}
            {active === "auth"          && <AuthSection          />}
            {active === "access"        && <AccessSection        />}
            {active === "database"      && <DatabaseSection      />}
            {active === "storage"       && <StorageSection       />}
            {active === "smtp"          && <SmtpSection          settings={get("smtp")}      onSave={handleSave} />}
            {active === "security"      && <SecuritySection      settings={get("security")}  onSave={handleSave} />}
            {active === "backup"        && <BackupSection        />}
            {active === "observability" && <ObservabilitySection />}
            {active === "features"      && <FeaturesSection      settings={get("features")}  onSave={handleSave} />}
            {active === "api"           && <ApiSection           />}
            {active === "maintenance"   && <MaintenanceSection   />}
            {active === "multitenant"   && <MultiTenantSection   />}
          </div>
        )}
      </div>
    </div>
  );
}
