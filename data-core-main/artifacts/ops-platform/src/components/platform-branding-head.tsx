import { useEffect } from "react";
import { usePlatformBranding } from "@/hooks/use-platform-branding";
import {
  DEFAULT_FAVICON,
  faviconMimeType,
  resolveBrandingAssetUrl,
} from "@/lib/platform-branding";

/** Applies document title, favicon, and theme color from platform identity settings. */
export function PlatformBrandingHead() {
  const { data } = usePlatformBranding();

  useEffect(() => {
    if (!data) return;

    if (data.platformName) {
      document.title = data.platformName;
    }

    const faviconHref =
      resolveBrandingAssetUrl(data.faviconUrl) || DEFAULT_FAVICON;
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.href = faviconHref;
    link.type = faviconMimeType(faviconHref);

    if (data.primaryColor) {
      let theme = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
      if (!theme) {
        theme = document.createElement("meta");
        theme.name = "theme-color";
        document.head.appendChild(theme);
      }
      theme.content = data.primaryColor;
    }
  }, [data]);

  return null;
}
