import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { useListHrServices, useListHrCategories } from "@workspace/api-client-react";
import { usePermissions } from "@/hooks/use-permissions";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Search, ChevronRight, ClipboardList, Settings2, FileText, Plane,
  HeartPulse, Award, Wrench, RefreshCw, UserCheck, Package,
  Briefcase, Tag, type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const ICON_MAP: Record<string, LucideIcon> = {
  FileText, Plane, HeartPulse, Award, Wrench, RefreshCw,
  UserCheck, Package, ClipboardList, Briefcase, Tag,
};

// Fallback colors for categories that don't have a stored color
const FALLBACK_ICON_COLORS = [
  "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  "bg-teal-500/10 text-teal-600 dark:text-teal-400",
  "bg-rose-500/10 text-rose-600 dark:text-rose-400",
  "bg-slate-500/10 text-slate-600 dark:text-slate-400",
];

export default function HrServicesPage() {
  const { i18n } = useTranslation();
  const isAr = i18n.language.startsWith("ar");
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("admin") || hasPermission("hr.manage");

  const [search, setSearch]     = useState("");
  const [catFilter, setCatFilter] = useState("all");

  const { data: services, isLoading } = useListHrServices(
    catFilter !== "all" ? { category: catFilter } : {},
  );

  // Dynamic categories from API
  const { data: categoriesRaw = [] } = useListHrCategories();
  const categories = categoriesRaw as any[];

  // Build a lookup: slug → { name, nameAr, color }
  const catMap = useMemo(() => {
    const m: Record<string, { name: string; nameAr?: string; color: string; order: number }> = {};
    categories.forEach((c, i) => {
      m[c.slug] = { name: c.name, nameAr: c.nameAr, color: c.color ?? "#6366f1", order: i };
    });
    return m;
  }, [categories]);

  function catLabel(slug: string) {
    const c = catMap[slug];
    if (!c) return slug;
    return isAr && c.nameAr ? c.nameAr : c.name;
  }

  function catIconColor(slug: string, idx: number) {
    const c = catMap[slug];
    if (!c) return FALLBACK_ICON_COLORS[idx % FALLBACK_ICON_COLORS.length];
    // Convert hex color to an inline style instead of a Tailwind class
    return null; // signal to use inline style
  }

  const filtered = (services ?? []).filter((s: any) => {
    if (!search) return true;
    const q = search.toLowerCase();
    const name = (isAr && s.nameAr ? s.nameAr : s.name).toLowerCase();
    return name.includes(q) || (s.category ?? "").includes(q) || (s.description ?? "").toLowerCase().includes(q);
  });

  // Group by category slug
  const grouped = filtered.reduce<Record<string, any[]>>((acc, svc: any) => {
    const cat = svc.category ?? "other";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(svc);
    return acc;
  }, {});

  // Sort categories: known (by displayOrder) first, then unknown alphabetically
  const groupedKeys = Object.keys(grouped).sort((a, b) => {
    const oa = catMap[a]?.order ?? 999;
    const ob = catMap[b]?.order ?? 999;
    if (oa !== ob) return oa - ob;
    return a.localeCompare(b);
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ClipboardList className="w-6 h-6 text-primary" />
            {isAr ? "خدمات الموظفين" : "Employee Services"}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {isAr ? "تقديم الطلبات والخدمات الإدارية" : "Submit requests and HR services"}
          </p>
        </div>
        {isAdmin && (
          <Link href="/admin/hr/services">
            <button className="flex items-center gap-2 text-sm px-3 py-2 rounded-md border border-border hover:bg-accent transition-colors">
              <Settings2 className="w-4 h-4" />
              {isAr ? "إدارة الخدمات" : "Manage Services"}
            </button>
          </Link>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder={isAr ? "بحث في الخدمات..." : "Search services..."}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={catFilter} onValueChange={setCatFilter}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder={isAr ? "التصنيف" : "Category"} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{isAr ? "كل التصنيفات" : "All Categories"}</SelectItem>
            {categories.map((c: any) => (
              <SelectItem key={c.slug} value={c.slug}>
                <span className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: c.color }} />
                  {isAr && c.nameAr ? c.nameAr : c.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Services */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}><CardContent className="p-5"><Skeleton className="h-24 w-full" /></CardContent></Card>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <ClipboardList className="w-14 h-14 text-muted-foreground/30 mb-4" />
          <p className="text-lg font-medium text-muted-foreground">
            {search || catFilter !== "all"
              ? (isAr ? "لا توجد خدمات مطابقة" : "No matching services")
              : (isAr ? "لا توجد خدمات متاحة" : "No services available yet")}
          </p>
          {isAdmin && !search && catFilter === "all" && (
            <Link href="/admin/hr/services">
              <button className="mt-3 text-sm text-primary hover:underline flex items-center gap-1">
                <Settings2 className="w-4 h-4" />
                {isAr ? "أنشئ خدمة جديدة" : "Create your first service"}
              </button>
            </Link>
          )}
        </div>
      ) : (
        <div className="space-y-8">
          {groupedKeys.map((cat, catIdx) => {
            const catInfo = catMap[cat];
            return (
              <div key={cat}>
                <div className="flex items-center gap-2 mb-3">
                  {catInfo && (
                    <span
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: catInfo.color }}
                    />
                  )}
                  <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                    {catLabel(cat)}
                  </h2>
                  <span className="text-xs text-muted-foreground/60">({grouped[cat].length})</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                  {grouped[cat].map((svc: any) => {
                    const ServiceIcon = ICON_MAP[svc.icon] ?? FileText;
                    const name = isAr && svc.nameAr ? svc.nameAr : svc.name;
                    const desc = isAr && svc.descriptionAr ? svc.descriptionAr : svc.description;
                    // Use the category's stored color for the icon bg
                    const iconBgColor = catInfo?.color ?? "#6366f1";
                    return (
                      <Link key={svc.id} href={svc.formId ? `/forms/${svc.formId}` : "#"}>
                        <Card className={cn("hover:shadow-md transition-all cursor-pointer group", !svc.formId && "opacity-70")}>
                          <CardContent className="p-5">
                            <div className="flex items-start gap-4">
                              <div
                                className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
                                style={{ backgroundColor: `${iconBgColor}20`, color: iconBgColor }}
                              >
                                <ServiceIcon className="w-6 h-6" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-2">
                                  <p className="font-semibold text-sm">{name}</p>
                                  <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
                                </div>
                                {desc && (
                                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{desc}</p>
                                )}
                                {!svc.formId && (
                                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                                    {isAr ? "النموذج غير مرتبط" : "No form linked"}
                                  </p>
                                )}
                                {(svc.settings?.requiresApproval) && (
                                  <Badge variant="outline" className="mt-2 text-xs">
                                    {isAr ? "يتطلب موافقة" : "Requires approval"}
                                  </Badge>
                                )}
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
