import { Globe } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePublicLocale } from "./context";
import type { PublicLocale } from "./types";

interface PublicLanguageSwitcherProps {
  className?: string;
  /** Compact style for narrow headers */
  compact?: boolean;
}

export function PublicLanguageSwitcher({ className, compact }: PublicLanguageSwitcherProps) {
  const { locale, setLocale, messages } = usePublicLocale();

  function select(next: PublicLocale) {
    if (next !== locale) setLocale(next);
  }

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 p-0.5",
        className,
      )}
      role="group"
      aria-label={messages.language.switchLabel}
    >
      {!compact && <Globe className="w-3.5 h-3.5 text-muted-foreground ms-1.5 hidden sm:block" />}
      {(["en", "ar"] as const).map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => select(code)}
          className={cn(
            "rounded px-2 py-1 text-xs font-medium transition-colors min-w-[2.5rem]",
            locale === code
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
          aria-pressed={locale === code}
        >
          {code === "en" ? messages.language.en : messages.language.ar}
        </button>
      ))}
    </div>
  );
}
