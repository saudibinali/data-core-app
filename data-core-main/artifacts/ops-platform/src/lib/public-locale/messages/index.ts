import type { PublicLocale, PublicMessages } from "../types";
import { enNav, enHome, enContact } from "./en/common";
import { enAbout } from "./en/about";
import { arNav, arHome, arContact } from "./ar/common";
import { arAbout } from "./ar/about";

const enMessages: PublicMessages = {
  nav: enNav,
  home: enHome,
  contact: enContact,
  about: enAbout,
  language: {
    en: "English",
    ar: "العربية",
    switchLabel: "Language",
  },
};

const arMessages: PublicMessages = {
  nav: arNav,
  home: arHome,
  contact: arContact,
  about: arAbout,
  language: {
    en: "English",
    ar: "العربية",
    switchLabel: "اللغة",
  },
};

export function getPublicMessages(locale: PublicLocale): PublicMessages {
  return locale === "ar" ? arMessages : enMessages;
}
