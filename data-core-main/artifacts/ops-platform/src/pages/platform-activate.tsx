/**
 * @phase P17-E - Public platform user activation page
 */

import { useEffect, useState } from "react";
import { useLocation, Link } from "wouter";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { PLATFORM_INVITATION_API } from "@/lib/platform-user-invitation-config";

type VerifyState =
  | { phase: "loading" }
  | { phase: "invalid"; message: string }
  | {
      phase: "ready";
      email: string | null;
      expiresAt: string | null;
      displayName: string | null;
    };

type AcceptState = "idle" | "submitting" | "success" | "error";

export default function PlatformActivatePage() {
  const [location] = useLocation();
  const token = new URLSearchParams(
    location.includes("?") ? location.slice(location.indexOf("?")) : window.location.search,
  ).get("token");

  const [verify, setVerify] = useState<VerifyState>({ phase: "loading" });
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [employeeNumber, setEmployeeNumber] = useState("");
  const [acceptState, setAcceptState] = useState<AcceptState>("idle");
  const [acceptError, setAcceptError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setVerify({ phase: "invalid", message: "Activation token is missing from the URL." });
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(PLATFORM_INVITATION_API.verify(token));
        const data = (await res.json()) as {
          valid: boolean;
          status: string;
          email: string | null;
          expiresAt: string | null;
          displayName?: string | null;
        };
        if (cancelled) return;
        if (!data.valid) {
          setVerify({
            phase: "invalid",
            message: `This invitation is not valid (${data.status}).`,
          });
          return;
        }
        setVerify({
          phase: "ready",
          email: data.email,
          expiresAt: data.expiresAt,
          displayName: data.displayName ?? null,
        });
        if (data.displayName) setDisplayName(data.displayName);
      } catch {
        if (!cancelled) {
          setVerify({ phase: "invalid", message: "Could not verify the activation link." });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleAccept(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setAcceptState("submitting");
    setAcceptError(null);
    try {
      const res = await fetch(PLATFORM_INVITATION_API.accept, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          password,
          displayName: displayName.trim() || undefined,
          employeeNumber: employeeNumber.trim() || undefined,
        }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        setAcceptState("error");
        setAcceptError(body.error ?? "Activation failed");
        return;
      }
      setAcceptState("success");
    } catch {
      setAcceptState("error");
      setAcceptError("Network error during activation");
    }
  }

  return (
    <div
      className="flex min-h-[100dvh] flex-col items-center justify-center bg-zinc-50 dark:bg-zinc-900 px-4 py-12"
      data-testid="platform-activate-page"
    >
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-sm space-y-4">
        <h1 className="text-lg font-semibold text-center">Platform Account Activation</h1>

        {verify.phase === "loading" && (
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-8">
            <Loader2 className="w-4 h-4 animate-spin" />
            Verifying invitation…
          </div>
        )}

        {verify.phase === "invalid" && (
          <div className="text-center space-y-3 py-4" data-testid="activation-failure">
            <XCircle className="w-10 h-10 text-destructive mx-auto" />
            <p className="text-sm text-muted-foreground">{verify.message}</p>
            <Link href="/sign-in" className="text-sm underline text-primary">
              Go to sign in
            </Link>
          </div>
        )}

        {verify.phase === "ready" && acceptState !== "success" && (
          <form onSubmit={handleAccept} className="space-y-4" data-testid="activation-form">
            <p className="text-sm text-muted-foreground text-center">
              Activate account for <span className="font-medium text-foreground">{verify.email ?? "—"}</span>
              {verify.expiresAt && (
                <span className="block text-xs mt-1">
                  Expires {new Date(verify.expiresAt).toLocaleString()}
                </span>
              )}
            </p>

            <label className="block text-xs font-medium">
              Display name (optional)
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                autoComplete="name"
              />
            </label>

            <label className="block text-xs font-medium">
              Employee number (optional)
              <input
                type="text"
                value={employeeNumber}
                onChange={(e) => setEmployeeNumber(e.target.value.toUpperCase())}
                className="mt-1 w-full rounded-md border px-3 py-2 text-sm font-mono"
                autoComplete="username"
              />
            </label>

            <label className="block text-xs font-medium">
              Password (required, min 8 characters)
              <input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                autoComplete="new-password"
              />
            </label>

            {acceptError && (
              <p className="text-xs text-destructive" data-testid="activation-error">
                {acceptError}
              </p>
            )}

            <button
              type="submit"
              disabled={acceptState === "submitting"}
              className="w-full py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
              data-testid="activate-submit"
            >
              {acceptState === "submitting" ? "Activating…" : "Activate account"}
            </button>
          </form>
        )}

        {acceptState === "success" && (
          <div className="text-center space-y-3 py-4" data-testid="activation-success">
            <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto" />
            <p className="text-sm">Your platform account is active. Sign in with your employee number and password.</p>
            <Link href="/sign-in" className="inline-block text-sm underline text-primary">
              Go to sign in
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
