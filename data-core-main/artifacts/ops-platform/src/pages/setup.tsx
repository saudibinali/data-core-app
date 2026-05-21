import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import {
  Globe, Eye, EyeOff, User, Mail, Hash, Lock, CheckCircle2,
  XCircle, ShieldCheck, AlertTriangle, ArrowRight,
} from "lucide-react";
import { useAppAuth } from "@/lib/auth";

// ── Password strength ──────────────────────────────────────────────────────

interface StrengthResult {
  score: number;       // 0-4
  checks: {
    length: boolean;
    upper: boolean;
    lower: boolean;
    number: boolean;
    special: boolean;
  };
}

function getPasswordStrength(pwd: string): StrengthResult {
  const checks = {
    length:  pwd.length >= 8,
    upper:   /[A-Z]/.test(pwd),
    lower:   /[a-z]/.test(pwd),
    number:  /[0-9]/.test(pwd),
    special: /[^A-Za-z0-9]/.test(pwd),
  };
  const score = Object.values(checks).filter(Boolean).length;
  return { score, checks };
}

// ── Language toggle ────────────────────────────────────────────────────────

function LanguageToggle() {
  const { i18n } = useTranslation();
  const isAr = i18n.language.startsWith("ar");
  return (
    <button
      onClick={() => i18n.changeLanguage(isAr ? "en" : "ar")}
      className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200 transition-colors px-3 py-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800"
    >
      <Globe className="w-4 h-4" />
      <span>{isAr ? "EN" : "ع"}</span>
    </button>
  );
}

// ── Setup page ─────────────────────────────────────────────────────────────

interface SetupPageProps {
  onInitialized: () => void;
}

export default function SetupPage({ onInitialized }: SetupPageProps) {
  const { t, i18n } = useTranslation();
  const [, setLocation] = useLocation();
  const auth = useAppAuth();
  const isRtl = i18n.language.startsWith("ar");

  const [form, setForm] = useState({
    fullName: "",
    email: "",
    employeeNumber: "",
    password: "",
    confirmPassword: "",
  });
  const [showPwd, setShowPwd] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const strength = getPasswordStrength(form.password);

  const strengthLabel = ["", t("setup_strength_weak"), t("setup_strength_fair"), t("setup_strength_good"), t("setup_strength_strong"), t("setup_strength_strong")][strength.score] ?? "";
  const strengthColors = ["", "bg-red-500", "bg-orange-400", "bg-yellow-400", "bg-green-500", "bg-green-500"];
  const strengthColor = strengthColors[strength.score] ?? "";

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!form.fullName.trim() || !form.email.trim() || !form.employeeNumber.trim() || !form.password) {
      setError(t("setup_error_required"));
      return;
    }
    if (form.password !== form.confirmPassword) {
      setError(t("setup_error_mismatch"));
      return;
    }

    setLoading(true);
    try {
      const r = await fetch("/api/setup/initialize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: form.fullName.trim(),
          email: form.email.trim().toLowerCase(),
          employeeNumber: form.employeeNumber.trim().toUpperCase(),
          password: form.password,
        }),
      });

      const data = await r.json().catch(() => ({})) as any;

      if (!r.ok) {
        setError(data.error ?? "Something went wrong");
        return;
      }

      setDone(true);

      const { accessToken } = data as { accessToken: string };
      if (accessToken) {
        localStorage.setItem("ops_access_token", accessToken);
      }

      setTimeout(async () => {
        onInitialized();
        await auth.refreshUser();
        setLocation("/super-admin");
      }, 1800);

    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const requirements = [
    { key: "length",  label: t("setup_req_length"),  met: strength.checks.length  },
    { key: "upper",   label: t("setup_req_upper"),   met: strength.checks.upper   },
    { key: "lower",   label: t("setup_req_lower"),   met: strength.checks.lower   },
    { key: "number",  label: t("setup_req_number"),  met: strength.checks.number  },
    { key: "special", label: t("setup_req_special"), met: strength.checks.special },
  ];

  return (
    <div dir={isRtl ? "rtl" : "ltr"} className="min-h-[100dvh] bg-gradient-to-br from-zinc-50 via-blue-50/30 to-zinc-100 dark:from-zinc-950 dark:via-blue-950/20 dark:to-zinc-900 flex flex-col">

      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center">
            <ShieldCheck className="w-4 h-4 text-primary-foreground" />
          </div>
          <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">Data Core Center</span>
        </div>
        <LanguageToggle />
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-8">

        {/* Success state */}
        {done ? (
          <div className="flex flex-col items-center gap-4 text-center animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="w-20 h-20 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <CheckCircle2 className="w-10 h-10 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Account Created!</h2>
              <p className="mt-1 text-zinc-500 dark:text-zinc-400">Redirecting to your dashboard...</p>
            </div>
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mt-2" />
          </div>
        ) : (
          <div className="w-full max-w-[480px]">

            {/* Header */}
            <div className="text-center mb-8">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-semibold mb-4 border border-primary/20">
                <ShieldCheck className="w-3.5 h-3.5" />
                {t("setup_badge")}
              </div>
              <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">{t("setup_title")}</h1>
              <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400 max-w-sm mx-auto">{t("setup_subtitle")}</p>
            </div>

            {/* Card */}
            <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-xl overflow-hidden">
              <form onSubmit={handleSubmit} className="p-7 space-y-5">

                {/* Full Name */}
                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">{t("setup_field_full_name")}</label>
                  <div className="relative">
                    <User className="absolute top-1/2 -translate-y-1/2 start-3 w-4 h-4 text-zinc-400 pointer-events-none" />
                    <input
                      type="text"
                      value={form.fullName}
                      onChange={set("fullName")}
                      placeholder={t("setup_field_full_name_ph")}
                      autoFocus
                      required
                      disabled={loading}
                      className="w-full ps-9 pe-3 py-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition disabled:opacity-60"
                    />
                  </div>
                </div>

                {/* Email */}
                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">{t("setup_field_email")}</label>
                  <div className="relative">
                    <Mail className="absolute top-1/2 -translate-y-1/2 start-3 w-4 h-4 text-zinc-400 pointer-events-none" />
                    <input
                      type="email"
                      value={form.email}
                      onChange={set("email")}
                      placeholder={t("setup_field_email_ph")}
                      required
                      disabled={loading}
                      className="w-full ps-9 pe-3 py-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition disabled:opacity-60"
                    />
                  </div>
                </div>

                {/* Employee Number */}
                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">{t("setup_field_employee_number")}</label>
                  <div className="relative">
                    <Hash className="absolute top-1/2 -translate-y-1/2 start-3 w-4 h-4 text-zinc-400 pointer-events-none" />
                    <input
                      type="text"
                      value={form.employeeNumber}
                      onChange={set("employeeNumber")}
                      placeholder={t("setup_field_employee_number_ph")}
                      required
                      disabled={loading}
                      className="w-full ps-9 pe-3 py-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition disabled:opacity-60"
                    />
                  </div>
                </div>

                {/* Password */}
                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">{t("setup_field_password")}</label>
                  <div className="relative">
                    <Lock className="absolute top-1/2 -translate-y-1/2 start-3 w-4 h-4 text-zinc-400 pointer-events-none" />
                    <input
                      type={showPwd ? "text" : "password"}
                      value={form.password}
                      onChange={set("password")}
                      placeholder={t("setup_field_password_ph")}
                      required
                      disabled={loading}
                      className="w-full ps-9 pe-10 py-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition disabled:opacity-60"
                    />
                    <button type="button" onClick={() => setShowPwd(v => !v)} tabIndex={-1}
                      className="absolute top-1/2 -translate-y-1/2 end-3 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition">
                      {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>

                  {/* Strength bar */}
                  {form.password && (
                    <div className="space-y-2 pt-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-zinc-500">{t("setup_password_strength")}</span>
                        <span className={`font-medium ${strength.score <= 1 ? "text-red-500" : strength.score <= 2 ? "text-orange-500" : strength.score <= 3 ? "text-yellow-600" : "text-green-600"}`}>
                          {strengthLabel}
                        </span>
                      </div>
                      <div className="flex gap-1">
                        {[1, 2, 3, 4, 5].map(i => (
                          <div key={i} className={`h-1 flex-1 rounded-full transition-all duration-300 ${i <= strength.score ? strengthColor : "bg-zinc-200 dark:bg-zinc-700"}`} />
                        ))}
                      </div>
                      <div className="grid grid-cols-1 gap-1 pt-1">
                        {requirements.map(r => (
                          <div key={r.key} className="flex items-center gap-1.5 text-xs">
                            {r.met
                              ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" />
                              : <XCircle className="w-3.5 h-3.5 text-zinc-300 dark:text-zinc-600 shrink-0" />}
                            <span className={r.met ? "text-zinc-600 dark:text-zinc-300" : "text-zinc-400 dark:text-zinc-500"}>{r.label}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Confirm Password */}
                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">{t("setup_field_confirm_password")}</label>
                  <div className="relative">
                    <Lock className="absolute top-1/2 -translate-y-1/2 start-3 w-4 h-4 text-zinc-400 pointer-events-none" />
                    <input
                      type={showConfirm ? "text" : "password"}
                      value={form.confirmPassword}
                      onChange={set("confirmPassword")}
                      placeholder={t("setup_field_confirm_password_ph")}
                      required
                      disabled={loading}
                      className={`w-full ps-9 pe-10 py-2.5 rounded-lg border bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition disabled:opacity-60 ${
                        form.confirmPassword && form.confirmPassword !== form.password
                          ? "border-red-400 dark:border-red-600"
                          : "border-zinc-200 dark:border-zinc-700"
                      }`}
                    />
                    <button type="button" onClick={() => setShowConfirm(v => !v)} tabIndex={-1}
                      className="absolute top-1/2 -translate-y-1/2 end-3 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition">
                      {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {form.confirmPassword && form.confirmPassword !== form.password && (
                    <p className="text-xs text-red-500 flex items-center gap-1">
                      <XCircle className="w-3.5 h-3.5" /> {t("setup_error_mismatch")}
                    </p>
                  )}
                </div>

                {/* Error */}
                {error && (
                  <div className="flex items-start gap-2.5 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-3.5 py-2.5 text-sm text-red-700 dark:text-red-400">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                )}

                {/* Submit */}
                <button
                  type="submit"
                  disabled={loading || strength.score < 5 || form.password !== form.confirmPassword}
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-primary text-primary-foreground rounded-lg font-medium text-sm hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  {loading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-primary-foreground/40 border-t-primary-foreground rounded-full animate-spin" />
                      {t("setup_creating")}
                    </>
                  ) : (
                    <>
                      {t("setup_submit")}
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </form>

              {/* Security note footer */}
              <div className="px-7 pb-5">
                <div className="flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-3.5 py-2.5 text-xs text-amber-700 dark:text-amber-400">
                  <ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{t("setup_security_note")}</span>
                </div>
              </div>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}
