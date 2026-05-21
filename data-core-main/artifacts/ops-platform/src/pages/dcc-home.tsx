import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { PublicAuthNav } from "@/components/layout/public-auth-nav";
import { usePublicEnglish } from "@/hooks/use-public-english";
import { ChevronRight, Info } from "lucide-react";

const LOGO_URL = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/official-logo.png`;

/** Official public home page (DCCHOME). */
export default function DccHomePage() {
  const { t } = useTranslation();
  usePublicEnglish();

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background" lang="en" dir="ltr">
      <PublicAuthNav variant="home" />

      <main className="flex-1 flex flex-col">
        <section
          className="flex-1 flex flex-col items-center justify-center px-4 sm:px-6 py-12 sm:py-20 relative overflow-hidden"
          style={{
            background: "linear-gradient(180deg, #000000 0%, #0a1628 50%, var(--background) 100%)",
          }}
        >
          <div
            className="absolute inset-0 opacity-25 pointer-events-none"
            style={{
              background:
                "radial-gradient(ellipse 70% 45% at 50% 20%, rgba(0, 123, 255, 0.4) 0%, transparent 65%)",
            }}
          />
          <div className="relative max-w-2xl w-full text-center space-y-6">
            <img
              src={LOGO_URL}
              alt="Data Core Center"
              className="mx-auto w-40 sm:w-52 md:w-64 h-auto object-contain drop-shadow-[0_8px_28px_rgba(0,123,255,0.3)]"
            />

            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-white/15 bg-white/5 text-xs font-medium text-slate-300">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              {t("dcc_home_badge")}
            </div>

            <p className="text-xs font-semibold uppercase tracking-widest text-[#5ba3d0]">DCCHOME</p>

            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-white leading-tight">
              {t("landing_title")}
            </h1>

            <p className="text-base sm:text-lg text-slate-300 max-w-xl mx-auto leading-relaxed">
              {t("landing_subtitle")}
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-4">
              <Link
                href="/sign-in"
                className="inline-flex h-11 w-full sm:w-auto items-center justify-center rounded-md px-8 text-sm font-semibold text-white shadow-sm transition-colors"
                style={{ background: "linear-gradient(90deg, #004080 0%, #007bff 100%)" }}
              >
                {t("sign_in")}
                <ChevronRight className="w-4 h-4 ml-1" />
              </Link>
              <Link
                href="/about-platform"
                className="inline-flex h-11 w-full sm:w-auto items-center justify-center gap-2 rounded-md border border-white/20 bg-white/5 px-8 text-sm font-medium text-slate-100 hover:bg-white/10 transition-colors"
              >
                <Info className="w-4 h-4" />
                About Platform
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border px-4 sm:px-6 lg:px-12 py-6 text-center text-xs text-muted-foreground space-y-2">
        <p>{t("dcc_home_footer")}</p>
        <Link href="/about-platform" className="text-primary hover:underline font-medium">
          About Platform
        </Link>
      </footer>
    </div>
  );
}
