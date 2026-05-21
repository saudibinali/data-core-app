import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Globe, Database, Server, Lock, User, Hash,
  CheckCircle2, XCircle, AlertTriangle, ArrowRight,
  Loader2, ShieldCheck, Wifi, WifiOff,
} from "lucide-react";

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

// ── Types ──────────────────────────────────────────────────────────────────

interface DbForm {
  host: string;
  port: string;
  database: string;
  user: string;
  password: string;
  ssl: "disable" | "require" | "verify-full";
}

interface SetupDatabasePageProps {
  onComplete: () => void;
}

// ── Component ──────────────────────────────────────────────────────────────

export default function SetupDatabasePage({ onComplete }: SetupDatabasePageProps) {
  const { i18n } = useTranslation();
  const isRtl = i18n.language.startsWith("ar");

  const [form, setForm] = useState<DbForm>({
    host: "localhost",
    port: "5432",
    database: "",
    user: "",
    password: "",
    ssl: "disable",
  });

  const [showPassword, setShowPassword] = useState(false);
  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "ok" | "fail">("idle");
  const [testError, setTestError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [done, setDone] = useState(false);

  const set = (k: keyof DbForm) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setTestStatus("idle");
    setTestError("");
    setSaveError("");
  };

  const formPayload = () => ({
    host: form.host.trim(),
    port: Number(form.port),
    database: form.database.trim(),
    user: form.user.trim(),
    password: form.password,
    ssl: form.ssl,
  });

  // ── Test connection ──────────────────────────────────────────────────────

  const handleTest = async () => {
    setTestStatus("testing");
    setTestError("");
    try {
      const r = await fetch("/api/setup/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formPayload()),
      });
      const data = await r.json() as { ok: boolean; error?: string };
      if (data.ok) {
        setTestStatus("ok");
      } else {
        setTestStatus("fail");
        setTestError(data.error ?? "Connection failed");
      }
    } catch {
      setTestStatus("fail");
      setTestError("Network error - is the server running?");
    }
  };

  // ── Save & continue ──────────────────────────────────────────────────────

  const handleSave = async () => {
    setSaving(true);
    setSaveError("");
    try {
      const r = await fetch("/api/setup/database", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formPayload()),
      });
      const data = await r.json() as { ok: boolean; error?: string };
      if (data.ok) {
        setDone(true);
        setTimeout(() => onComplete(), 1200);
      } else {
        setSaveError(data.error ?? "Failed to save configuration");
      }
    } catch {
      setSaveError("Network error - please try again");
    } finally {
      setSaving(false);
    }
  };

  const canSave = form.host && form.database && form.user && form.port && !saving;

  // ── Input class helper ───────────────────────────────────────────────────

  const inputCls =
    "w-full py-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition disabled:opacity-60";

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div dir={isRtl ? "rtl" : "ltr"} className="min-h-[100dvh] bg-gradient-to-br from-zinc-50 via-blue-50/30 to-zinc-100 dark:from-zinc-950 dark:via-blue-950/20 dark:to-zinc-900 flex flex-col">

      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center">
            <ShieldCheck className="w-4 h-4 text-primary-foreground" />
          </div>
          <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">OpsPlatform</span>
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
              <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Database Connected</h2>
              <p className="mt-1 text-zinc-500 dark:text-zinc-400">Preparing your platform...</p>
            </div>
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mt-2" />
          </div>
        ) : (
          <div className="w-full max-w-[520px]">

            {/* Step indicator */}
            <div className="flex items-center justify-center gap-3 mb-8">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">1</div>
                <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Database</span>
              </div>
              <div className="h-px w-10 bg-zinc-300 dark:bg-zinc-700" />
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full border-2 border-zinc-300 dark:border-zinc-600 text-zinc-400 flex items-center justify-center text-xs font-bold">2</div>
                <span className="text-sm text-zinc-400 dark:text-zinc-500">Admin Account</span>
              </div>
            </div>

            {/* Header */}
            <div className="text-center mb-6">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-semibold mb-3 border border-primary/20">
                <Database className="w-3.5 h-3.5" />
                Step 1 of 2
              </div>
              <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Connect your database</h1>
              <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400 max-w-sm mx-auto">
                Enter your PostgreSQL connection details. The platform will apply the schema automatically.
              </p>
            </div>

            {/* Form card */}
            <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-xl overflow-hidden">
              <div className="p-7 space-y-5">

                {/* Host + Port row */}
                <div className="grid grid-cols-[1fr_100px] gap-3">
                  <div className="space-y-1.5">
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Host</label>
                    <div className="relative">
                      <Server className="absolute top-1/2 -translate-y-1/2 start-3 w-4 h-4 text-zinc-400 pointer-events-none" />
                      <input
                        type="text"
                        value={form.host}
                        onChange={set("host")}
                        placeholder="localhost"
                        disabled={saving}
                        className={`${inputCls} ps-9 pe-3`}
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Port</label>
                    <input
                      type="number"
                      value={form.port}
                      onChange={set("port")}
                      placeholder="5432"
                      min={1}
                      max={65535}
                      disabled={saving}
                      className={`${inputCls} px-3`}
                    />
                  </div>
                </div>

                {/* Database name */}
                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Database name</label>
                  <div className="relative">
                    <Database className="absolute top-1/2 -translate-y-1/2 start-3 w-4 h-4 text-zinc-400 pointer-events-none" />
                    <input
                      type="text"
                      value={form.database}
                      onChange={set("database")}
                      placeholder="ops_db"
                      disabled={saving}
                      className={`${inputCls} ps-9 pe-3`}
                    />
                  </div>
                </div>

                {/* Username */}
                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Username</label>
                  <div className="relative">
                    <User className="absolute top-1/2 -translate-y-1/2 start-3 w-4 h-4 text-zinc-400 pointer-events-none" />
                    <input
                      type="text"
                      value={form.user}
                      onChange={set("user")}
                      placeholder="postgres"
                      autoComplete="username"
                      disabled={saving}
                      className={`${inputCls} ps-9 pe-3`}
                    />
                  </div>
                </div>

                {/* Password */}
                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Password</label>
                  <div className="relative">
                    <Lock className="absolute top-1/2 -translate-y-1/2 start-3 w-4 h-4 text-zinc-400 pointer-events-none" />
                    <input
                      type={showPassword ? "text" : "password"}
                      value={form.password}
                      onChange={set("password")}
                      placeholder="••••••••"
                      autoComplete="current-password"
                      disabled={saving}
                      className={`${inputCls} ps-9 pe-10`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      tabIndex={-1}
                      className="absolute top-1/2 -translate-y-1/2 end-3 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition"
                    >
                      <Hash className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* SSL mode */}
                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">SSL mode</label>
                  <select
                    value={form.ssl}
                    onChange={set("ssl")}
                    disabled={saving}
                    className={`${inputCls} px-3 cursor-pointer`}
                  >
                    <option value="disable">Disabled - no SSL (local / private network)</option>
                    <option value="require">Required - encrypted, certificate not verified</option>
                    <option value="verify-full">Verify Full - encrypted + certificate verified</option>
                  </select>
                </div>

                {/* Test connection result */}
                {testStatus === "ok" && (
                  <div className="flex items-center gap-2.5 rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 px-3.5 py-2.5 text-sm text-green-700 dark:text-green-400">
                    <Wifi className="w-4 h-4 shrink-0" />
                    Connection successful - ready to continue
                  </div>
                )}
                {testStatus === "fail" && (
                  <div className="flex items-start gap-2.5 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-3.5 py-2.5 text-sm text-red-700 dark:text-red-400">
                    <WifiOff className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{testError}</span>
                  </div>
                )}

                {/* Save error */}
                {saveError && (
                  <div className="flex items-start gap-2.5 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-3.5 py-2.5 text-sm text-red-700 dark:text-red-400">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{saveError}</span>
                  </div>
                )}

                {/* Actions */}
                <div className="flex flex-col gap-3 pt-1">
                  {/* Test button */}
                  <button
                    type="button"
                    onClick={handleTest}
                    disabled={testStatus === "testing" || saving || !form.host || !form.database || !form.user}
                    className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 text-sm font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  >
                    {testStatus === "testing" ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Testing connection...</>
                    ) : testStatus === "ok" ? (
                      <><CheckCircle2 className="w-4 h-4 text-green-500" /> Test again</>
                    ) : (
                      <><Wifi className="w-4 h-4" /> Test connection</>
                    )}
                  </button>

                  {/* Save & continue button */}
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={!canSave}
                    className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-primary text-primary-foreground rounded-lg font-medium text-sm hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  >
                    {saving ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Applying configuration...</>
                    ) : (
                      <>Save & continue <ArrowRight className="w-4 h-4" /></>
                    )}
                  </button>
                </div>
              </div>

              {/* Info footer */}
              <div className="px-7 pb-5">
                <div className="flex items-start gap-2 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 px-3.5 py-2.5 text-xs text-blue-700 dark:text-blue-400">
                  <XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 opacity-0" />
                  <span>
                    Your credentials are used only to connect to your database and are stored securely on the server. The schema will be applied automatically.
                  </span>
                </div>
              </div>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}
