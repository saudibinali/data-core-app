import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { Globe } from "lucide-react";

export default function LandingPage() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language.startsWith("ar");

  const toggleLanguage = () => {
    i18n.changeLanguage(isAr ? "en" : "ar");
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="h-16 flex items-center justify-between px-6 lg:px-12 border-b border-border">
        <div className="flex items-center gap-2.5 font-bold text-xl">
          <img
            src={`${import.meta.env.BASE_URL.replace(/\/$/, "")}/logo.png`}
            alt="Logo"
            className="w-8 h-8 rounded"
          />
          <span>{t("app_name")}</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={toggleLanguage}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5 rounded-md hover:bg-accent"
          >
            <Globe className="w-4 h-4" />
            <span>{isAr ? "EN" : "ع"}</span>
          </button>
          <Link
            href="/sign-in"
            className="text-sm font-medium bg-primary text-primary-foreground px-4 py-2 rounded-md hover:bg-primary/90 transition-colors"
          >
            {t("sign_in")}
          </Link>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-6 py-24">
        <div className="max-w-2xl w-full text-center space-y-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-border bg-muted text-xs font-medium text-muted-foreground mb-4">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            {isAr ? "منصة داخلية - للمؤسسات فقط" : "Internal Platform - Enterprise Only"}
          </div>

          <h1 className="text-4xl lg:text-6xl font-bold tracking-tight text-foreground leading-tight">
            {t("landing_title")}
          </h1>

          <p className="text-lg text-muted-foreground max-w-xl mx-auto leading-relaxed">
            {t("landing_subtitle")}
          </p>

          <div className="pt-4">
            <Link
              href="/sign-in"
              className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-8 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t("sign_in")} →
            </Link>
          </div>
        </div>
      </main>

      <footer className="border-t border-border px-6 lg:px-12 py-6 text-center text-xs text-muted-foreground">
        {isAr
          ? "الوصول للموظفين المعتمدين فقط. يتم إنشاء الحسابات من قِبل المسؤولين."
          : "Access is restricted to authorized personnel. Accounts are created by administrators only."}
      </footer>
    </div>
  );
}
