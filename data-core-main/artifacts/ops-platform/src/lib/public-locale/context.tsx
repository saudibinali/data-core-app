import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import type { PublicLocale, PublicMessages } from "./types";
import { getPublicMessages } from "./messages";
import {
  readPublicLocale,
  writePublicLocale,
  publicLocaleDir,
} from "./storage";

interface PublicLocaleContextValue {
  locale: PublicLocale;
  dir: "ltr" | "rtl";
  isRtl: boolean;
  messages: PublicMessages;
  setLocale: (locale: PublicLocale) => void;
}

const PublicLocaleContext = createContext<PublicLocaleContextValue | null>(null);

export function PublicLocaleProvider({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation();
  const [locale, setLocaleState] = useState<PublicLocale>(() => readPublicLocale());

  const applyLocale = useCallback(
    (next: PublicLocale) => {
      setLocaleState(next);
      writePublicLocale(next);
      const dir = publicLocaleDir(next);
      document.documentElement.dir = dir;
      document.documentElement.lang = next;
      void i18n.changeLanguage(next);
    },
    [i18n],
  );

  useEffect(() => {
    const stored = readPublicLocale();
    applyLocale(stored);
  }, [applyLocale]);

  const value = useMemo<PublicLocaleContextValue>(() => {
    const dir = publicLocaleDir(locale);
    return {
      locale,
      dir,
      isRtl: dir === "rtl",
      messages: getPublicMessages(locale),
      setLocale: applyLocale,
    };
  }, [locale, applyLocale]);

  return (
    <PublicLocaleContext.Provider value={value}>{children}</PublicLocaleContext.Provider>
  );
}

export function usePublicLocale(): PublicLocaleContextValue {
  const ctx = useContext(PublicLocaleContext);
  if (!ctx) {
    throw new Error("usePublicLocale must be used within PublicLocaleProvider");
  }
  return ctx;
}
