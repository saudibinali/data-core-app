import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, GitFork } from "lucide-react";

type PolicyRow = {
  code: string;
  name: string;
  nameAr: string | null;
  routingType: string;
  routingLabel: string;
  chainDepth: number;
  timeoutHours: number;
  description: string | null;
  descriptionAr: string | null;
};

async function fetchTemplates(): Promise<PolicyRow[]> {
  const res = await fetch("/api/hr/approval-templates", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to load templates");
  return res.json();
}

export default function ProcessTemplatesPage() {
  const { i18n } = useTranslation();
  const isAr = i18n.language.startsWith("ar");

  const { data, isLoading, error } = useQuery({
    queryKey: ["approval-templates"],
    queryFn: fetchTemplates,
  });

  return (
    <div className="space-y-6 p-4 md:p-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-3">
        <Link href="/workflows">
          <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <GitFork className="h-6 w-6 text-primary" />
            {isAr ? "قوالب العمليات" : "Process Templates"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isAr
              ? "مسارات موافقة مبنية على الهيكل التنظيمي — بدون أحداث تقنية"
              : "Org-aware approval paths — no technical trigger events"}
          </p>
        </div>
      </div>

      {isLoading && <Skeleton className="h-24 w-full" />}
      {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}

      {data?.map((p) => (
        <Card key={p.code}>
          <CardHeader>
            <CardTitle className="text-base">{isAr && p.nameAr ? p.nameAr : p.name}</CardTitle>
            <CardDescription>{p.code}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>{isAr && p.descriptionAr ? p.descriptionAr : p.description}</p>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{p.routingLabel}</Badge>
              <Badge variant="outline">{p.timeoutHours}h SLA</Badge>
              {p.chainDepth > 1 && <Badge variant="outline">{isAr ? "متسلسل" : "Sequential"} ×{p.chainDepth}</Badge>}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
