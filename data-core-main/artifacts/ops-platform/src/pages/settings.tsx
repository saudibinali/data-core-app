import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useTheme } from "@/components/theme-provider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LogOut, Monitor, Moon, Sun, Building2, Globe, Layers, Plug } from "lucide-react";
import { Link } from "wouter";
import {
  useGetMe, useGetMyWorkspace, getGetMyWorkspaceQueryKey, useUpdateMyWorkspace,
  useListModules, useUpdateModule, getListModulesQueryKey,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

export default function SettingsPage() {
  const { signOut, user: authUser } = useAppAuth();
  const { t, i18n } = useTranslation();


  const { theme, setTheme } = useTheme();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: currentUser } = useGetMe();
  const userRole = currentUser?.role ?? authUser?.role ?? "";
  const isAdmin = userRole === "admin" || userRole === "super_admin";
  const isWorkspaceAdmin = userRole === "admin";

  const { data: workspace } = useGetMyWorkspace({ query: { enabled: isAdmin, queryKey: getGetMyWorkspaceQueryKey() } });
  const updateWorkspace = useUpdateMyWorkspace();

  const [workspaceName, setWorkspaceName] = useState("");
  const [primaryColor, setPrimaryColor] = useState("");

  const handleSaveWorkspace = () => {
    const updates: Record<string, string | null> = {};
    if (workspaceName.trim()) updates.name = workspaceName.trim();
    if (primaryColor.trim()) updates.primaryColor = primaryColor.trim();
    if (Object.keys(updates).length === 0) return;

    updateWorkspace.mutate({ data: updates }, {
      onSuccess: () => {
        toast({ title: t("save_changes") });
        queryClient.invalidateQueries({ queryKey: ["/api/workspaces/me"] });
        setWorkspaceName("");
        setPrimaryColor("");
      },
      onError: () => toast({ title: t("error"), description: t("failed_update_workspace"), variant: "destructive" }),
    });
  };

  const currentLang = i18n.language.startsWith("ar") ? "ar" : "en";

  return (
    <div className="space-y-6 max-w-2xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">{t("settings")}</h2>
        <p className="text-muted-foreground">{t("manage_preferences")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("profile")}</CardTitle>
          <CardDescription>{t("profile_desc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center gap-4">
            <img
              src={authUser?.avatarUrl || `https://api.dicebear.com/7.x/initials/svg?seed=${authUser?.fullName}`}
              className="w-16 h-16 rounded-full border shadow-sm"
              alt="Profile"
            />
            <div>
              <p className="font-medium text-lg">{authUser?.fullName}</p>
              <p className="text-muted-foreground text-sm">{authUser?.email ?? ""}</p>
              {userRole && (
                <p className="text-xs text-muted-foreground mt-0.5 capitalize">
                  {t("role")}: <span className="font-medium">{userRole.replace("_", " ")}</span>
                </p>
              )}
            </div>
          </div>

          <Button variant="destructive" onClick={() => signOut()}>
            <LogOut className="w-4 h-4 me-2" /> {t("sign_out")}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("preferences")}</CardTitle>
          <CardDescription>{t("preferences_desc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5 flex-1">
              <label className="text-sm font-medium">{t("appearance")}</label>
              <p className="text-xs text-muted-foreground">{t("appearance_desc")}</p>
            </div>
            <Select value={theme} onValueChange={(val: any) => setTheme(val)}>
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="light">
                  <div className="flex items-center gap-2"><Sun className="w-4 h-4" /> {t("theme_light")}</div>
                </SelectItem>
                <SelectItem value="dark">
                  <div className="flex items-center gap-2"><Moon className="w-4 h-4" /> {t("theme_dark")}</div>
                </SelectItem>
                <SelectItem value="system">
                  <div className="flex items-center gap-2"><Monitor className="w-4 h-4" /> {t("theme_system")}</div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5 flex-1">
              <label className="text-sm font-medium flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5 text-muted-foreground" />
                {t("language")}
              </label>
              <p className="text-xs text-muted-foreground">{t("language_desc")}</p>
            </div>
            <Select value={currentLang} onValueChange={(val) => i18n.changeLanguage(val)}>
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">{t("lang_en")}</SelectItem>
                <SelectItem value="ar">{t("lang_ar")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {isWorkspaceAdmin && workspace && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="w-4 h-4" /> {t("workspace_settings")}
            </CardTitle>
            <CardDescription>
              {t("workspace_settings_desc", { name: workspace.name })}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>{t("workspace_name")}</Label>
                <Input
                  placeholder={workspace.name}
                  value={workspaceName}
                  onChange={(e) => setWorkspaceName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("primary_color")}</Label>
                <Input
                  placeholder={workspace.primaryColor ?? "e.g. #3b82f6"}
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                />
              </div>
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-border">
              <div className="text-xs text-muted-foreground">
                <code className="font-mono">{workspace.slug}</code> · {workspace.userCount} {t("members_label")}
              </div>
              <Button
                size="sm"
                onClick={handleSaveWorkspace}
                disabled={(!workspaceName.trim() && !primaryColor.trim()) || updateWorkspace.isPending}
              >
                {updateWorkspace.isPending ? t("saving") : t("save_changes")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isWorkspaceAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Plug className="w-4 h-4" />
              {i18n.language.startsWith("ar") ? "التكاملات الخارجية" : "External integrations"}
            </CardTitle>
            <CardDescription>
              {i18n.language.startsWith("ar")
                ? "ربط الحضور، البريد، والأنظمة الخارجية."
                : "Connect attendance, email, and external systems."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" size="sm" asChild>
              <Link href="/admin/integrations">
                {i18n.language.startsWith("ar") ? "فتح مركز التكاملات" : "Open integration hub"}
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {isWorkspaceAdmin && <ModulesCard />}
      {!isWorkspaceAdmin && authUser?.workspaceId && <ModulesAccessNotice role={userRole} />}
    </div>
  );
}

function ModulesAccessNotice({ role }: { role: string }) {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language.startsWith("ar");

  return (
    <Card className="border-dashed">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Layers className="w-4 h-4" /> {t("platform_modules")}
        </CardTitle>
        <CardDescription>
          {isAr
            ? "تفعيل وحدات HCM (الموارد البشرية، الرواتب، التقارير، …) يظهر هنا فقط لمدير مساحة العمل (دور admin)."
            : "HCM module toggles (HR, payroll, report center, …) are only available to the workspace admin (admin role)."}
        </CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground space-y-2">
        <p>
          {isAr ? "دورك الحالي:" : "Your current role:"}{" "}
          <span className="font-medium text-foreground">{role || "—"}</span>
        </p>
        <p>
          {isAr
            ? "اطلب من مستخدم بدور admin فتح الإعدادات وتفعيل «الموارد البشرية» و«الرواتب» ضمن «وحدات المنصة»."
            : "Ask a user with the admin role to open Settings and enable HR and Payroll under Platform Modules."}
        </p>
      </CardContent>
    </Card>
  );
}

const CATEGORY_ORDER = [
  "core", "hcm", "operations", "communication", "productivity", "organization", "administration",
];

function ModulesCard() {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: modules, isLoading } = useListModules();
  const updateModule = useUpdateModule();

  const grouped = (modules ?? []).reduce<Record<string, typeof modules>>((acc, m) => {
    (acc[m.category] = acc[m.category] ?? []).push(m);
    return acc;
  }, {});

  const categories = CATEGORY_ORDER.filter((c) => grouped[c]?.length);

  function handleToggle(key: string, enabled: boolean, isCore: boolean) {
    if (isCore) return;
    updateModule.mutate(
      { key, data: { enabled } },
      {
        onSuccess: () => {
          toast({ title: t("module_toggle_success") });
          queryClient.invalidateQueries({ queryKey: getListModulesQueryKey() });
        },
        onError: () =>
          toast({ title: t("module_toggle_error"), variant: "destructive" }),
      }
    );
  }

  function categoryLabel(cat: string) {
    const key = `module_category_${cat}` as any;
    return t(key, cat);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Layers className="w-4 h-4" /> {t("platform_modules")}
        </CardTitle>
        <CardDescription>{t("platform_modules_desc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-14 rounded-lg bg-muted animate-pulse" />
            ))}
          </div>
        ) : categories.length === 0 ? (
          <p className="text-sm text-muted-foreground px-1">
            {i18n.language.startsWith("ar")
              ? "لا توجد وحدات في الكتالوج — تأكد من تشغيل seed للمنصة (platform_modules)."
              : "No modules in catalog — ensure platform module seed has run (platform_modules)."}
          </p>
        ) : (
          categories.map((cat) => (
            <div key={cat}>
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/60 mb-2 px-1">
                {categoryLabel(cat)}
              </p>
              <div className="space-y-1">
                {(grouped[cat] ?? []).map((m) => {
                  const label = i18n.language.startsWith("ar") ? m.nameAr : m.name;
                  const desc = i18n.language.startsWith("ar") ? m.descriptionAr : m.description;
                  return (
                    <div
                      key={m.key}
                      className="flex items-center justify-between gap-4 px-3 py-2.5 rounded-lg border border-border bg-card hover:bg-muted/30 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{label}</span>
                          {m.core && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-semibold uppercase tracking-wide">
                              {t("module_core_badge")}
                            </span>
                          )}
                        </div>
                        {desc && (
                          <p className="text-xs text-muted-foreground truncate mt-0.5">{desc}</p>
                        )}
                      </div>
                      <Switch
                        checked={m.enabled}
                        onCheckedChange={(val) => handleToggle(m.key, val, m.core)}
                        disabled={m.core || updateModule.isPending}
                        title={m.core ? t("module_core_tooltip") : undefined}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
