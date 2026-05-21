import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import {
  useListHrServices,
  useListHrCategories,
  useUpdateHrService,
  useDeleteHrService,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Plus, Search, Pencil, Trash2, ToggleLeft, ToggleRight,
  ClipboardList, Settings2, FileText, type LucideIcon,
  ChevronLeft, Plane, HeartPulse, Award, Wrench, RefreshCw,
  UserCheck, Package, Briefcase, Tag, Zap,
} from "lucide-react";

const ICON_MAP: Record<string, LucideIcon> = {
  FileText, Plane, HeartPulse, Award, Wrench, RefreshCw,
  UserCheck, Package, ClipboardList, Briefcase, Tag,
};

function StatusBadge({ status }: { status: string }) {
  if (status === "active")   return <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border-0">Active</Badge>;
  if (status === "inactive") return <Badge className="bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 border-0">Inactive</Badge>;
  if (status === "archived") return <Badge variant="outline" className="text-xs">Archived</Badge>;
  return <Badge variant="secondary">{status}</Badge>;
}

export default function HrServicesAdminPage() {
  const { i18n } = useTranslation();
  const isAr = i18n.language.startsWith("ar");
  const { toast } = useToast();

  const [search, setSearch]           = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [catFilter, setCatFilter]       = useState("all");

  const { data: services, isLoading, refetch } = useListHrServices(
    statusFilter !== "all" ? { status: statusFilter } : {},
  );

  // Dynamic categories
  const { data: categoriesRaw = [] } = useListHrCategories();
  const categories = categoriesRaw as any[];

  const catMap = useMemo(() => {
    const m: Record<string, { name: string; nameAr?: string; color: string }> = {};
    categories.forEach((c) => {
      m[c.slug] = { name: c.name, nameAr: c.nameAr, color: c.color ?? "#6366f1" };
    });
    return m;
  }, [categories]);

  function catLabel(slug: string) {
    const c = catMap[slug];
    if (!c) return slug;
    return isAr && c.nameAr ? c.nameAr : c.name;
  }

  const updateMutation = useUpdateHrService();
  const deleteMutation = useDeleteHrService();

  const filtered = (services ?? []).filter((s: any) => {
    const q = search.toLowerCase();
    if (q && !s.name.toLowerCase().includes(q) && !(s.category ?? "").includes(q)) return false;
    if (catFilter !== "all" && s.category !== catFilter) return false;
    return true;
  });

  function toggleStatus(svc: any) {
    const newStatus = svc.status === "active" ? "inactive" : "active";
    updateMutation.mutate(
      { id: svc.id, data: { status: newStatus } },
      {
        onSuccess: () => {
          toast({ title: isAr ? (newStatus === "active" ? "تم تفعيل الخدمة" : "تم إيقاف الخدمة") : `Service ${newStatus === "active" ? "activated" : "deactivated"}` });
          refetch();
        },
        onError: () => toast({ title: isAr ? "فشلت العملية" : "Failed to update service", variant: "destructive" }),
      }
    );
  }

  function handleDelete(id: number) {
    deleteMutation.mutate(
      { id },
      {
        onSuccess: () => { toast({ title: isAr ? "تم حذف الخدمة" : "Service deleted" }); refetch(); },
        onError: () => toast({ title: isAr ? "فشل الحذف" : "Failed to delete service", variant: "destructive" }),
      }
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/hr">
            <button className="p-1 rounded-md hover:bg-accent transition-colors text-muted-foreground hover:text-foreground">
              <ChevronLeft className="w-5 h-5" />
            </button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Settings2 className="w-6 h-6 text-primary" />
              {isAr ? "إدارة خدمات الموارد البشرية" : "HR Service Management"}
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {isAr ? "إنشاء وإدارة خدمات الموارد البشرية المتاحة للموظفين" : "Create and manage HR services available to employees"}
            </p>
          </div>
        </div>
        <Button asChild>
          <Link href="/admin/hr/services/new">
            <Plus className="w-4 h-4 mr-2" />
            {isAr ? "خدمة جديدة" : "New Service"}
          </Link>
        </Button>
      </div>

      {/* Info banner */}
      <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 px-4 py-3 text-sm text-blue-800 dark:text-blue-300">
        {isAr
          ? "الخدمات النشطة تظهر للموظفين في بوابة الخدمات. كل خدمة تُولّد أحداث سير عمل تلقائياً وقالب سير عمل مسودة."
          : "Active services are visible to employees in the services portal. Each service auto-generates workflow events and a draft workflow template."}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder={isAr ? "بحث..." : "Search services..."}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Dynamic category filter */}
        {categories.length > 0 && (
          <Select value={catFilter} onValueChange={setCatFilter}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder={isAr ? "التصنيف" : "Category"} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{isAr ? "كل التصنيفات" : "All Categories"}</SelectItem>
              {categories.map((c: any) => (
                <SelectItem key={c.slug} value={c.slug}>
                  <span className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: c.color }} />
                    {isAr && c.nameAr ? c.nameAr : c.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{isAr ? "كل الحالات" : "All Statuses"}</SelectItem>
            <SelectItem value="active">{isAr ? "نشط" : "Active"}</SelectItem>
            <SelectItem value="inactive">{isAr ? "غير نشط" : "Inactive"}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Summary row */}
      {!isLoading && (
        <div className="flex items-center gap-4 text-sm text-muted-foreground px-1">
          <span>{filtered.length} {isAr ? "خدمة" : filtered.length === 1 ? "service" : "services"}</span>
          {categories.length > 0 && (
            <span>·  {categories.length} {isAr ? "تصنيف" : categories.length === 1 ? "category" : "categories"}</span>
          )}
        </div>
      )}

      {/* Services list */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}><CardContent className="p-4"><Skeleton className="h-16 w-full" /></CardContent></Card>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Settings2 className="w-12 h-12 text-muted-foreground/30 mb-4" />
            <p className="text-muted-foreground">
              {search || catFilter !== "all"
                ? (isAr ? "لا توجد نتائج" : "No services match your filters")
                : (isAr ? "لا توجد خدمات بعد" : "No services yet")}
            </p>
            {!search && catFilter === "all" && (
              <Button asChild className="mt-4">
                <Link href="/admin/hr/services/new">
                  <Plus className="w-4 h-4 mr-2" />
                  {isAr ? "إنشاء أول خدمة" : "Create your first service"}
                </Link>
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((svc: any) => {
            const ServiceIcon = ICON_MAP[svc.icon] ?? FileText;
            const catInfo = catMap[svc.category];
            return (
              <Card key={svc.id} className="hover:shadow-sm transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-center gap-4">
                    {/* Icon */}
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                      style={catInfo
                        ? { backgroundColor: `${catInfo.color}20`, color: catInfo.color }
                        : undefined}
                    >
                      {!catInfo && <div className="w-10 h-10 rounded-xl bg-primary/10 absolute" />}
                      <ServiceIcon className="w-5 h-5" />
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-sm">{svc.name}</p>
                        <StatusBadge status={svc.status} />
                        {svc.category && (
                          <Badge
                            variant="outline"
                            className="text-xs gap-1"
                            style={catInfo ? { borderColor: `${catInfo.color}50`, color: catInfo.color } : undefined}
                          >
                            {catInfo && (
                              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: catInfo.color }} />
                            )}
                            {catLabel(svc.category)}
                          </Badge>
                        )}
                      </div>
                      {svc.description && (
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">{svc.description}</p>
                      )}
                      <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                        {svc.formName ? (
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <FileText className="w-3 h-3" />
                            {svc.formName}
                          </span>
                        ) : (
                          <span className="text-xs text-amber-600 dark:text-amber-400">
                            {isAr ? "لا يوجد نموذج" : "No form linked"}
                          </span>
                        )}
                        {svc.workflowEvent && (
                          <span className="text-xs text-muted-foreground font-mono flex items-center gap-1">
                            <Zap className="w-3 h-3 text-primary/60" />
                            {svc.workflowEvent}
                          </span>
                        )}
                        {svc.settings?.requestStatuses?.length > 0 && (
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            {svc.settings.requestStatuses.map((s: any) => (
                              <span
                                key={s.key}
                                className="w-2 h-2 rounded-full shrink-0"
                                title={s.label}
                                style={{ backgroundColor: s.color }}
                              />
                            ))}
                            {svc.settings.requestStatuses.length} {isAr ? "حالة" : "statuses"}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => toggleStatus(svc)}
                        disabled={updateMutation.isPending}
                        className="p-2 rounded-md hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
                        title={svc.status === "active"
                          ? (isAr ? "إيقاف" : "Deactivate")
                          : (isAr ? "تفعيل" : "Activate")}
                      >
                        {svc.status === "active"
                          ? <ToggleRight className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                          : <ToggleLeft className="w-5 h-5" />}
                      </button>

                      <Button variant="ghost" size="icon" asChild>
                        <Link href={`/admin/hr/services/${svc.id}`}>
                          <Pencil className="w-4 h-4" />
                        </Link>
                      </Button>

                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive">
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>{isAr ? "حذف الخدمة" : "Delete Service"}</AlertDialogTitle>
                            <AlertDialogDescription>
                              {isAr
                                ? `هل أنت متأكد من حذف "${svc.name}"؟ لا يمكن التراجع عن هذا الإجراء.`
                                : `Are you sure you want to delete "${svc.name}"? This cannot be undone.`}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>{isAr ? "إلغاء" : "Cancel"}</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => handleDelete(svc.id)}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            >
                              {isAr ? "حذف" : "Delete"}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
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
