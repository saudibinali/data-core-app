import { useState } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import {
  useListForms,
} from "@workspace/api-client-react";
import { usePermissions } from "@/hooks/use-permissions";
import {
  ClipboardList, Plus, Search, ChevronRight,
  FileText, CheckCircle2, Archive, Edit,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const MODULE_COLORS: Record<string, string> = {
  hr:        "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300",
  tickets:   "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  approvals: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  system:    "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300",
  forms:     "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
};

function StatusBadge({ status }: { status: string }) {
  if (status === "active")
    return <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border-0">Active</Badge>;
  if (status === "draft")
    return <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border-0">Draft</Badge>;
  return <Badge variant="secondary">Archived</Badge>;
}

export default function FormsPage() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language.startsWith("ar");
  const { hasPermission } = usePermissions();
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [moduleFilter, setModuleFilter] = useState<string>("all");

  const { data: forms, isLoading } = useListForms(
    moduleFilter !== "all" ? { module: moduleFilter } : {},
  );

  const filtered = (forms ?? []).filter((f) => {
    if (!search) return true;
    const q = search.toLowerCase();
    const name = (isAr && f.nameAr ? f.nameAr : f.name).toLowerCase();
    return name.includes(q) || (f.module ?? "").includes(q) || (f.category ?? "").includes(q);
  });

  const isAdmin = hasPermission("admin") || hasPermission("forms.manage");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <ClipboardList className="w-6 h-6 text-primary" />
            {isAr ? "النماذج" : "Forms"}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {isAr ? "تصفح النماذج المتاحة وتقديمها" : "Browse and submit available forms"}
          </p>
        </div>
        {isAdmin && (
          <Button onClick={() => navigate("/admin/forms/new")} className="shrink-0">
            <Plus className="w-4 h-4 mr-2" />
            {isAr ? "نموذج جديد" : "New Form"}
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder={isAr ? "ابحث في النماذج..." : "Search forms..."}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={moduleFilter} onValueChange={setModuleFilter}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder={isAr ? "جميع الوحدات" : "All modules"} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{isAr ? "جميع الوحدات" : "All Modules"}</SelectItem>
            <SelectItem value="hr">HR</SelectItem>
            <SelectItem value="tickets">{isAr ? "التذاكر" : "Tickets"}</SelectItem>
            <SelectItem value="approvals">{isAr ? "الموافقات" : "Approvals"}</SelectItem>
            <SelectItem value="system">{isAr ? "النظام" : "System"}</SelectItem>
          </SelectContent>
        </Select>
        {isAdmin && (
          <Button variant="outline" onClick={() => navigate("/admin/forms")} className="shrink-0">
            <Edit className="w-4 h-4 mr-2" />
            {isAr ? "إدارة النماذج" : "Manage Forms"}
          </Button>
        )}
      </div>

      {/* List */}
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-4 w-1/2 mt-1" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-10 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-16 flex flex-col items-center gap-3 text-center">
            <FileText className="w-10 h-10 text-muted-foreground/40" />
            <p className="text-muted-foreground">
              {search
                ? (isAr ? "لا توجد نتائج" : "No forms match your search")
                : (isAr ? "لا توجد نماذج متاحة" : "No forms available yet")}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((form) => {
            const name = isAr && form.nameAr ? form.nameAr : form.name;
            const desc = isAr && form.descriptionAr ? form.descriptionAr : form.description;
            const moduleColor = MODULE_COLORS[form.module ?? ""] ?? MODULE_COLORS["system"]!;
            return (
              <Card
                key={form.id}
                className="hover:shadow-md transition-shadow cursor-pointer group"
                onClick={() => navigate(`/forms/${form.id}`)}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base leading-tight">{name}</CardTitle>
                    <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 group-hover:translate-x-0.5 transition-transform" />
                  </div>
                  {desc && (
                    <CardDescription className="text-xs line-clamp-2">{desc}</CardDescription>
                  )}
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`px-1.5 py-0.5 rounded text-xs font-medium capitalize ${moduleColor}`}>
                      {form.module}
                    </span>
                    {form.category && (
                      <span className="text-xs text-muted-foreground">{form.category}</span>
                    )}
                    <span className="ml-auto text-xs text-muted-foreground">
                      {form.fieldCount ?? 0} {isAr ? "حقل" : "fields"}
                    </span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
