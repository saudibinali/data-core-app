import { useState, useEffect, useRef } from "react";
import { useLocation, useParams } from "wouter";
import { useTranslation } from "react-i18next";
import {
  useGetForm,
  useSubmitForm,
  useGetFormDataSourceData,
} from "@workspace/api-client-react";
import {
  ArrowLeft, ClipboardList, Send, Save, Loader2,
  AlertCircle, CheckCircle2, Database, Upload, FileText,
  X, Eye, Download, CloudUpload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

// ── PDF Upload State ──────────────────────────────────────────────────────────
interface UploadedFile {
  name: string;
  size: number;
  objectPath: string;
  previewUrl: string;
}

// ── PDF Upload Component ──────────────────────────────────────────────────────
function PdfUploadField({
  value,
  onChange,
  error,
  isAr,
  required,
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
  const [progress, setProgress] = useState(0);
  const [previewOpen, setPreviewOpen] = useState(false);

  const uploaded = value as UploadedFile | null | undefined;

  function formatBytes(bytes: number): string {
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
      toast({
        title: isAr ? "نوع الملف غير مدعوم" : "Unsupported file type",
        description: isAr ? "يُسمح بملفات PDF فقط" : "Only PDF files are allowed",
        variant: "destructive",
      });
      return;
    }

    const MAX_SIZE = 20 * 1024 * 1024; // 20 MB
    if (file.size > MAX_SIZE) {
      toast({
        title: isAr ? "الملف كبير جداً" : "File too large",
        description: isAr ? "الحد الأقصى للحجم 20 ميجابايت" : "Maximum size is 20 MB",
        variant: "destructive",
      });
      return;
    }

    setUploading(true);
    setProgress(0);

    try {
      // 1. Request presigned URL from our backend
      const metaRes = await fetch("/api/storage/uploads/request-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: file.name,
          size: file.size,
          contentType: "application/pdf",
        }),
      });

      if (!metaRes.ok) {
        throw new Error(`Failed to get upload URL: ${metaRes.status}`);
      }

      const { uploadURL, objectPath } = await metaRes.json() as {
        uploadURL: string;
        objectPath: string;
      };

      // 2. Upload directly to GCS presigned URL with progress tracking
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", uploadURL);
        xhr.setRequestHeader("Content-Type", "application/pdf");

        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable) {
            setProgress(Math.round((ev.loaded / ev.total) * 100));
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error(`Upload failed: ${xhr.status}`));
        };
        xhr.onerror = () => reject(new Error("Network error during upload"));
        xhr.send(file);
      });

      // 3. Store metadata in form value
      const uploaded: UploadedFile = {
        name: file.name,
        size: file.size,
        objectPath,
        previewUrl: `/api${objectPath}`,
      };
      onChange(uploaded);

      toast({
        title: isAr ? "تم الرفع بنجاح" : "Uploaded successfully",
        description: file.name,
      });
    } catch (err) {
      toast({
        title: isAr ? "فشل الرفع" : "Upload failed",
        description: String(err),
        variant: "destructive",
      });
    } finally {
      setUploading(false);
      setProgress(0);
    }
  }

  function handleRemove() {
    onChange(null);
  }

  // ── Uploaded state ─────────────────────────────────────────────────────────
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
              <p className="text-xs text-muted-foreground">{formatBytes(uploaded.size)}</p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                onClick={() => setPreviewOpen(true)}
                title={isAr ? "عرض الملف" : "Preview PDF"}
              >
                <Eye className="w-4 h-4" />
              </Button>
              <a
                href={uploaded.previewUrl}
                download={uploaded.name}
                className="inline-flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                title={isAr ? "تحميل الملف" : "Download PDF"}
              >
                <Download className="w-4 h-4" />
              </a>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                onClick={handleRemove}
                title={isAr ? "حذف الملف" : "Remove file"}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* PDF Preview Dialog */}
        <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
          <DialogContent className="max-w-4xl w-full h-[85vh] flex flex-col p-0 gap-0">
            <DialogHeader className="px-4 py-3 border-b shrink-0">
              <DialogTitle className="flex items-center gap-2 text-sm">
                <FileText className="w-4 h-4 text-primary" />
                {uploaded.name}
              </DialogTitle>
            </DialogHeader>
            <iframe
              src={`${uploaded.previewUrl}#toolbar=1`}
              className="flex-1 w-full border-0"
              title={uploaded.name}
            />
          </DialogContent>
        </Dialog>

        {error && (
          <p className="text-xs text-destructive flex items-center gap-1 mt-1">
            <AlertCircle className="w-3 h-3" /> {error}
          </p>
        )}
      </>
    );
  }

  // ── Upload area ────────────────────────────────────────────────────────────
  return (
    <>
      <div
        className={`relative rounded-lg border-2 border-dashed transition-colors cursor-pointer
          ${error ? "border-destructive bg-destructive/5" : "border-border hover:border-primary/50 hover:bg-primary/5"}
          ${uploading ? "pointer-events-none opacity-70" : ""}`}
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
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="sr-only"
          onChange={handleFileSelect}
          disabled={uploading}
        />

        <div className="flex flex-col items-center justify-center gap-2 py-8 px-4 text-center">
          {uploading ? (
            <>
              <CloudUpload className="w-10 h-10 text-primary animate-pulse" />
              <p className="text-sm font-medium text-primary">
                {isAr ? "جارٍ الرفع..." : "Uploading..."}
              </p>
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
                <p className="text-sm font-medium">
                  {isAr ? "اسحب ملف PDF هنا أو اضغط للاختيار" : "Drag & drop a PDF or click to browse"}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {isAr ? "PDF فقط · الحد الأقصى 20 ميجابايت" : "PDF only · Max 20 MB"}
                </p>
              </div>
            </>
          )}
        </div>
      </div>

      {error && (
        <p className="text-xs text-destructive flex items-center gap-1 mt-1">
          <AlertCircle className="w-3 h-3" /> {error}
        </p>
      )}
    </>
  );
}

type FieldType =
  | "text" | "textarea" | "number" | "email" | "phone"
  | "dropdown" | "checkbox" | "radio" | "date" | "time"
  | "file" | "user" | "department" | "multi_select" | "boolean";

interface FieldDataSource {
  key:      string;
  multiple?: boolean;
}

interface FormField {
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
  dataSource?:   FieldDataSource | null;
  displayOrder:  number;
}

// ── Dynamic options loader ────────────────────────────────────────────────────
// Wraps a single field that needs live platform data
function DynamicSourceSelect({
  field,
  value,
  onChange,
  error,
  isAr,
}: {
  field: FormField;
  value: unknown;
  onChange: (v: unknown) => void;
  error?: string;
  isAr: boolean;
}) {
  const dsKey = field.dataSource!.key;
  const multiple = field.dataSource?.multiple ?? false;

  const { data: items = [], isLoading } = useGetFormDataSourceData(dsKey);

  const label    = isAr && field.labelAr ? field.labelAr : field.label;
  const placeholder = isLoading
    ? (isAr ? "جارٍ التحميل..." : "Loading...")
    : (isAr ? "اختر..." : "Select...");

  if (multiple) {
    // Multi-select as checkboxes
    const selected = Array.isArray(value) ? (value as string[]) : [];
    return (
      <div className="space-y-1.5">
        <Label className="flex items-center gap-1.5 text-sm font-medium">
          {label}
          {field.required && <span className="text-destructive">*</span>}
          <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground font-normal">
            <Database className="w-3 h-3" /> {isAr ? "بيانات حية" : "Live data"}
          </span>
        </Label>
        {isLoading ? (
          <div className="space-y-1.5">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-7 w-full" />)}
          </div>
        ) : items.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">
            {isAr ? "لا توجد عناصر" : "No items available"}
          </p>
        ) : (
          <div className="space-y-1.5 max-h-52 overflow-y-auto rounded-md border p-2">
            {items.map((item) => (
              <label key={item.value} className="flex items-center gap-2 cursor-pointer p-1 hover:bg-muted/50 rounded">
                <Checkbox
                  checked={selected.includes(item.value)}
                  onCheckedChange={(checked) => {
                    const next = checked
                      ? [...selected, item.value]
                      : selected.filter((v) => v !== item.value);
                    onChange(next);
                  }}
                />
                <span className="text-sm">{isAr && item.labelAr ? item.labelAr : item.label}</span>
              </label>
            ))}
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

  // Single select
  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-1.5 text-sm font-medium">
        {label}
        {field.required && <span className="text-destructive">*</span>}
        <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground font-normal">
          <Database className="w-3 h-3" /> {isAr ? "بيانات حية" : "Live data"}
        </span>
      </Label>
      <Select
        value={String(value ?? "")}
        onValueChange={onChange}
        disabled={isLoading}
      >
        <SelectTrigger className={error ? "border-destructive" : ""}>
          {isLoading ? (
            <span className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> {placeholder}
            </span>
          ) : (
            <SelectValue placeholder={placeholder} />
          )}
        </SelectTrigger>
        <SelectContent>
          {items.length === 0 && !isLoading && (
            <div className="px-2 py-4 text-center text-sm text-muted-foreground">
              {isAr ? "لا توجد عناصر" : "No items available"}
            </div>
          )}
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {isAr && item.labelAr ? item.labelAr : item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error && (
        <p className="text-xs text-destructive flex items-center gap-1">
          <AlertCircle className="w-3 h-3" /> {error}
        </p>
      )}
    </div>
  );
}

// ── Static DynamicField ───────────────────────────────────────────────────────
function DynamicField({
  field,
  value,
  onChange,
  error,
  isAr,
}: {
  field: FormField;
  value: unknown;
  onChange: (v: unknown) => void;
  error?: string;
  isAr: boolean;
}) {
  // If this field has a dataSource, delegate to the live-data renderer
  if (field.dataSource?.key) {
    return (
      <DynamicSourceSelect
        field={field}
        value={value}
        onChange={onChange}
        error={error}
        isAr={isAr}
      />
    );
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
        <Input
          type={field.type === "email" ? "email" : field.type === "phone" ? "tel" : "text"}
          placeholder={placeholder}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          className={error ? "border-destructive" : ""}
        />
      )}

      {field.type === "number" && (
        <Input
          type="number"
          placeholder={placeholder}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value ? Number(e.target.value) : "")}
          className={error ? "border-destructive" : ""}
          min={(field.validation as Record<string, number> | null)?.["min"]}
          max={(field.validation as Record<string, number> | null)?.["max"]}
        />
      )}

      {field.type === "textarea" && (
        <Textarea
          placeholder={placeholder}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          rows={4}
          className={error ? "border-destructive" : ""}
        />
      )}

      {field.type === "date" && (
        <Input
          type="date"
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          className={error ? "border-destructive" : ""}
        />
      )}

      {field.type === "time" && (
        <Input
          type="time"
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          className={error ? "border-destructive" : ""}
        />
      )}

      {field.type === "dropdown" && (
        <Select value={String(value ?? "")} onValueChange={onChange}>
          <SelectTrigger className={error ? "border-destructive" : ""}>
            <SelectValue placeholder={placeholder || (isAr ? "اختر..." : "Select...")} />
          </SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {isAr && opt.labelAr ? opt.labelAr : opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {field.type === "radio" && (
        <div className="space-y-2">
          {(field.options ?? []).map((opt) => (
            <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name={field.name}
                value={opt.value}
                checked={value === opt.value}
                onChange={() => onChange(opt.value)}
                className="text-primary"
              />
              <span className="text-sm">{isAr && opt.labelAr ? opt.labelAr : opt.label}</span>
            </label>
          ))}
        </div>
      )}

      {field.type === "checkbox" && (
        <div className="space-y-2">
          {(field.options ?? []).map((opt) => {
            const vals = Array.isArray(value) ? (value as string[]) : [];
            return (
              <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={vals.includes(opt.value)}
                  onCheckedChange={(checked) => {
                    const next = checked
                      ? [...vals, opt.value]
                      : vals.filter((v) => v !== opt.value);
                    onChange(next);
                  }}
                />
                <span className="text-sm">{isAr && opt.labelAr ? opt.labelAr : opt.label}</span>
              </label>
            );
          })}
        </div>
      )}

      {field.type === "boolean" && (
        <label className="flex items-center gap-2 cursor-pointer">
          <Checkbox
            checked={value === true || value === "true"}
            onCheckedChange={(checked) => onChange(Boolean(checked))}
          />
          <span className="text-sm">{label}</span>
        </label>
      )}

      {field.type === "multi_select" && (
        <div className="space-y-2">
          {(field.options ?? []).map((opt) => {
            const vals = Array.isArray(value) ? (value as string[]) : [];
            return (
              <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={vals.includes(opt.value)}
                  onCheckedChange={(checked) => {
                    const next = checked
                      ? [...vals, opt.value]
                      : vals.filter((v) => v !== opt.value);
                    onChange(next);
                  }}
                />
                <span className="text-sm">{isAr && opt.labelAr ? opt.labelAr : opt.label}</span>
              </label>
            );
          })}
        </div>
      )}

      {field.type === "file" && (
        <PdfUploadField
          value={value}
          onChange={onChange}
          error={error}
          isAr={isAr}
          required={field.required}
        />
      )}

      {(field.type === "user" || field.type === "department") && (
        <Input
          placeholder={isAr ? `اختر ${label}` : `Select ${label}...`}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          className={error ? "border-destructive" : ""}
        />
      )}

      {error && (
        <p className="text-xs text-destructive flex items-center gap-1">
          <AlertCircle className="w-3 h-3" /> {error}
        </p>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function FormsSubmitPage() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { i18n } = useTranslation();
  const isAr = i18n.language.startsWith("ar");
  const { toast } = useToast();

  const { data: form, isLoading, error: loadError } = useGetForm(Number(id));
  const submitMutation = useSubmitForm();

  const [formData,    setFormData]    = useState<Record<string, unknown>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitted,   setSubmitted]   = useState(false);

  // Populate defaults
  useEffect(() => {
    if (!form) return;
    const defaults: Record<string, unknown> = {};
    for (const field of (form.fields ?? [])) {
      if (field.defaultValue !== null && field.defaultValue !== undefined) {
        defaults[field.name] = field.defaultValue;
      }
    }
    setFormData(defaults);
  }, [form?.id]);

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
    if (!form) return;
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
      { id: Number(id), data: { data: formData, status: (asDraft ? "draft" : "submitted") as "draft" | "submitted" } },
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

  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <Skeleton className="h-8 w-48" />
        <Card><CardContent className="pt-6 space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-10 w-full" />
            </div>
          ))}
        </CardContent></Card>
      </div>
    );
  }

  if (loadError || !form) {
    return (
      <Card className="max-w-2xl mx-auto">
        <CardContent className="py-16 text-center space-y-3">
          <AlertCircle className="w-10 h-10 text-destructive mx-auto" />
          <p className="text-muted-foreground">{isAr ? "لم يتم العثور على النموذج" : "Form not found"}</p>
          <Button variant="outline" onClick={() => navigate("/self-service")}>
            <ArrowLeft className="w-4 h-4 mr-2" /> {isAr ? "رجوع" : "Back"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (submitted) {
    return (
      <Card className="max-w-2xl mx-auto">
        <CardContent className="py-16 text-center space-y-4">
          <CheckCircle2 className="w-14 h-14 text-emerald-500 mx-auto" />
          <h2 className="text-xl font-semibold">{isAr ? "تم التقديم بنجاح!" : "Submitted Successfully!"}</h2>
          <p className="text-muted-foreground text-sm">
            {isAr ? "تم استلام نموذجك وسيتم مراجعته قريبًا" : "Your form has been received and will be reviewed shortly"}
          </p>
          <div className="flex gap-3 justify-center pt-2">
            <Button onClick={() => navigate("/self-service")}>
              {isAr ? "العودة للخدمات الذاتية" : "Back to Self-Service"}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const name          = isAr && form.nameAr ? form.nameAr : form.name;
  const desc          = isAr && form.descriptionAr ? form.descriptionAr : form.description;
  const visibleFields = (form.fields ?? []).filter((f) => isFieldVisible(f as FormField));

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <Button variant="ghost" size="sm" onClick={() => navigate("/self-service")} className="-ml-2">
        <ArrowLeft className="w-4 h-4 mr-1" />
        {isAr ? "الخدمات الذاتية" : "Self-Service"}
      </Button>

      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <ClipboardList className="w-5 h-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-xl">{name}</CardTitle>
              {desc && <CardDescription className="mt-1">{desc}</CardDescription>}
            </div>
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardContent className="pt-6 space-y-6">
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
        </CardContent>
      </Card>

      <div className="flex gap-3 justify-end">
        <Button variant="outline" onClick={() => handleSubmit(true)} disabled={submitMutation.isPending}>
          <Save className="w-4 h-4 mr-2" />
          {isAr ? "حفظ كمسودة" : "Save Draft"}
        </Button>
        <Button onClick={() => handleSubmit(false)} disabled={submitMutation.isPending}>
          {submitMutation.isPending ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Send className="w-4 h-4 mr-2" />
          )}
          {isAr ? "تقديم النموذج" : "Submit Form"}
        </Button>
      </div>
    </div>
  );
}
