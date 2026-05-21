import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { PublicAuthNav } from "@/components/layout/public-auth-nav";
import { usePublicEnglish } from "@/hooks/use-public-english";

/** Official public home page (DCCHOME). */
export default function DccHomePage() {
  const { t } = useTranslation();
  usePublicEnglish();

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background" lang="en" dir="ltr">
      <PublicAuthNav variant="home" />

      <main className="flex-1 flex flex-col items-center justify-center px-4 sm:px-6 py-16 sm:py-24">
        <div className="max-w-2xl w-full text-center space-y-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-border bg-muted text-xs font-medium text-muted-foreground mb-4">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            {t("dcc_home_badge")}
          </div>

          <p className="text-xs font-semibold uppercase tracking-widest text-primary">DCCHOME</p>

          <h1 className="text-3xl sm:text-4xl lg:text-6xl font-bold tracking-tight text-foreground leading-tight">
            {t("landing_title")}
          </h1>

          <p className="text-base sm:text-lg text-muted-foreground max-w-xl mx-auto leading-relaxed">
            {t("landing_subtitle")}
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-4">
            <Link
              href="/sign-in"
              className="inline-flex h-11 w-full sm:w-auto items-center justify-center rounded-md bg-primary px-8 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t("sign_in")} →
            </Link>
            <Link
              href="/sign-in"
              className="inline-flex h-11 w-full sm:w-auto items-center justify-center rounded-md border border-border px-8 text-sm font-medium text-foreground hover:bg-accent transition-colors"
            >
              Employee sign-in
            </Link>
          </div>
        </div>
      </main>

      <footer className="border-t border-border px-4 sm:px-6 lg:px-12 py-6 text-center text-xs text-muted-foreground">
        {t("dcc_home_footer")}
      </footer>
    </div>
  );
}
