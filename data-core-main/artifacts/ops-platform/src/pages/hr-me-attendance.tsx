import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Clock, LogIn, LogOut, MapPin, AlertTriangle, CheckCircle2, History, ArrowLeft,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type WorkforceStatus = {
  clockState: string;
  canClockIn: boolean;
  canClockOut: boolean;
  firstIn: string | null;
  lastOut: string | null;
  workedMinutes: number;
  warnings: Array<{ code: string; message: string }>;
  pendingReview: boolean;
  recentPunches: Array<{ id: number; eventType: string; occurredAt: string; hasLocation: boolean }>;
  policy: { geofenceRequired: boolean; allowRemoteClock: boolean; minAccuracyMeters: number };
  employeeName?: string;
  workLocation?: string | null;
};

function formatWorked(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

async function getBrowserLocation(): Promise<{
  lat: number;
  lng: number;
  accuracyM?: number;
} | null> {
  if (!navigator.geolocation) return null;
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracyM: pos.coords.accuracy,
        }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    );
  });
}

export default function HrMeAttendancePage() {
  const { i18n } = useTranslation();
  const isAr = i18n.language.startsWith("ar");
  const { toast } = useToast();
  const qc = useQueryClient();
  const [shareLocation, setShareLocation] = useState(true);

  const statusQ = useQuery({
    queryKey: ["/hr/workforce/me/status"],
    queryFn: () => apiClient.get<WorkforceStatus>("/api/hr/workforce/me/status").then((r) => r.data),
    refetchInterval: 60_000,
  });

  const historyQ = useQuery({
    queryKey: ["/hr/workforce/me/history"],
    queryFn: () =>
      apiClient
        .get<Array<Record<string, unknown>>>("/api/hr/workforce/me/history?dateFrom=" + monthAgo())
        .then((r) => r.data),
  });

  const clockMut = useMutation({
    mutationFn: async (eventType: "clock_in" | "clock_out") => {
      let location: { lat: number; lng: number; accuracyM?: number } | undefined;
      if (shareLocation) {
        const loc = await getBrowserLocation();
        if (loc) location = loc;
        else if (statusQ.data?.policy.geofenceRequired) {
          throw new Error(isAr ? "الموقع مطلوب للتسجيل" : "Location required for clock");
        }
      }
      return apiClient
        .post(`/api/hr/workforce/clock-${eventType === "clock_in" ? "in" : "out"}`, { location })
        .then((r) => r.data as { warnings?: Array<{ message: string }> });
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["/hr/workforce/me/status"] });
      qc.invalidateQueries({ queryKey: ["/hr/workforce/me/history"] });
      const warns = data?.warnings?.length
        ? data.warnings.map((w) => w.message).join("; ")
        : undefined;
      toast({
        title: isAr ? "تم التسجيل" : "Clock recorded",
        description: warns,
      });
    },
    onError: (e: Error) =>
      toast({ title: isAr ? "فشل التسجيل" : "Clock failed", description: e.message, variant: "destructive" }),
  });

  const status = statusQ.data;
  const history = historyQ.data ?? [];

  const stateLabel = useCallback(
    (s: string) => {
      const map: Record<string, { en: string; ar: string }> = {
        not_started: { en: "Not started", ar: "لم يبدأ" },
        clocked_in: { en: "Clocked in", ar: "مسجّل دخول" },
        clocked_out: { en: "Clocked out", ar: "مسجّل خروج" },
        complete: { en: "Complete", ar: "مكتمل" },
      };
      return map[s] ? (isAr ? map[s]!.ar : map[s]!.en) : s;
    },
    [isAr],
  );

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6" dir={isAr ? "rtl" : "ltr"}>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Clock className="w-7 h-7" />
            {isAr ? "حضوري" : "My Attendance"}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isAr
              ? "تسجيل الدخول والخروج — الموقع يُستخدم عند الضغط فقط"
              : "Clock in/out — location captured only when you punch"}
          </p>
        </div>
        <Link href={`${BASE}/self-service`}>
          <Button variant="outline" size="sm">
            <ArrowLeft className="w-4 h-4 me-1" />
            {isAr ? "الخدمة الذاتية" : "Self-Service"}
          </Button>
        </Link>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">{isAr ? "الحالة اليوم" : "Today's status"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {statusQ.isLoading ? (
            <p className="text-muted-foreground text-sm">{isAr ? "جارٍ التحميل..." : "Loading..."}</p>
          ) : status ? (
            <>
              <div className="flex flex-wrap gap-2 items-center">
                <Badge variant="outline" className="text-base px-3 py-1">
                  {stateLabel(status.clockState)}
                </Badge>
                {status.pendingReview && (
                  <Badge variant="secondary" className="gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    {isAr ? "مراجعة" : "Review"}
                  </Badge>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">{isAr ? "دخول" : "First in"}</p>
                  <p className="font-semibold">{status.firstIn ?? "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">{isAr ? "خروج" : "Last out"}</p>
                  <p className="font-semibold">{status.lastOut ?? "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">{isAr ? "ساعات العمل" : "Worked"}</p>
                  <p className="font-semibold">{formatWorked(status.workedMinutes)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">{isAr ? "الموقع" : "Work location"}</p>
                  <p className="font-semibold">{status.workLocation ?? "—"}</p>
                </div>
              </div>

              {status.warnings.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm space-y-1">
                  {status.warnings.map((w) => (
                    <p key={w.code} className="flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
                      {w.message}
                    </p>
                  ))}
                </div>
              )}

              <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={shareLocation}
                  onChange={(e) => setShareLocation(e.target.checked)}
                  className="rounded"
                />
                <MapPin className="w-4 h-4" />
                {isAr
                  ? "مشاركة الموقع عند التسجيل فقط (لا تتبع في الخلفية)"
                  : "Share location when punching only (no background tracking)"}
              </label>

              <div className="flex gap-3 pt-2">
                <Button
                  className="flex-1"
                  disabled={!status.canClockIn || clockMut.isPending}
                  onClick={() => clockMut.mutate("clock_in")}
                >
                  <LogIn className="w-4 h-4 me-2" />
                  {isAr ? "تسجيل دخول" : "Clock In"}
                </Button>
                <Button
                  className="flex-1"
                  variant="secondary"
                  disabled={!status.canClockOut || clockMut.isPending}
                  onClick={() => clockMut.mutate("clock_out")}
                >
                  <LogOut className="w-4 h-4 me-2" />
                  {isAr ? "تسجيل خروج" : "Clock Out"}
                </Button>
              </div>
            </>
          ) : (
            <p className="text-muted-foreground">{isAr ? "لا يوجد ملف موظف" : "No employee profile"}</p>
          )}
        </CardContent>
      </Card>

      {status && status.recentPunches.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5" />
              {isAr ? "آخر التسجيلات اليوم" : "Recent punches today"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {status.recentPunches.map((p) => (
              <div key={p.id} className="flex justify-between border-b pb-2 last:border-0">
                <span>{p.eventType === "clock_in" ? (isAr ? "دخول" : "In") : isAr ? "خروج" : "Out"}</span>
                <span className="text-muted-foreground">
                  {new Date(p.occurredAt).toLocaleTimeString()}
                  {p.hasLocation ? " · GPS" : ""}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <History className="w-5 h-5" />
            {isAr ? "سجل الحضور" : "Attendance history"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {historyQ.isLoading ? (
            <p className="text-sm text-muted-foreground">{isAr ? "جارٍ التحميل..." : "Loading..."}</p>
          ) : history.length === 0 ? (
            <p className="text-sm text-muted-foreground">{isAr ? "لا سجلات" : "No records"}</p>
          ) : (
            <div className="space-y-2 text-sm max-h-64 overflow-y-auto">
              {history.map((h) => (
                <div key={String(h.id)} className="flex justify-between items-center border-b pb-2">
                  <span>{String(h.date)}</span>
                  <span className="text-muted-foreground">
                    {[h.checkIn, h.checkOut].filter(Boolean).join(" → ") || "—"}
                  </span>
                  <Badge variant="outline">{String(h.status)}</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function monthAgo(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}
