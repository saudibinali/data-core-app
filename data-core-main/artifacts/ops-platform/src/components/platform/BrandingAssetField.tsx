import { useRef, useState } from "react";
import { Upload, ImageIcon } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { resolveBrandingAssetUrl } from "@/lib/platform-branding";
import { useApiFetch } from "@/hooks/use-api-fetch";

type Kind = "logo" | "favicon";

interface Props {
  kind: Kind;
  label: string;
  hint: string;
  url: string;
  fallbackSrc: string;
  onUrlChange: (url: string) => void;
  onUploaded: (url: string) => void;
}

export function BrandingAssetField({
  kind,
  label,
  hint,
  url,
  fallbackSrc,
  onUrlChange,
  onUploaded,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const apiFetch = useApiFetch();
  const [uploading, setUploading] = useState(false);
  const previewSrc = resolveBrandingAssetUrl(url) || fallbackSrc;

  async function handleFile(file: File) {
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await apiFetch(`/api/platform/settings/branding/upload?kind=${kind}`, {
        method: "POST",
        body,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "Upload failed");
      }
      const data = (await res.json()) as { uploadedUrl?: string };
      const next = data.uploadedUrl ?? "";
      onUrlChange(next);
      onUploaded(next);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-border bg-card p-3" data-testid={`branding-field-${kind}`}>
      <Label>{label}</Label>
      <p className="text-xs text-muted-foreground">{hint}</p>
      <div className="flex items-center gap-3">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md border border-border bg-muted/40 overflow-hidden">
          {previewSrc ? (
            <img
              src={previewSrc}
              alt=""
              className={kind === "favicon" ? "h-8 w-8 object-contain" : "h-10 max-w-[52px] object-contain"}
              onError={(e) => {
                e.currentTarget.src = fallbackSrc;
              }}
            />
          ) : (
            <ImageIcon className="h-6 w-6 text-muted-foreground" />
          )}
        </div>
        <div className="flex-1 space-y-2 min-w-0">
          <Input
            value={url.split("?")[0]}
            onChange={(e) => onUrlChange(e.target.value)}
            placeholder={kind === "favicon" ? "/branding/favicon.ico" : "/branding/logo.png"}
            className="text-sm"
          />
          <div className="flex flex-wrap gap-2">
            <input
              ref={inputRef}
              type="file"
              accept={kind === "favicon" ? ".ico,.png,.svg,.webp" : ".png,.jpg,.jpeg,.svg,.webp"}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={uploading}
              onClick={() => inputRef.current?.click()}
            >
              <Upload className="w-3.5 h-3.5 me-1.5" />
              {uploading ? "..." : kind === "favicon" ? "Upload favicon" : "Upload logo"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
