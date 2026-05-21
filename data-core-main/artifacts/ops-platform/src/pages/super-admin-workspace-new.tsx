import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { useCreateWorkspace } from "@workspace/api-client-react";
import { ArrowLeft, Building2, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { getListWorkspacesQueryKey } from "@workspace/api-client-react";

function slugify(val: string) {
  return val
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

export default function SuperAdminWorkspaceNew() {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createWorkspace = useCreateWorkspace();

  const [form, setForm] = useState({
    name: "",
    slug: "",
    logoUrl: "",
    primaryColor: "#3b82f6",
    adminEmail: "",
    adminFullName: "",
    adminEmployeeNumber: "",
    adminPassword: "",
  });
  const [slugManual, setSlugManual] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setForm((prev) => {
      const next = { ...prev, [key]: val };
      if (key === "name" && !slugManual) {
        next.slug = slugify(val);
      }
      return next;
    });
    setErrors((prev) => ({ ...prev, [key]: "" }));
  };

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = t("company_name_required");
    if (!form.slug.trim()) errs.slug = t("slug_required");
    else if (!/^[a-z0-9-]+$/.test(form.slug)) errs.slug = t("slug_invalid");
    if (!form.adminEmail.trim()) errs.adminEmail = t("admin_email_required");
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.adminEmail)) errs.adminEmail = t("invalid_email");
    if (!form.adminFullName.trim()) errs.adminFullName = t("admin_name_required");
    if (!form.adminEmployeeNumber.trim()) errs.adminEmployeeNumber = t("employee_number_required");
    if (!form.adminPassword) errs.adminPassword = t("password_required");
    else if (form.adminPassword.length < 8) errs.adminPassword = t("password_too_short_desc");
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    createWorkspace.mutate(
      {
        data: {
          name: form.name.trim(),
          slug: form.slug.trim(),
          logoUrl: form.logoUrl.trim() || null,
          primaryColor: form.primaryColor || null,
          adminEmail: form.adminEmail.trim(),
          adminFullName: form.adminFullName.trim(),
          adminEmployeeNumber: form.adminEmployeeNumber.trim(),
          adminPassword: form.adminPassword,
        },
      },
      {
        onSuccess: (data) => {
          toast({
            title: t("workspace_created"),
            description: `"${data.name}" - ${form.adminEmail}`,
          });
          queryClient.invalidateQueries({ queryKey: getListWorkspacesQueryKey() });
          navigate(`/super-admin/workspaces/${data.id}`);
        },
        onError: (err: any) => {
          toast({ title: t("error"), description: err?.message, variant: "destructive" });
        },
      }
    );
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/super-admin/workspaces">
            <ArrowLeft className="w-4 h-4 mr-1" /> {t("back")}
          </Link>
        </Button>
      </div>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("create_workspace_title")}</h1>
        <p className="text-muted-foreground text-sm mt-1">{t("create_workspace_subtitle")}</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="w-4 h-4" /> {t("workspace_details")}
            </CardTitle>
            <CardDescription>{t("workspace_details_desc")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="name">{t("company_name")} <span className="text-destructive">*</span></Label>
              <Input id="name" placeholder="Acme Corporation" value={form.name} onChange={set("name")} />
              {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="slug">{t("workspace_slug")} <span className="text-destructive">*</span></Label>
              <Input
                id="slug" placeholder="acme-corp" value={form.slug}
                onChange={(e) => { setSlugManual(true); set("slug")(e); }}
                className="font-mono"
              />
              {form.slug && !errors.slug && (
                <p className="text-xs text-muted-foreground">
                  {t("workspace_url_preview")}: <span className="font-mono">{form.slug}.platform.com</span>
                </p>
              )}
              {errors.slug && <p className="text-xs text-destructive">{errors.slug}</p>}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="logoUrl">{t("logo_url_optional")}</Label>
                <Input id="logoUrl" placeholder="https://..." value={form.logoUrl} onChange={set("logoUrl")} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="primaryColor">{t("brand_color")}</Label>
                <div className="flex items-center gap-2">
                  <input
                    type="color" id="primaryColor" value={form.primaryColor} onChange={set("primaryColor")}
                    className="w-10 h-9 rounded border border-input cursor-pointer p-1"
                  />
                  <Input value={form.primaryColor} onChange={set("primaryColor")} className="font-mono flex-1" placeholder="#3b82f6" />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("first_admin_account")}</CardTitle>
            <CardDescription>{t("first_admin_desc")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="adminFullName">{t("full_name")} <span className="text-destructive">*</span></Label>
              <Input id="adminFullName" placeholder="Jane Smith" value={form.adminFullName} onChange={set("adminFullName")} />
              {errors.adminFullName && <p className="text-xs text-destructive">{errors.adminFullName}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="adminEmail">{t("email_address")} <span className="text-destructive">*</span></Label>
              <Input id="adminEmail" type="email" placeholder="jane@acme.com" value={form.adminEmail} onChange={set("adminEmail")} />
              {errors.adminEmail && <p className="text-xs text-destructive">{errors.adminEmail}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="adminEmployeeNumber">{t("employee_number")} <span className="text-destructive">*</span></Label>
              <Input
                id="adminEmployeeNumber"
                placeholder={t("employee_number_placeholder")}
                value={form.adminEmployeeNumber}
                onChange={set("adminEmployeeNumber")}
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">{t("employee_number_hint")}</p>
              {errors.adminEmployeeNumber && <p className="text-xs text-destructive">{errors.adminEmployeeNumber}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="adminPassword">{t("password_label")} <span className="text-destructive">*</span></Label>
              <div className="relative">
                <Input
                  id="adminPassword" type={showPassword ? "text" : "password"}
                  placeholder={t("min_8_chars")} value={form.adminPassword}
                  onChange={set("adminPassword")} className="pr-10"
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {errors.adminPassword && <p className="text-xs text-destructive">{errors.adminPassword}</p>}
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center justify-end gap-3">
          <Button variant="outline" asChild>
            <Link href="/super-admin/workspaces">{t("cancel")}</Link>
          </Button>
          <Button type="submit" disabled={createWorkspace.isPending}>
            {createWorkspace.isPending ? t("creating") : t("create_workspace_btn")}
          </Button>
        </div>
      </form>
    </div>
  );
}
