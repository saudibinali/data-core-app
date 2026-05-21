import { useEffect } from "react";
import { useTranslation } from "react-i18next";

/** Forces English + LTR on public entry pages (DCCHOME, sign-in, setup). */
export function usePublicEnglish() {
  const { i18n } = useTranslation();

  useEffect(() => {
    void i18n.changeLanguage("en");
    document.documentElement.dir = "ltr";
    document.documentElement.lang = "en";
  }, [i18n]);
}
