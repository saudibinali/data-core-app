import type { PublicLocale } from "./types";

export const PUBLIC_LOCALE_STORAGE_KEY = "dcc_public_locale";

export function readPublicLocale(): PublicLocale {
  try {
    const v = localStorage.getItem(PUBLIC_LOCALE_STORAGE_KEY);
    if (v === "ar" || v === "en") return v;
  } catch {
    /* ignore */
  }
  return "en";
}

export function writePublicLocale(locale: PublicLocale): void {
  try {
    localStorage.setItem(PUBLIC_LOCALE_STORAGE_KEY, locale);
  } catch {
    /* ignore */
  }
}

export function publicLocaleDir(locale: PublicLocale): "ltr" | "rtl" {
  return locale === "ar" ? "rtl" : "ltr";
}
