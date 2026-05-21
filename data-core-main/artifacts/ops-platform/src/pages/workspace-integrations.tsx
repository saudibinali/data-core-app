import { useEffect, useMemo, useState } from "react";
import { Link, useSearch } from "wouter";
import { useTranslation } from "react-i18next";
import {
  Plug,
  Mail,
  Loader2,
  Plus,
  RefreshCw,
  Copy,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ExternalLink,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useListModules } from "@workspace/api-client-react";
import { usePermissions } from "@/hooks/use-permissions";
import { useApiFetch } from "@/hooks/use-api-fetch";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  INTEGRATION_CATALOG,
  ATTENDANCE_CONNECTOR_LABELS,
  integrationStatusLabel,
  formatIntegrationPlanNote,
  type IntegrationRuntimeStatus,
} from "@/lib/integrations-hub-config";
import {
  useAttendanceIntegrations,
  useWorkforceConnectors,
  useCreateAttendanceIntegration,
  useUpdateAttendanceIntegration,
  useTestAttendanceIntegration,
  useSyncAttendanceIntegration,
  buildAttendanceWebhookUrl,
} from "@/hooks/use-workforce-integrations";

function statusBadgeClass(status: IntegrationRuntimeStatus): string {
  switch (status) {
    case "active":
      return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200";
    case "partial":
      return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200";
    default:
      return "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400";
  }
}

export default function WorkspaceIntegrationsPage() {
  const { i18n } = useTranslation();
  const isAr = i18n.language.startsWith("ar");
  const search = useSearch();
  const tabParam = new URLSearchParams(search).get("tab") ?? "overview";
  const [tab, setTab] = useState(tabParam);
  const { hasPermission } = usePermissions();
  const { data: modules = [] } = useListModules();
  const canHr = hasPermission("hr.manage");
  const isAdmin = hasPermission("admin");
  const integrationsModule = modules.find((m) => m.key === "integrations");
  const integrationsEnabled = integrationsModule?.enabled ?? false;

  const catalogRows = useMemo(() => {
    return INTEGRATION_CATALOG.map((entry) => {
      let canUse = true;
      if (entry.requiredModule && !modules.find((m) => m.key === entry.requiredModule)?.enabled) {
        canUse = false;
      }
      if (entry.requiredPermission && !hasPermission(entry.requiredPermission)) {
        canUse = false;
      }
      return { ...entry, canUse };
    });
  }, [modules, hasPermission]);

  return (
    <div className="space-y-6 max-w-5xl" data-testid="workspace-integrations-page">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Plug className="w-6 h-6 text-primary" />
          {isAr ? "مركز التكاملات" : "Integration Hub"}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {isAr
            ? "ربط الحضور، البريد، والأنظمة الخارجية ضمن صلاحياتك وخطة الاشتراك."
            : "Connect attendance, email, and external systems within your plan and permissions."}
        </p>
      </div>

      {!integrationsEnabled && (
        <div
          className="flex items-start gap-2 p-3 rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-950/30 text-xs"
          data-testid="integrations-module-hint"
        >
          <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600 mt-0.5" />
          <span>
            {isAr
              ? "وحدة «التكاملات» غير مفعّلة في اشتراكك. الحضور والبريد متاحان حسب صلاحيات HR. لتفعيل API عامة وERP وWebhooks اطلب ترقية الخطة (Business+)."
              : "The Integrations module is off on your plan. Attendance and email work under HR permissions. For full API, ERP, and webhooks, upgrade to Business+."}
          </span>
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">{isAr ? "نظرة عامة" : "Overview"}</TabsTrigger>
          {canHr && <TabsTrigger value="attendance">{isAr ? "الحضور" : "Attendance"}</TabsTrigger>}
          {isAdmin && <TabsTrigger value="email">{isAr ? "البريد" : "Email"}</TabsTrigger>}
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                {isAr ? "حالة التكاملات" : "Integration status"}
              </CardTitle>
              <CardDescription>
                {isAr ? "مفعّل = جاهز للاستخدام من الواجهة أو API" : "Active = ready in UI or API today"}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <Table className={isAr ? "text-right" : "text-left"}>
                <TableHeader>
                  <TableRow>
                    <TableHead className={isAr ? "text-right" : "text-left"}>
                      {isAr ? "النوع" : "Type"}
                    </TableHead>
                    <TableHead className={isAr ? "text-right" : "text-left"}>
                      {isAr ? "الحالة" : "Status"}
                    </TableHead>
                    <TableHead className={cn("min-w-[220px] max-w-md", isAr ? "text-right" : "text-left")}>
                      {isAr ? "الخطة والصلاحية" : "Plan & permission"}
                    </TableHead>
                    <TableHead className={isAr ? "text-left" : "text-end"}>
                      {isAr ? "إجراء" : "Action"}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {catalogRows.map((row) => {
                    const noteLines = formatIntegrationPlanNote(
                      isAr ? row.planNoteAr : row.planNoteEn,
                    );
                    return (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium text-sm align-top">
                        {isAr ? row.labelAr : row.labelEn}
                      </TableCell>
                      <TableCell className="align-top">
                        <span
                          className={cn(
                            "inline-flex px-2 py-0.5 rounded-full text-xs font-medium",
                            statusBadgeClass(row.status),
                          )}
                        >
                          {integrationStatusLabel(row.status, isAr)}
                        </span>
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-xs text-muted-foreground align-top locale-prose-cell min-w-[220px] max-w-md",
                          isAr && "text-right",
                        )}
                      >
                        {noteLines.map((line, i) => (
                          <p key={i} className={i > 0 ? "mt-1.5" : ""}>
                            {line}
                          </p>
                        ))}
                        {!row.canUse && (
                          <p className="mt-2 text-amber-700 dark:text-amber-300 font-medium">
                            {isAr ? "غير متاح لحسابك حالياً" : "Not available on your account"}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className={cn("align-top", isAr ? "text-left" : "text-end")}>
                        {row.configurePath && row.canUse && row.status !== "planned" ? (
                          <Button variant="outline" size="sm" asChild>
                            <Link href={row.configurePath}>
                              {isAr ? "إعداد" : "Configure"}
                            </Link>
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {canHr && (
          <TabsContent value="attendance" className="mt-4">
            <AttendanceIntegrationsSection isAr={isAr} />
          </TabsContent>
        )}

        {isAdmin && (
          <TabsContent value="email" className="mt-4">
            <WorkspaceSmtpSection isAr={isAr} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

function AttendanceIntegrationsSection({ isAr }: { isAr: boolean }) {
  const { toast } = useToast();
  const { data: list = [], isLoading, refetch } = useAttendanceIntegrations();
  const { data: connectors = [] } = useWorkforceConnectors();
  const create = useCreateAttendanceIntegration();
  const update = useUpdateAttendanceIntegration();
  const test = useTestAttendanceIntegration();
  const sync = useSyncAttendanceIntegration();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [connectorKey, setConnectorKey] = useState("generic_webhook");
  const [pollMinutes, setPollMinutes] = useState("15");
  const [bearerToken, setBearerToken] = useState("");
  const [pollUrl, setPollUrl] = useState("");
  const [secretReveal, setSecretReveal] = useState<string | null>(null);
  const [webhookUrlReveal, setWebhookUrlReveal] = useState<string | null>(null);

  async function handleCreate() {
    if (!name.trim()) return;
    const credentials: Record<string, string> = {};
    if (connectorKey === "generic_rest_poll" || connectorKey === "direct_api") {
      if (bearerToken.trim()) credentials.bearerToken = bearerToken.trim();
    }
    const config: Record<string, unknown> | undefined =
      (connectorKey === "generic_rest_poll" || connectorKey === "direct_api") && pollUrl.trim()
        ? { pollUrl: pollUrl.trim() }
        : undefined;
    try {
      const row = await create.mutateAsync({
        name: name.trim(),
        connectorKey,
        pollIntervalMinutes: Number(pollMinutes) || 15,
        config,
        credentials: Object.keys(credentials).length ? credentials : undefined,
      });
      setOpen(false);
      setName("");
      if (row.webhookSecretOnce) setSecretReveal(row.webhookSecretOnce);
      if (row.webhookUrl) setWebhookUrlReveal(row.webhookUrl);
      else if (row.id) setWebhookUrlReveal(buildAttendanceWebhookUrl(row.id));
      toast({
        title: isAr ? "تم إنشاء التكامل" : "Integration created",
        description: isAr
          ? "احفظ سر Webhook الآن — لن يُعرض مرة أخرى."
          : "Save the webhook secret now — it will not be shown again.",
      });
    } catch (e) {
      toast({
        variant: "destructive",
        title: isAr ? "فشل" : "Failed",
        description: e instanceof Error ? e.message : String(e),
      });
    }
  }

  function copyText(text: string) {
    void navigator.clipboard.writeText(text);
    toast({ title: isAr ? "تم النسخ" : "Copied" });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {isAr
            ? "أجهزة البصمة، أنظمة حضور خارجية، Oracle HCM Time، وغيرها عبر Webhook أو REST."
            : "Biometric terminals, external T&A, Oracle time, etc. via webhook or REST poll."}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            <RefreshCw className="w-3.5 h-3.5 me-1" />
            {isAr ? "تحديث" : "Refresh"}
          </Button>
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="w-3.5 h-3.5 me-1" />
            {isAr ? "تكامل جديد" : "New integration"}
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/admin/hr/workforce-ops">
              <ExternalLink className="w-3.5 h-3.5 me-1" />
              {isAr ? "عمليات القوى" : "Workforce Ops"}
            </Link>
          </Button>
        </div>
      </div>

      {(secretReveal || webhookUrlReveal) && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="pt-4 space-y-2 text-xs">
            <p className="font-semibold">{isAr ? "بيانات الربط (مرة واحدة)" : "Connection details (one-time)"}</p>
            {webhookUrlReveal && (
              <div className="flex items-center gap-2 flex-wrap">
                <code className="flex-1 break-all bg-muted px-2 py-1 rounded">{webhookUrlReveal}</code>
                <Button type="button" variant="ghost" size="sm" onClick={() => copyText(webhookUrlReveal)}>
                  <Copy className="w-3.5 h-3.5" />
                </Button>
              </div>
            )}
            {secretReveal && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-muted-foreground">X-Signature secret:</span>
                <code className="flex-1 break-all bg-muted px-2 py-1 rounded">{secretReveal}</code>
                <Button type="button" variant="ghost" size="sm" onClick={() => copyText(secretReveal)}>
                  <Copy className="w-3.5 h-3.5" />
                </Button>
              </div>
            )}
            <p className="text-muted-foreground">
              {isAr
                ? 'أرسل JSON: {"events":[{"externalEventId":"1","externalEmployeeId":"E001","eventType":"clock_in","occurredAt":"2026-05-20T08:00:00Z"}]}'
                : 'POST JSON: {"events":[{"externalEventId":"1","externalEmployeeId":"E001","eventType":"clock_in","occurredAt":"2026-05-20T08:00:00Z"}]}'}
            </p>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
          <Loader2 className="w-4 h-4 animate-spin" />
          {isAr ? "جاري التحميل..." : "Loading..."}
        </div>
      ) : list.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {isAr ? "لا توجد تكاملات حضور. أنشئ تكاملًا لربط نظام خارجي." : "No attendance integrations yet."}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {list.map((item) => {
            const label = ATTENDANCE_CONNECTOR_LABELS[item.connectorKey];
            return (
              <Card key={item.id}>
                <CardContent className="py-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{item.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {isAr ? label?.ar ?? item.connectorKey : label?.en ?? item.connectorKey}
                      {" · "}
                      ID {item.id}
                    </p>
                    <p className="text-xs font-mono mt-1 text-muted-foreground break-all">
                      {buildAttendanceWebhookUrl(item.id)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={item.isEnabled ? "default" : "outline"}>
                      {item.isEnabled ? (isAr ? "مفعّل" : "On") : isAr ? "معطّل" : "Off"}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {item.lastSyncAt
                        ? new Date(item.lastSyncAt).toLocaleString()
                        : isAr
                          ? "لم تُزامَن"
                          : "Never synced"}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={test.isPending}
                      onClick={() =>
                        test.mutate(item.id, {
                          onSuccess: (r) =>
                            toast({
                              title: r.ok ? (isAr ? "نجح" : "OK") : (isAr ? "فشل" : "Failed"),
                              description: r.message,
                            }),
                        })
                      }
                    >
                      {isAr ? "اختبار" : "Test"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={sync.isPending}
                      onClick={() => sync.mutate(item.id)}
                    >
                      {isAr ? "مزامنة" : "Sync"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        update.mutate(
                          { id: item.id, rotateWebhookSecret: true },
                          {
                            onSuccess: (r) => {
                              if (r.webhookSecretOnce) setSecretReveal(r.webhookSecretOnce);
                              if (r.webhookUrl) setWebhookUrlReveal(r.webhookUrl);
                              toast({ title: isAr ? "تم تدوير السر" : "Secret rotated" });
                            },
                          },
                        )
                      }
                    >
                      {isAr ? "سر جديد" : "Rotate secret"}
                    </Button>
                    <Switch
                      checked={item.isEnabled}
                      onCheckedChange={(v) => update.mutate({ id: item.id, isEnabled: v })}
                    />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{isAr ? "تكامل حضور جديد" : "New attendance integration"}</DialogTitle>
            <DialogDescription>
              {isAr
                ? "اختر نوع الربط. بعد الإنشاء انسخ رابط Webhook والسر إلى النظام الخارجي."
                : "Pick a connector. After create, copy webhook URL and secret to your external system."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>{isAr ? "الاسم" : "Name"}</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="ZKTeco / Oracle Time" />
            </div>
            <div>
              <Label>{isAr ? "نوع الموصل" : "Connector"}</Label>
              <Select value={connectorKey} onValueChange={setConnectorKey}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {connectors.map((c) => (
                    <SelectItem key={c.connectorKey} value={c.connectorKey}>
                      {ATTENDANCE_CONNECTOR_LABELS[c.connectorKey]?.en ?? c.connectorKey}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {(connectorKey === "generic_rest_poll" || connectorKey === "direct_api") && (
              <>
                <div>
                  <Label>{isAr ? "رابط API الخارجي" : "External API URL"}</Label>
                  <Input value={pollUrl} onChange={(e) => setPollUrl(e.target.value)} placeholder="https://vendor.example/api/events" />
                </div>
                <div>
                  <Label>Bearer / API Key</Label>
                  <Input type="password" value={bearerToken} onChange={(e) => setBearerToken(e.target.value)} />
                </div>
                <div>
                  <Label>{isAr ? "فترة السحب (دقائق)" : "Poll interval (min)"}</Label>
                  <Input value={pollMinutes} onChange={(e) => setPollMinutes(e.target.value)} />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {isAr ? "إلغاء" : "Cancel"}
            </Button>
            <Button onClick={() => void handleCreate()} disabled={create.isPending || !name.trim()}>
              {create.isPending && <Loader2 className="w-4 h-4 animate-spin me-1" />}
              {isAr ? "إنشاء" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  fromEmail: string;
  fromName: string | null;
  replyToEmail: string | null;
  isVerified?: boolean;
  lastTestStatus?: string | null;
};

function WorkspaceSmtpSection({ isAr }: { isAr: boolean }) {
  const apiFetch = useApiFetch();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useQuery({
    queryKey: ["/api/hr/workspace/smtp-config"],
    queryFn: async () => {
      const res = await apiFetch("/api/hr/workspace/smtp-config");
      if (!res.ok) throw new Error("Failed");
      const json = await res.json();
      return json as SmtpConfig | null;
    },
  });

  const [form, setForm] = useState({
    host: "",
    port: "587",
    username: "",
    password: "",
    fromEmail: "",
    fromName: "",
    replyToEmail: "",
    secure: false,
  });

  useEffect(() => {
    if (data) {
      setForm((f) => ({
        ...f,
        host: data.host ?? "",
        port: String(data.port ?? 587),
        username: data.username ?? "",
        fromEmail: data.fromEmail ?? "",
        fromName: data.fromName ?? "",
        replyToEmail: data.replyToEmail ?? "",
        secure: data.secure ?? false,
      }));
    }
  }, [data]);

  const save = useMutation({
    mutationFn: async () => {
      const res = await apiFetch("/api/hr/workspace/smtp-config", {
        method: "PUT",
        body: JSON.stringify({
          host: form.host,
          port: Number(form.port),
          username: form.username,
          password: form.password || undefined,
          fromEmail: form.fromEmail,
          fromName: form.fromName || null,
          replyToEmail: form.replyToEmail || null,
          secure: form.secure,
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "Save failed");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/hr/workspace/smtp-config"] });
      toast({ title: isAr ? "تم الحفظ" : "Saved" });
      setForm((f) => ({ ...f, password: "" }));
    },
    onError: (e) =>
      toast({ variant: "destructive", description: e instanceof Error ? e.message : String(e) }),
  });

  const test = useMutation({
    mutationFn: async () => {
      const res = await apiFetch("/api/hr/workspace/smtp-config/test", {
        method: "POST",
        body: JSON.stringify({ toEmail: form.fromEmail }),
      });
      if (!res.ok) throw new Error("Test failed");
      return res.json() as { ok?: boolean; message?: string };
    },
    onSuccess: (r) =>
      toast({
        title: r.ok ? (isAr ? "نجح الاختبار" : "Test OK") : (isAr ? "فشل" : "Failed"),
        description: r.message,
      }),
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
        <Loader2 className="w-4 h-4 animate-spin" />
        {isAr ? "جاري التحميل..." : "Loading..."}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Mail className="w-4 h-4" />
          {isAr ? "بريد SMTP للمساحة" : "Workspace SMTP"}
        </CardTitle>
        <CardDescription>
          {isAr
            ? "ربط خادم بريدك (Office 365، Gmail SMTP، Exchange…) لإرسال الدعوات والإشعارات."
            : "Connect your mail server (Office 365, Gmail SMTP, Exchange…) for invites and notifications."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {data?.lastTestStatus && (
          <p className="text-xs flex items-center gap-1">
            {data.lastTestStatus === "ok" ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            ) : (
              <XCircle className="w-3.5 h-3.5 text-destructive" />
            )}
            {isAr ? "آخر اختبار:" : "Last test:"} {data.lastTestStatus}
          </p>
        )}
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <Label>Host</Label>
            <Input value={form.host} onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))} />
          </div>
          <div>
            <Label>Port</Label>
            <Input value={form.port} onChange={(e) => setForm((f) => ({ ...f, port: e.target.value }))} />
          </div>
          <div>
            <Label>{isAr ? "اسم المستخدم" : "Username"}</Label>
            <Input value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} />
          </div>
          <div>
            <Label>{isAr ? "كلمة المرور" : "Password"}</Label>
            <Input
              type="password"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              placeholder={data ? (isAr ? "اتركه فارغًا للإبقاء" : "Leave blank to keep") : ""}
            />
          </div>
          <div>
            <Label>From email</Label>
            <Input value={form.fromEmail} onChange={(e) => setForm((f) => ({ ...f, fromEmail: e.target.value }))} />
          </div>
          <div>
            <Label>From name</Label>
            <Input value={form.fromName} onChange={(e) => setForm((f) => ({ ...f, fromName: e.target.value }))} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Switch checked={form.secure} onCheckedChange={(v) => setForm((f) => ({ ...f, secure: v }))} />
          <Label>TLS / secure</Label>
        </div>
        <div className="flex gap-2 pt-2">
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending && <Loader2 className="w-4 h-4 animate-spin me-1" />}
            {isAr ? "حفظ" : "Save"}
          </Button>
          <Button variant="outline" onClick={() => test.mutate()} disabled={test.isPending || !form.fromEmail}>
            {isAr ? "اختبار" : "Test"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
