/**
 * super-admin-activity.tsx
 *
 * @phase P14-D - Platform User Audit & Activity Tracking
 * Route: /super-admin/activity
 *
 * Replaces the old workspace+user list with a platform audit timeline.
 * Permissions: platform.activity.read OR audit.read
 *
 * Safety:
 *   - read-only - no mutations, no delete, no export, no SIEM
 *   - metadata always redacted server-side before arriving here
 *   - denied state shown for users without either permission
 */

import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Activity,
  ChevronDown,
  ChevronRight,
  Filter,
  RefreshCw,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useAppAuth } from "@/lib/auth";
import { hasAnyPlatformPermissionClient } from "@/lib/platform-access";
import { PlatformAccessDenied } from "@/components/platform-permission-route";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  usePlatformActivity,
  type PlatformAuditItem,
  type PlatformActivityFilters,
} from "@/lib/platform-audit-hooks";
import {
  PLATFORM_AUDIT_SEVERITY_CONFIG,
  PLATFORM_AUDIT_RESULT_CONFIG,
  PLATFORM_AUDIT_GROUP_FILTER_OPTIONS,
  PLATFORM_AUDIT_RESULT_FILTER_OPTIONS,
  PLATFORM_AUDIT_SEVERITY_FILTER_OPTIONS,
  type PlatformAuditSeverity,
  type PlatformAuditResultType,
} from "@/lib/platform-audit-config";

// ── PlatformAuditSeverityBadge ────────────────────────────────────────────────

interface SeverityBadgeProps {
  severity: string;
  lang?: "en" | "ar";
}

export function PlatformAuditSeverityBadge({ severity, lang = "en" }: SeverityBadgeProps) {
  const cfg = PLATFORM_AUDIT_SEVERITY_CONFIG[severity as PlatformAuditSeverity];
  if (!cfg) return <span className="text-xs text-muted-foreground font-mono">{severity}</span>;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cfg.badgeClass}`}
      data-testid={`severity-badge-${severity}`}
    >
      <span>{lang === "ar" ? cfg.labelAr : cfg.label}</span>
      {lang === "en" && <span className="ltr:ml-1 rtl:mr-1 text-[10px] opacity-70" dir="rtl">{cfg.labelAr}</span>}
    </span>
  );
}

// ── PlatformAuditResultBadge ──────────────────────────────────────────────────

interface ResultBadgeProps {
  result: string;
  lang?: "en" | "ar";
}

export function PlatformAuditResultBadge({ result, lang = "en" }: ResultBadgeProps) {
  const cfg = PLATFORM_AUDIT_RESULT_CONFIG[result as PlatformAuditResultType];
  if (!cfg) return <span className="text-xs text-muted-foreground font-mono">{result}</span>;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cfg.badgeClass}`}
      data-testid={`result-badge-${result}`}
    >
      <span>{lang === "ar" ? cfg.labelAr : cfg.label}</span>
      {lang === "en" && <span className="ltr:ml-1 rtl:mr-1 text-[10px] opacity-70" dir="rtl">{cfg.labelAr}</span>}
    </span>
  );
}

// ── PlatformActivityEventCard ─────────────────────────────────────────────────

interface EventCardProps {
  item: PlatformAuditItem;
}

export function PlatformActivityEventCard({ item }: EventCardProps) {
  const [expanded, setExpanded] = useState(false);
  const hasMetadata =
    item.metadataSafe !== null &&
    item.metadataSafe !== undefined &&
    Object.keys(item.metadataSafe).length > 0;

  return (
    <div
      className="border border-border rounded-lg bg-card p-4 space-y-2"
      data-testid="platform-audit-event-card"
    >
      {/* Top row: badges + label + timestamp */}
      <div className="flex flex-wrap items-start gap-2">
        <PlatformAuditSeverityBadge severity={item.severity} />
        <PlatformAuditResultBadge result={item.result} />
        <span className="text-sm font-semibold flex-1 min-w-0">{item.actionLabel}</span>
        <span
          className="text-xs text-muted-foreground shrink-0 tabular-nums"
          title={new Date(item.createdAt).toLocaleString()}
        >
          {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
        </span>
      </div>

      {/* Arabic label */}
      <p className="text-xs text-muted-foreground" dir="rtl">{item.actionLabelAr}</p>

      {/* Actor / Target */}
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
        <span>
          <span className="text-muted-foreground">Actor - الفاعل: </span>
          <span className="font-medium">
            {item.actorDisplayName ?? item.actorEmail ?? (item.actorId ? `#${item.actorId}` : "System")}
          </span>
          {item.actorEmail && item.actorDisplayName && (
            <span className="text-muted-foreground ml-1">({item.actorEmail})</span>
          )}
        </span>
        {(item.targetDisplayName ?? item.targetEmail ?? item.targetUserId) ? (
          <span>
            <span className="text-muted-foreground">Target - الهدف: </span>
            <span className="font-medium">
              {item.targetDisplayName ?? item.targetEmail ?? `#${item.targetUserId}`}
            </span>
            {item.targetEmail && item.targetDisplayName && (
              <span className="text-muted-foreground ml-1">({item.targetEmail})</span>
            )}
          </span>
        ) : null}
      </div>

      {/* Reason / Blocked Reason */}
      {(item.reason ?? item.blockedReason) ? (
        <div className="text-xs space-y-0.5">
          {item.reason ? (
            <p>
              <span className="text-muted-foreground">Reason: </span>
              <span>{item.reason}</span>
            </p>
          ) : null}
          {item.blockedReason ? (
            <p>
              <span className="text-orange-600 dark:text-orange-400 font-medium">Blocked reason: </span>
              <span className="text-orange-700 dark:text-orange-300">{item.blockedReason}</span>
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Resource */}
      {(item.resourceType ?? item.resourceId) ? (
        <p className="text-xs text-muted-foreground">
          Resource:{" "}
          <span className="font-mono">
            {item.resourceType}
            {item.resourceId ? ` #${item.resourceId}` : ""}
          </span>
        </p>
      ) : null}

      {/* Metadata collapsed/expanded */}
      {hasMetadata ? (
        <div>
          <button
            type="button"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setExpanded((v) => !v)}
            data-testid="metadata-toggle"
          >
            {expanded ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
            Metadata (redacted - مُعقَّم)
          </button>
          {expanded ? (
            <pre
              className="mt-1 p-2 rounded bg-muted text-xs overflow-auto max-h-48 font-mono whitespace-pre-wrap break-all"
              data-testid="metadata-content"
            >
              {JSON.stringify(item.metadataSafe, null, 2)}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ── PlatformActivityFiltersBar ────────────────────────────────────────────────

interface FiltersBarProps {
  filters: PlatformActivityFilters;
  onChange: (f: PlatformActivityFilters) => void;
  onRefresh: () => void;
  isLoading: boolean;
}

export function PlatformActivityFiltersBar({
  filters,
  onChange,
  onRefresh,
  isLoading,
}: FiltersBarProps) {
  return (
    <div
      className="flex flex-wrap gap-2 items-end"
      data-testid="platform-activity-filters"
    >
      <div className="w-44">
        <Select
          value={filters.group ?? "__all__"}
          onValueChange={(v) =>
            onChange({ ...filters, group: v === "__all__" ? undefined : v })
          }
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="All groups" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Groups - كل المجموعات</SelectItem>
            {PLATFORM_AUDIT_GROUP_FILTER_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="w-36">
        <Select
          value={filters.result ?? "__all__"}
          onValueChange={(v) =>
            onChange({ ...filters, result: v === "__all__" ? undefined : v })
          }
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="All results" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Results - كل النتائج</SelectItem>
            {PLATFORM_AUDIT_RESULT_FILTER_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label} - {o.labelAr}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="w-36">
        <Select
          value={filters.severity ?? "__all__"}
          onValueChange={(v) =>
            onChange({ ...filters, severity: v === "__all__" ? undefined : v })
          }
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="All severities" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Severities - كل الخطورة</SelectItem>
            {PLATFORM_AUDIT_SEVERITY_FILTER_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label} - {o.labelAr}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="w-36">
        <Input
          className="h-8 text-xs"
          placeholder="Actor ID"
          value={filters.actorId ?? ""}
          onChange={(e) =>
            onChange({ ...filters, actorId: e.target.value || undefined })
          }
        />
      </div>

      <div className="w-36">
        <Input
          className="h-8 text-xs"
          placeholder="Target User ID"
          value={filters.targetUserId ?? ""}
          onChange={(e) =>
            onChange({ ...filters, targetUserId: e.target.value || undefined })
          }
        />
      </div>

      <div className="w-40">
        <Input
          type="date"
          className="h-8 text-xs"
          value={filters.from ?? ""}
          onChange={(e) =>
            onChange({ ...filters, from: e.target.value || undefined })
          }
        />
      </div>

      <div className="w-40">
        <Input
          type="date"
          className="h-8 text-xs"
          value={filters.to ?? ""}
          onChange={(e) =>
            onChange({ ...filters, to: e.target.value || undefined })
          }
        />
      </div>

      <Button
        variant="outline"
        size="sm"
        className="h-8 px-3"
        onClick={onRefresh}
        disabled={isLoading}
        data-testid="refresh-activity"
      >
        <RefreshCw
          className={`w-3 h-3 mr-1 ${isLoading ? "animate-spin" : ""}`}
        />
        Refresh
      </Button>
    </div>
  );
}

// ── PlatformActivityTimeline ──────────────────────────────────────────────────

interface TimelineProps {
  items: PlatformAuditItem[];
  isLoading: boolean;
  isError: boolean;
  nextCursor: number | null;
  onLoadMore: () => void;
}

export function PlatformActivityTimeline({
  items,
  isLoading,
  isError,
  nextCursor,
  onLoadMore,
}: TimelineProps) {
  if (isLoading && items.length === 0) {
    return (
      <div className="space-y-3" data-testid="platform-activity-loading">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div
        className="text-center py-12 text-muted-foreground text-sm"
        data-testid="platform-activity-error"
      >
        Failed to load activity - تعذر تحميل النشاط
      </div>
    );
  }

  if (!isLoading && items.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center py-16 gap-3 text-center"
        data-testid="platform-activity-empty"
      >
        <Activity className="w-8 h-8 text-muted-foreground/40" />
        <div>
          <p className="text-sm font-medium text-muted-foreground">
            No activity found
          </p>
          <p className="text-xs text-muted-foreground mt-0.5" dir="rtl">
            لا توجد أنشطة
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="platform-activity-timeline">
      {items.map((item) => (
        <PlatformActivityEventCard key={item.id} item={item} />
      ))}
      {nextCursor !== null ? (
        <div className="flex justify-center pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onLoadMore}
            disabled={isLoading}
            data-testid="load-more-activity"
          >
            {isLoading ? "Loading..." : "Load more - تحميل المزيد"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function SuperAdminActivity() {
  const { t } = useTranslation();
  const { user: authUser } = useAppAuth();

  const [filters, setFilters] = useState<PlatformActivityFilters>({ limit: 50 });
  const [cursor, setCursor] = useState<number | undefined>(undefined);
  const [allItems, setAllItems] = useState<PlatformAuditItem[]>([]);

  const hasPermission = hasAnyPlatformPermissionClient(authUser ?? {}, [
    "platform.activity.read",
    "audit.read",
  ]);

  const activeFilters: PlatformActivityFilters = { ...filters, cursor };

  const { data, isLoading, isError, refetch } = usePlatformActivity(
    hasPermission ? activeFilters : {},
  );

  React.useEffect(() => {
    if (!data?.items || !Array.isArray(data.items)) return;
    if (!cursor) {
      setAllItems(data.items);
    } else {
      setAllItems((prev) => [...prev, ...data.items]);
    }
  }, [data, cursor]);

  function handleFiltersChange(f: PlatformActivityFilters) {
    setFilters(f);
    setCursor(undefined);
    setAllItems([]);
  }

  function handleRefresh() {
    setCursor(undefined);
    setAllItems([]);
    void refetch();
  }

  function handleLoadMore() {
    if (data?.nextCursor) {
      setCursor(data.nextCursor);
    }
  }

  // ── Denied state ──────────────────────────────────────────────────────────

  if (!hasPermission) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {t("platform_activity")}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {t("platform_activity_desc", {
              defaultValue: "Platform audit event log - سجل أحداث المنصة",
            })}
          </p>
        </div>
        <PlatformAccessDenied
          requiredPermission="platform.activity.read"
          data-testid="platform-activity-denied"
        />
      </div>
    );
  }

  // ── Authorized view ───────────────────────────────────────────────────────

  return (
    <div className="space-y-6" data-testid="platform-activity-page">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {t("platform_activity")}
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Platform audit event log - سجل أحداث المنصة
        </p>
      </div>

      {/* Stats strip */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Activity className="w-3.5 h-3.5" />
          {isLoading && allItems.length === 0
            ? "Loading..."
            : `${allItems.length} event${allItems.length === 1 ? "" : "s"} shown`}
        </span>
        <span className="text-muted-foreground/40">|</span>
        <span className="text-xs" dir="rtl">
          قراءة فقط - Read-only
        </span>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Filter className="w-4 h-4" /> Filters - فلاتر
          </CardTitle>
        </CardHeader>
        <CardContent>
          <PlatformActivityFiltersBar
            filters={filters}
            onChange={handleFiltersChange}
            onRefresh={handleRefresh}
            isLoading={isLoading}
          />
        </CardContent>
      </Card>

      {/* Timeline */}
      <PlatformActivityTimeline
        items={allItems}
        isLoading={isLoading}
        isError={isError}
        nextCursor={data?.nextCursor ?? null}
        onLoadMore={handleLoadMore}
      />
    </div>
  );
}
