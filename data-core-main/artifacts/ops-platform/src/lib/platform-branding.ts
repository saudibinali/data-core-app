export type PlatformBranding = {
  platformName: string;
  orgName: string;
  logoUrl: string;
  faviconUrl: string;
  primaryColor: string;
  tagline: string;
  supportEmail: string;
  websiteUrl: string;
};

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export function resolveBrandingAssetUrl(url: string | null | undefined): string {
  if (!url?.trim()) return "";
  const u = url.trim();
  if (/^(https?:|data:|blob:)/i.test(u)) return u;
  const pathPart = u.startsWith("/") ? u : `/${u}`;
  return `${window.location.origin}${basePath}${pathPart}`;
}

export function faviconMimeType(url: string): string {
  const lower = url.split("?")[0].toLowerCase();
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return "image/x-icon";
}

export const DEFAULT_FAVICON = `${basePath}/favicon.svg`;
export const DEFAULT_LOGO = `${basePath}/logo.png`;
