import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity } from "lucide-react";

type RuntimeHealth = {
  overallStatus?: string;
  components?: { name: string; status: string; message?: string }[];
};

type CutoverReadiness = {
  ready?: boolean;
  blockers?: string[];
};

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export function PlatformHealthCard({ isAr }: { isAr: boolean }) {
  const runtime = useQuery({
    queryKey: ["platform-runtime-health"],
    queryFn: () => fetchJson<RuntimeHealth>("/api/platform/runtime/health"),
    retry: 1,
  });
  const cutover = useQuery({
    queryKey: ["hr-cutover-readiness"],
    queryFn: () => fetchJson<CutoverReadiness>("/api/hr/settings/cutover-readiness"),
    retry: 1,
  });

  if (runtime.isLoading && cutover.isLoading) {
    return <Skeleton className="h-28 w-full" />;
  }

  const status = runtime.data?.overallStatus ?? (runtime.isError ? "unknown" : "ok");
  const ready = cutover.data?.ready;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          {isAr ? "صحة المنصة والجاهزية" : "Platform health & cutover"}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2 text-sm">
        <Badge variant={status === "ok" || status === "healthy" ? "secondary" : "outline"}>
          {isAr ? "التشغيل:" : "Runtime:"} {status}
        </Badge>
        {ready !== undefined && (
          <Badge variant={ready ? "secondary" : "destructive"}>
            {isAr ? "القطع:" : "Cutover:"} {ready ? (isAr ? "جاهز" : "ready") : (isAr ? "محظور" : "blocked")}
          </Badge>
        )}
        {cutover.data?.blockers?.slice(0, 3).map((b) => (
          <span key={b} className="text-xs text-muted-foreground w-full">{b}</span>
        ))}
      </CardContent>
    </Card>
  );
}
