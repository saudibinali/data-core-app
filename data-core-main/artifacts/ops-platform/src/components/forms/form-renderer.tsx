import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  useGetForm,
  useSubmitForm,
  useGetFormDataSourceData,
  useLookupEmployee,
  useGetMe,
} from "@workspace/api-client-react";
import {
  Send, Save, Loader2, AlertCircle, CheckCircle2,
  Database, Upload, FileText, X, Eye, Download, CloudUpload, ClipboardList,
  UserCheck, Search, Building2, User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

// ── Types ──────────────────────────────────────────────────────────────────────

export type FieldType =
  | "text" | "textarea" | "number" | "email" | "phone"
  | "dropdown" | "checkbox" | "radio" | "date" | "time"
  | "file" | "user" | "department" | "multi_select" | "boolean"
  | "employee_lookup";

export interface FormField {
  id:            number;
  name:          string;
  label:         string;
  labelAr?:      string | null;
  type:          FieldType;
  required:      boolean;
  placeholder?:  string | null;
  placeholderAr?: string | null;
  defaultValue?: string | null;
  options?:      { value: string; label: string; labelAr?: string | null }[] | null;
  validation?:   Record<string, unknown> | null;
  conditional?:  { dependsOn: string; operator: string; value: string } | null;
  dataSource?:   { key: string; multiple?: boolean } | null;
  displayOrder:  number;
}

interface UploadedFile {
  name: string;
  size: number;
  objectPath: string;
  previewUrl: string;
}

// ── PdfUploadField ─────────────────────────────────────────────────────────────

export function PdfUploadField({
  value, onChange, error, isAr, required,
}: {
  value: unknown;
  onChange: (v: unknown) => void;
  error?: string;
  isAr: boolean;
  required: boolean;
}) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress,  setProgress]  = useState(0);
  const [previewOpen, setPreviewOpen] = useState(false);
  const uploaded = value as UploadedFile | null | undefined;

  function fmt(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!e.target.files) return;
    e.target.value = "";
    if (!file) return;

    if (file.type !== "application/pdf") {
      toast({ title: isAr ? "نوع الملف غير مدعوم" : "Unsupported file type", description: isAr ? "يُسمح بملفات PDF فقط" : "Only PDF files are allowed", variant: "destructive" });
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast({ title: isAr ? "الملف كبير جداً" : "File too large", description: isAr ? "الحد الأقصى 20 ميجابايت" : "Max 20 MB", variant: "destructive" });
      return;
    }

    setUploading(true);
    setProgress(0);
    try {
      const metaRes = await fetch("/api/storage/uploads/request-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, size: file.size, contentType: "application/pdf" }),
      });
      if (!metaRes.ok) throw new Error(`Failed to get upload URL: ${metaRes.status}`);
      const { uploadURL, objectPath } = await metaRes.json() as { uploadURL: string; objectPath: string };

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", uploadURL);
        xhr.setRequestHeader("Content-Type", "application/pdf");
        xhr.upload.onprogress = (ev) => { if (ev.lengthComputable) setProgress(Math.round((ev.loaded / ev.total) * 100)); };
        xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed: ${xhr.status}`));
        xhr.onerror = () => reject(new Error("Network error"));
        xhr.send(file);
      });

      onChange({ name: file.name, size: file.size, objectPath, previewUrl: `/api${objectPath}` });
      toast({ title: isAr ? "تم الرفع بنجاح" : "Uploaded successfully", description: file.name });
    } catch (err) {
      toast({ title: isAr ? "فشل الرفع" : "Upload failed", description: String(err), variant: "destructive" });
    } finally {
      setUploading(false);
      setProgress(0);
    }
  }

  if (uploaded?.objectPath) {
    return (
      <>
        <div className={`rounded-lg border-2 ${error ? "border-destructive" : "border-emerald-300 dark:border-emerald-700"} bg-emerald-50 dark:bg-emerald-950/30 p-4`}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-100 dark:bg-emerald-900 flex items-center justify-center shrink-0">
              <FileText className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{uploaded.name}</p>
              <p className="text-xs text-muted-foreground">{fmt(uploaded.size)}</p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => setPreviewOpen(true)}>
                <Eye className="w-4 h-4" />
              </Button>
              <a href={uploaded.previewUrl} download={uploaded.name} className="inline-flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                <Download className="w-4 h-4" />
              </a>
              <Button type="button" variant="ghost" size="icon" className="h-8 w-8 hover:text-destructive" onClick={() => onChange(null)}>
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
        <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
          <DialogContent className="max-w-4xl w-full h-[85vh] flex flex-col p-0 gap-0">
            <DialogHeader className="px-4 py-3 border-b shrink-0">
              <DialogTitle className="flex items-center gap-2 text-sm">
                <FileText className="w-4 h-4 text-primary" /> {uploaded.name}
              </DialogTitle>
            </DialogHeader>
            <iframe src={`${uploaded.previewUrl}#toolbar=1`} className="flex-1 w-full border-0" title={uploaded.name} />
          </DialogContent>
        </Dialog>
        {error && <p className="text-xs text-destructive flex items-center gap-1 mt-1"><AlertCircle className="w-3 h-3" /> {error}</p>}
      </>
    );
  }

  return (
    <>
      <div
        className={`relative rounded-lg border-2 border-dashed transition-colors cursor-pointer ${error ? "border-destructive bg-destructive/5" : "border-border hover:border-primary/50 hover:bg-primary/5"} ${uploading ? "pointer-events-none opacity-70" : ""}`}
        onClick={() => !uploading && inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const dt = e.dataTransfer;
          if (dt.files?.length) {
            const synth = { target: { files: dt.files, value: "" } } as unknown as React.ChangeEvent<HTMLInputElement>;
            handleFileSelect(synth);
          }
        }}
      >
        <input ref={inputRef} type="file" accept="application/pdf,.pdf" className="sr-only" onChange={handleFileSelect} disabled={uploading} />
        <div className="flex flex-col items-center justify-center gap-2 py-8 px-4 text-center">
          {uploading ? (
            <>
              <CloudUpload className="w-10 h-10 text-primary animate-pulse" />
              <p className="text-sm font-medium text-primary">{isAr ? "جارٍ الرفع..." : "Uploading..."}</p>
              <div className="w-full max-w-xs">
                <Progress value={progress} className="h-1.5" />
                <p className="text-xs text-muted-foreground mt-1">{progress}%</p>
              </div>
            </>
          ) : (
            <>
              <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                <Upload className="w-6 h-6 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium">{isAr ? "اسحب ملف PDF هنا أو اضغط للاختيار" : "Drag & drop a PDF or click to browse"}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{isAr ? "PDF فقط · الحد الأقصى 20 ميجابايت" : "PDF only · Max 20 MB"}</p>
              </div>
            </>
          )}
        </div>
      </div>
      {error && <p className="text-xs text-destructive flex items-center gap-1 mt-1"><AlertCircle className="w-3 h-3" /> {error}</p>}
    </>
  );
}

// ── DynamicSourceSelect ────────────────────────────────────────────────────────

export function DynamicSourceSelect({
  field, value, onChange, error, isAr,
}: {
  field: FormField;
  value: unknown;
  onChange: (v: unknown) => void;
  error?: string;
  isAr: boolean;
}) {
  const dsKey   = field.dataSource!.key;
  const multiple = field.dataSource?.multiple ?? false;
  const { data: items = [], isLoading } = useGetFormDataSourceData(dsKey);
  const label = isAr && field.labelAr ? field.labelAr : field.label;

  if (multiple) {
    const selected = Array.isArray(value) ? (value as string[]) : [];
    return (
      <div className="space-y-1.5">
        <Label className="flex items-center gap-1.5 text-sm font-medium">
          {label}
          {field.required && <span className="text-destructive">*</span>}
          <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground font-normal"><Database className="w-3 h-3" /> {isAr ? "بيانات حية" : "Live data"}</span>
        </Label>
        {isLoading ? (
          <div className="space-y-1.5">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-7 w-full" />)}</div>
        ) : items.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">{isAr ? "لا توجد عناصر" : "No items available"}</p>
        ) : (
          <div className="space-y-1.5 max-h-52 overflow-y-auto rounded-md border p-2">
            {items.map((item) => (
              <label key={item.value} className="flex items-center gap-2 cursor-pointer p-1 hover:bg-muted/50 rounded">
                <Checkbox
                  checked={selected.includes(item.value)}
                  onCheckedChange={(checked) => {
                    const next = checked ? [...selected, item.value] : selected.filter((v) => v !== item.value);
                    onChange(next);
                  }}
                />
                <span className="text-sm">{isAr && item.labelAr ? item.labelAr : item.label}</span>
              </label>
            ))}
          </div>
        )}
        {error && <p className="text-xs text-destructive flex items-center gap-1"><AlertCircle className="w-3 h-3" /> {error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-1.5 text-sm font-medium">
        {label}
        {field.required && <span className="text-destructive">*</span>}
        <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground font-normal"><Database className="w-3 h-3" /> {isAr ? "بيانات حية" : "Live data"}</span>
      </Label>
      <Select value={String(value ?? "")} onValueChange={onChange} disabled={isLoading}>
        <SelectTrigger className={error ? "border-destructive" : ""}>
          {isLoading ? <span className="flex items-center gap-2 text-muted-foreground"><Loader2 className="w-3.5 h-3.5 animate-spin" /> {isAr ? "جارٍ التحميل..." : "Loading..."}</span> : <SelectValue placeholder={isAr ? "اختر..." : "Select..."} />}
        </SelectTrigger>
        <SelectContent>
          {items.length === 0 && !isLoading && <div className="px-2 py-4 text-center text-sm text-muted-foreground">{isAr ? "لا توجد عناصر" : "No items available"}</div>}
          {items.map((item) => <SelectItem key={item.value} value={item.value}>{isAr && item.labelAr ? item.labelAr : item.label}</SelectItem>)}
        </SelectContent>
      </Select>
      {error && <p className="text-xs text-destructive flex items-center gap-1"><AlertCircle className="w-3 h-3" /> {error}</p>}
    </div>
  );
}

// ── EmployeeLookupField ────────────────────────────────────────────────────────
// Stores value as { employeeNumber, fullName, lineManagerName, departmentName, position }

interface EmployeeLookupValue {
  employeeNumber: string;
  fullName:        string;
  lineManagerName?: string | null;
  departmentName?: string | null;
  position?:       string | null;
}

export function EmployeeLookupField({
  value, onChange, error, isAr, required, readonlyEmpNumber,
}: {
  value:             unknown;
  onChange:          (v: EmployeeLookupValue | null) => void;
  error?:            string;
  isAr:              boolean;
  required:          boolean;
  readonlyEmpNumber?: boolean;
}) {
  const parsed     = value as EmployeeLookupValue | null | undefined;
  const [empNum, setEmpNum]       = useState(parsed?.employeeNumber ?? "");
  const [lookupErr, setLookupErr] = useState<string | null>(null);

  // Sync inbound value (e.g. auto-fill from parent)
  useEffect(() => {
    const incoming = (value as EmployeeLookupValue | null | undefined)?.employeeNumber ?? "";
    if (incoming && incoming !== empNum) setEmpNum(incoming);
  }, [(value as EmployeeLookupValue | null | undefined)?.employeeNumber]);

  const { data: found, isLoading, isError } = useLookupEmployee(
    { employeeNumber: empNum },
    { query: { enabled: empNum.trim().length >= 2, retry: false, queryKey: ["useLookupEmployee", empNum] } },
  );

  useEffect(() => {
    if (!empNum.trim() || empNum.trim().length < 2) {
      setLookupErr(null);
      return;
    }
    if (isError) {
      setLookupErr(isAr ? "لم يُعثر على موظف بهذا الرقم" : "No employee found with this number");
      onChange(null);
    } else if (found) {
      setLookupErr(null);
      onChange({
        employeeNumber:  found.employeeNumber,
        fullName:        found.fullName,
        lineManagerName: found.lineManagerName ?? null,
        departmentName:  found.departmentName  ?? null,
        position:        found.position        ?? null,
      });
    }
  }, [found, isError, empNum]);

  const hasResult = !!found && !isError;

  return (
    <div className="space-y-3">
      {/* Employee number input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        <Input
          type="text"
          placeholder={isAr ? "أدخل الرقم الوظيفي..." : "Enter employee number..."}
          value={empNum}
          readOnly={readonlyEmpNumber}
          onChange={(e) => {
            setEmpNum(e.target.value);
            setLookupErr(null);
          }}
          className={`pl-9 ${readonlyEmpNumber ? "bg-muted text-muted-foreground cursor-not-allowed" : ""} ${error || lookupErr ? "border-destructive" : ""}`}
        />
        {isLoading && empNum.trim().length >= 2 && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-muted-foreground" />
        )}
      </div>

      {/* Lookup error */}
      {lookupErr && (
        <p className="text-xs text-destructive flex items-center gap-1.5">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          {lookupErr}
        </p>
      )}

      {/* Employee card */}
      {hasResult && (
        <div className="rounded-xl border bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800 p-4 space-y-2.5">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-full bg-emerald-100 dark:bg-emerald-900 flex items-center justify-center shrink-0">
              <UserCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <p className="font-semibold text-sm text-emerald-900 dark:text-emerald-100">{found?.fullName}</p>
              {found?.position && <p className="text-xs text-emerald-700 dark:text-emerald-400">{found.position}</p>}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {found?.departmentName && (
              <div className="flex items-center gap-1.5 text-xs text-emerald-800 dark:text-emerald-300">
                <Building2 className="w-3 h-3 shrink-0" />
                <span className="font-medium">{isAr ? "القسم:" : "Dept:"}</span>
                <span>{found.departmentName}</span>
              </div>
            )}
            {found?.lineManagerName && (
              <div className="flex items-center gap-1.5 text-xs text-emerald-800 dark:text-emerald-300">
                <User className="w-3 h-3 shrink-0" />
                <span className="font-medium">{isAr ? "المدير المباشر:" : "Manager:"}</span>
                <span>{found.lineManagerName}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Placeholder when no number yet */}
      {!empNum.trim() && !hasResult && (
        <div className="rounded-xl border border-dashed bg-muted/30 p-4 text-center">
          <p className="text-xs text-muted-foreground">
            {isAr
              ? "أدخل الرقم الوظيفي لعرض بيانات الموظف تلقائياً"
              : "Enter an employee number to auto-fill employee details"}
          </p>
        </div>
      )}

      {error && (
        <p className="text-xs text-destructive flex items-center gap-1">
          <AlertCircle className="w-3 h-3" /> {error}
        </p>
      )}
    </div>
  );
}

// ── DynamicField ───────────────────────────────────────────────────────────────

export function DynamicField({
  field, value, onChange, error, isAr,
}: {
  field: FormField;
  value: unknown;
  onChange: (v: unknown) => void;
  error?: string;
  isAr: boolean;
}) {
  if (field.dataSource?.key) {
    return <DynamicSourceSelect field={field} value={value} onChange={onChange} error={error} isAr={isAr} />;
  }

  const label       = isAr && field.labelAr ? field.labelAr : field.label;
  const placeholder = isAr && field.placeholderAr ? field.placeholderAr : (field.placeholder ?? "");

  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-1.5 text-sm font-medium">
        {label}
        {field.required && <span className="text-destructive">*</span>}
      </Label>

      {(field.type === "text" || field.type === "email" || field.type === "phone") && (
        <Input type={field.type === "email" ? "email" : field.type === "phone" ? "tel" : "text"} placeholder={placeholder} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} className={error ? "border-destructive" : ""} />
      )}

      {field.type === "number" && (
        <Input type="number" placeholder={placeholder} value={String(value ?? "")} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : "")} className={error ? "border-destructive" : ""} min={(field.validation as Record<string, number> | null)?.["min"]} max={(field.validation as Record<string, number> | null)?.["max"]} />
      )}

      {field.type === "textarea" && (
        <Textarea placeholder={placeholder} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} rows={4} className={error ? "border-destructive" : ""} />
      )}

      {field.type === "date" && (
        <Input type="date" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} className={error ? "border-destructive" : ""} />
      )}

      {field.type === "time" && (
        <Input type="time" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} className={error ? "border-destructive" : ""} />
      )}

      {field.type === "dropdown" && (
        <Select value={String(value ?? "")} onValueChange={onChange}>
          <SelectTrigger className={error ? "border-destructive" : ""}>
            <SelectValue placeholder={placeholder || (isAr ? "اختر..." : "Select...")} />
          </SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map((opt) => <SelectItem key={opt.value} value={opt.value}>{isAr && opt.labelAr ? opt.labelAr : opt.label}</SelectItem>)}
          </SelectContent>
        </Select>
      )}

      {field.type === "radio" && (
        <div className="space-y-2">
          {(field.options ?? []).map((opt) => (
            <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name={field.name} value={opt.value} checked={value === opt.value} onChange={() => onChange(opt.value)} className="text-primary" />
              <span className="text-sm">{isAr && opt.labelAr ? opt.labelAr : opt.label}</span>
            </label>
          ))}
        </div>
      )}

      {(field.type === "checkbox" || field.type === "multi_select") && (
        <div className="space-y-2">
          {(field.options ?? []).map((opt) => {
            const vals = Array.isArray(value) ? (value as string[]) : [];
            return (
              <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                <Checkbox checked={vals.includes(opt.value)} onCheckedChange={(checked) => { const next = checked ? [...vals, opt.value] : vals.filter((v) => v !== opt.value); onChange(next); }} />
                <span className="text-sm">{isAr && opt.labelAr ? opt.labelAr : opt.label}</span>
              </label>
            );
          })}
        </div>
      )}

      {field.type === "boolean" && (
        <label className="flex items-center gap-2 cursor-pointer">
          <Checkbox checked={value === true || value === "true"} onCheckedChange={(checked) => onChange(Boolean(checked))} />
          <span className="text-sm">{label}</span>
        </label>
      )}

      {field.type === "file" && (
        <PdfUploadField value={value} onChange={onChange} error={error} isAr={isAr} required={field.required} />
      )}

      {(field.type === "user" || field.type === "department") && (
        <Input placeholder={isAr ? `اختر ${label}` : `Select ${label}...`} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} className={error ? "border-destructive" : ""} />
      )}

      {field.type === "employee_lookup" && (
        <EmployeeLookupField
          value={value}
          onChange={onChange}
          error={error}
          isAr={isAr}
          required={field.required}
        />
      )}

      {error && field.type !== "file" && field.type !== "employee_lookup" && (
        <p className="text-xs text-destructive flex items-center gap-1"><AlertCircle className="w-3 h-3" /> {error}</p>
      )}
    </div>
  );
}

// ── InlineFormDialog ───────────────────────────────────────────────────────────

export function InlineFormDialog({
  formId,
  open,
  onOpenChange,
}: {
  formId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { i18n } = useTranslation();
  const isAr = i18n.language.startsWith("ar");
  const { toast } = useToast();

  const { data: form, isLoading, error: loadError } = useGetForm(formId ?? 0, {
    query: { enabled: !!formId && open, queryKey: ["form", formId, "inline"] },
  });
  const { data: currentUser } = useGetMe({ query: { enabled: open, queryKey: ["useGetMe", "inline-form"] } });
  const submitMutation = useSubmitForm();

  const [formData,    setFormData]    = useState<Record<string, unknown>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitted,   setSubmitted]   = useState(false);

  useEffect(() => {
    if (!open) {
      setFormData({});
      setFieldErrors({});
      setSubmitted(false);
    }
  }, [open]);

  useEffect(() => {
    if (!form) return;
    const defaults: Record<string, unknown> = {};
    for (const field of (form.fields ?? [])) {
      if (field.defaultValue !== null && field.defaultValue !== undefined) {
        defaults[field.name] = field.defaultValue;
      }
      // Auto-fill employee_lookup fields with the current user's data
      if (field.type === "employee_lookup" && currentUser?.employeeNumber) {
        defaults[field.name] = {
          employeeNumber:  currentUser.employeeNumber,
          fullName:        currentUser.fullName,
          lineManagerName: (currentUser as any).lineManagerName ?? null,
          departmentName:  (currentUser as any).departmentName  ?? null,
          position:        (currentUser as any).position        ?? null,
        };
      }
    }
    setFormData(defaults);
  }, [form?.id, currentUser?.id]);

  function isFieldVisible(field: FormField): boolean {
    if (!field.conditional) return true;
    const { dependsOn, operator, value: condValue } = field.conditional;
    const depVal = String(formData[dependsOn] ?? "");
    if (operator === "eq")       return depVal === condValue;
    if (operator === "neq")      return depVal !== condValue;
    if (operator === "contains") return depVal.includes(condValue);
    if (operator === "in")       return condValue.split(",").includes(depVal);
    return true;
  }

  function handleSubmit(asDraft = false) {
    if (!form || !formId) return;
    const errors: Record<string, string> = {};
    for (const field of (form.fields ?? [])) {
      if (!isFieldVisible(field as FormField)) continue;
      const val     = formData[field.name];
      const isEmpty = val === undefined || val === null || val === "" || (Array.isArray(val) && val.length === 0);
      if (field.required && isEmpty && !asDraft) {
        const lbl = isAr && field.labelAr ? field.labelAr : field.label;
        errors[field.name] = isAr ? `${lbl} مطلوب` : `${lbl} is required`;
      }
    }
    if (Object.keys(errors).length > 0) { setFieldErrors(errors); return; }
    setFieldErrors({});

    submitMutation.mutate(
      { id: formId, data: { data: formData, status: (asDraft ? "draft" : "submitted") as "draft" | "submitted" } },
      {
        onSuccess: () => {
          if (asDraft) toast({ title: isAr ? "تم الحفظ كمسودة" : "Saved as draft" });
          else setSubmitted(true);
        },
        onError: (err: unknown) => {
          const msg = (err as { message?: string })?.message ?? "Failed to submit";
          toast({ title: msg, variant: "destructive" });
        },
      },
    );
  }

  const visibleFields = (form?.fields ?? []).filter((f) => isFieldVisible(f as FormField));
  const formName = isAr && form?.nameAr ? form.nameAr : (form?.name ?? "");
  const formDesc = isAr && form?.descriptionAr ? form.descriptionAr : (form?.description ?? "");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl w-full max-h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 py-4 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-primary/10 shrink-0">
              <ClipboardList className="w-4 h-4 text-primary" />
            </div>
            <div className="min-w-0">
              <div className="font-semibold text-base leading-tight truncate">{formName || (isAr ? "تحميل النموذج..." : "Loading form...")}</div>
              {formDesc && <div className="text-xs text-muted-foreground mt-0.5 font-normal line-clamp-1">{formDesc}</div>}
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {isLoading ? (
            <div className="space-y-5">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ))}
            </div>
          ) : loadError || (!isLoading && !form) ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <AlertCircle className="w-10 h-10 text-destructive mb-3" />
              <p className="text-muted-foreground">{isAr ? "تعذّر تحميل النموذج" : "Failed to load form"}</p>
            </div>
          ) : submitted ? (
            <div className="flex flex-col items-center justify-center py-12 text-center space-y-4">
              <CheckCircle2 className="w-14 h-14 text-emerald-500" />
              <div>
                <h3 className="text-lg font-semibold">{isAr ? "تم التقديم بنجاح!" : "Submitted Successfully!"}</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  {isAr ? "تم استلام نموذجك وسيتم مراجعته قريبًا" : "Your form has been received and will be reviewed shortly"}
                </p>
              </div>
              <Button onClick={() => onOpenChange(false)} className="mt-2">
                {isAr ? "إغلاق" : "Close"}
              </Button>
            </div>
          ) : (
            <div className="space-y-6">
              {visibleFields.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-8">
                  {isAr ? "لا توجد حقول في هذا النموذج" : "This form has no fields yet"}
                </p>
              )}
              {visibleFields.map((field) => (
                <DynamicField
                  key={field.id}
                  field={field as FormField}
                  value={formData[field.name]}
                  onChange={(v) => setFormData((prev) => ({ ...prev, [field.name]: v }))}
                  error={fieldErrors[field.name]}
                  isAr={isAr}
                />
              ))}
            </div>
          )}
        </div>

        {!submitted && !isLoading && !loadError && form && (
          <div className="px-6 py-4 border-t shrink-0 flex justify-end gap-3">
            <Button variant="outline" onClick={() => handleSubmit(true)} disabled={submitMutation.isPending}>
              <Save className="w-4 h-4 mr-2" />
              {isAr ? "حفظ كمسودة" : "Save Draft"}
            </Button>
            <Button onClick={() => handleSubmit(false)} disabled={submitMutation.isPending}>
              {submitMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
              {isAr ? "تقديم النموذج" : "Submit Form"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
