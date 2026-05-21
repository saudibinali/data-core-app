import { useQuery } from "@tanstack/react-query";
import type { PlatformBranding } from "@/lib/platform-branding";

async function fetchPlatformBranding(): Promise<PlatformBranding> {
  const res = await fetch("/api/platform/branding");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<PlatformBranding>;
}

export function usePlatformBranding() {
  return useQuery({
    queryKey: ["platform", "branding"],
    queryFn: fetchPlatformBranding,
    staleTime: 60_000,
    retry: 1,
  });
}
