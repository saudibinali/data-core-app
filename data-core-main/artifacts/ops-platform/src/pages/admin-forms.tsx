import { useState } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { useListForms, useUpdateForm, useDeleteForm } from "@workspace/api-client-react";
import {
  ClipboardList, Plus, Search, ChevronRight, Pencil, Trash2,
  CheckCircle2, Archive, FileText, ToggleLeft, ToggleRight, AlertCircle,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";

function StatusBadge({ status }: { status: string }) {
  if (status === "active")   return <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 border-0">Active</Badge>;
  if (status === "draft")    return <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300 border-0">Draft</Badge>;
  if (status === "archived") return <Badge variant="secondary">Archived</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}

export default function AdminFormsPage() {
  const { i18n } = useTranslation();
  const isAr = i18n.language.startsWith("ar");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const { data: forms, isLoading, refetch } = useListForms({});
  const updateForm = useUpdateForm();
  const deleteForm = useDeleteForm();

  const filtered = (forms ?? []).filter((f) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      f.name.toLowerCase().includes(q) ||
      (f.module ?? "").toLowerCase().includes(q) ||
      (f.category ?? "").toLowerCase().includes(q)
    );
  });

  function toggleStatus(id: number, current: string) {
    const next = current === "active" ? "draft" : "active";
    updateForm.mutate(
      { id, data: { status: next } },
      {
        onSuccess: () => {
          toast({ title: next === "active" ? "Form activated" : "Form set to draft" });
          void refetch();
        },
      },
    );
  }

  function handleDelete() {
    if (!deleteId) return;
    deleteForm.mutate(
      { id: deleteId },
      {
        onSuccess: () => {
          toast({ title: "Form deleted" });
          setDeleteId(null);
          void refetch();
        },
        onError: () => {
          toast({ title: "Failed to delete", variant: "destructive" });
        },
      },
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <ClipboardList className="w-6 h-6 text-primary" />
            {isAr ? "إدارة النماذج" : "Manage Forms"}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {isAr ? "إنشاء وتحرير وإدارة نماذج المنصة" : "Create, edit and manage platform forms"}
          </p>
        </div>
        <Button onClick={() => navigate("/admin/forms/new")} className="shrink-0">
          <Plus className="w-4 h-4 mr-2" />
          {isAr ? "نموذج جديد" : "New Form"}
        </Button>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder={isAr ? "بحث..." : "Search forms..."}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 flex flex-col items-center gap-3 text-center">
              <FileText className="w-10 h-10 text-muted-foreground/40" />
              <p className="text-muted-foreground">
                {search ? (isAr ? "لا توجد نتائج" : "No results") : (isAr ? "لا توجد نماذج" : "No forms yet")}
              </p>
              {!search && (
                <Button size="sm" onClick={() => navigate("/admin/forms/new")}>
                  <Plus className="w-4 h-4 mr-2" /> {isAr ? "إنشاء أول نموذج" : "Create first form"}
                </Button>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{isAr ? "الاسم" : "Name"}</TableHead>
                  <TableHead>{isAr ? "الوحدة" : "Module"}</TableHead>
                  <TableHead>{isAr ? "الفئة" : "Category"}</TableHead>
                  <TableHead>{isAr ? "الحقول" : "Fields"}</TableHead>
                  <TableHead>{isAr ? "التقديمات" : "Submissions"}</TableHead>
                  <TableHead>{isAr ? "الحالة" : "Status"}</TableHead>
                  <TableHead>{isAr ? "تاريخ الإنشاء" : "Created"}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((form) => (
                  <TableRow
                    key={form.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => navigate(`/admin/forms/${form.id}`)}
                  >
                    <TableCell className="font-medium">
                      {isAr && form.nameAr ? form.nameAr : form.name}
                    </TableCell>
                    <TableCell>
                      <span className="text-xs font-medium capitalize bg-muted px-1.5 py-0.5 rounded">
                        {form.module}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">{form.category ?? "-"}</TableCell>
                    <TableCell className="text-sm">{form.fieldCount ?? 0}</TableCell>
                    <TableCell className="text-sm">{form.submissionCount ?? 0}</TableCell>
                    <TableCell><StatusBadge status={form.status ?? "draft"} /></TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {form.createdAt
                        ? formatDistanceToNow(new Date(form.createdAt), { addSuffix: true })
                        : "-"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          title={form.status === "active" ? "Set to draft" : "Activate"}
                          onClick={() => toggleStatus(form.id, form.status ?? "draft")}
                        >
                          {form.status === "active"
                            ? <ToggleRight className="w-4 h-4 text-emerald-500" />
                            : <ToggleLeft className="w-4 h-4 text-muted-foreground" />}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => navigate(`/admin/forms/${form.id}`)}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => setDeleteId(form.id)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Delete confirmation */}
      <AlertDialog open={deleteId !== null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{isAr ? "حذف النموذج؟" : "Delete Form?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {isAr
                ? "سيتم حذف النموذج وجميع تقديماته نهائيًا. هذا الإجراء لا يمكن التراجع عنه."
                : "This will permanently delete the form and all its submissions. This action cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{isAr ? "إلغاء" : "Cancel"}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
            >
              {isAr ? "حذف" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
