import { useState } from "react";
import { Download, Archive, Shield, Lock, FileIcon, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useEntityAttachments,
  useDownloadAttachment,
  useArchiveAttachment,
} from "@/hooks/use-report-center";
import { canManageReportCenter } from "@/lib/report-center-config";
import { usePermissions } from "@/hooks/use-permissions";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function EntityDocumentsPanel({ isAr }: { isAr: boolean }) {
  const { hasPermission } = usePermissions();
  const canManage = canManageReportCenter(hasPermission);

  const [entityType, setEntityType] = useState("employee");
  const [entityId, setEntityId] = useState("");
  const [query, setQuery] = useState({ type: "", id: "" });

  const { data: docs = [], isLoading, isError, error } = useEntityAttachments(
    query.type,
    query.id,
    Boolean(query.type && query.id),
  );
  const downloadMut = useDownloadAttachment();
  const archiveMut = useArchiveAttachment();

  const handleSearch = () => {
    setQuery({ type: entityType.trim(), id: entityId.trim() });
  };

  return (
    <Card data-testid="entity-documents-panel">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <FileIcon className="w-5 h-5" />
          {isAr ? "مستندات الكيان" : "Entity documents"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="space-y-1">
            <Label>{isAr ? "نوع الكيان" : "Entity type"}</Label>
            <Input
              value={entityType}
              onChange={(e) => setEntityType(e.target.value)}
              placeholder="employee"
              data-testid="entity-doc-type"
            />
          </div>
          <div className="space-y-1">
            <Label>{isAr ? "معرّف الكيان" : "Entity ID"}</Label>
            <Input
              value={entityId}
              onChange={(e) => setEntityId(e.target.value)}
              placeholder="123"
              data-testid="entity-doc-id"
            />
          </div>
          <Button type="button" onClick={handleSearch} data-testid="entity-doc-search">
            {isAr ? "عرض" : "Load"}
          </Button>
        </div>

        {isLoading && <Skeleton className="h-32 w-full" />}

        {isError && (
          <div className="flex items-center gap-2 text-destructive text-sm" role="alert">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error instanceof Error ? error.message : isAr ? "تعذر التحميل" : "Failed to load"}
          </div>
        )}

        {!isLoading && !isError && query.id && docs.length === 0 && (
          <p className="text-sm text-muted-foreground" data-testid="entity-doc-empty">
            {isAr ? "لا توجد مرفقات لهذا الكيان." : "No attachments for this entity."}
          </p>
        )}

        <ul className="space-y-2">
          {docs.map((doc) => (
            <li
              key={doc.id}
              className="flex flex-wrap items-center justify-between gap-2 border rounded-lg p-3"
              data-testid={`entity-doc-row-${doc.id}`}
            >
              <div>
                <p className="font-medium text-sm">{doc.title || doc.fileName}</p>
                <p className="text-xs text-muted-foreground">
                  {doc.fileName} · {formatBytes(doc.sizeBytes)}
                  {doc.currentVersionId != null
                    ? ` · ${isAr ? "إصدار" : "v"}${doc.currentVersionId}`
                    : ""}
                </p>
                <div className="flex gap-1 mt-1 flex-wrap">
                  <Badge variant="outline">{doc.status}</Badge>
                  {doc.classification && (
                    <Badge variant="secondary">
                      <Shield className="w-3 h-3 mr-1" />
                      {doc.classification}
                    </Badge>
                  )}
                  {doc.isConfidential && (
                    <Badge variant="destructive">
                      <Lock className="w-3 h-3 mr-1" />
                      {isAr ? "سري" : "Confidential"}
                    </Badge>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={downloadMut.isPending || doc.status === "archived"}
                  data-testid={`entity-doc-download-${doc.id}`}
                  onClick={() =>
                    downloadMut.mutate({ attachmentId: doc.id, fileName: doc.fileName })
                  }
                >
                  <Download className="w-4 h-4 mr-1" />
                  {isAr ? "تحميل" : "Download"}
                </Button>
                {canManage && doc.status !== "archived" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={archiveMut.isPending}
                    data-testid={`entity-doc-archive-${doc.id}`}
                    onClick={() => archiveMut.mutate(doc.id)}
                  >
                    <Archive className="w-4 h-4 mr-1" />
                    {isAr ? "أرشفة" : "Archive"}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
