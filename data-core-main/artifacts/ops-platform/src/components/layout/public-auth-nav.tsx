import { Link } from "wouter";
import { ArrowLeft, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PublicLanguageSwitcher } from "@/lib/public-locale/PublicLanguageSwitcher";
import { usePublicLocale } from "@/lib/public-locale/context";

type Variant = "home" | "sign-in" | "about" | "contact" | "minimal";

const LOGO_URL = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/official-logo.png`;

interface PublicAuthNavProps {
  variant: Variant;
  className?: string;
}

export function PublicAuthNav({ variant, className }: PublicAuthNavProps) {
  const { messages, isRtl } = usePublicLocale();
  const nav = messages.nav;
  const showPublicLinks = variant === "home" || variant === "about" || variant === "contact";

  const publicLinks: { href: string; label: string; variant: Variant }[] = [
    { href: "/about-platform", label: nav.about, variant: "about" },
    { href: "/contact", label: nav.contact, variant: "contact" },
  ];

  return (
    <header
      className={cn(
        "h-14 sm:h-16 flex items-center justify-between gap-2 sm:gap-3 px-4 sm:px-6 lg:px-12 border-b border-border bg-background shrink-0",
        className,
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
        <Link
          href="/dcc-home"
          className="flex items-center gap-2 font-bold text-base sm:text-lg text-foreground hover:opacity-90 transition-opacity min-w-0"
        >
          <img
            src={LOGO_URL}
            alt={nav.brand}
            className="h-8 w-auto max-w-[120px] object-contain shrink-0"
          />
          <span className="hidden sm:inline truncate">{nav.brand}</span>
        </Link>
      </div>

      <nav className="flex items-center gap-1 sm:gap-2 shrink-0" aria-label="Public navigation">
        <PublicLanguageSwitcher compact />

        {showPublicLinks &&
          publicLinks.map((link) => (
            <Button
              key={link.href}
              variant={variant === link.variant ? "secondary" : "ghost"}
              size="sm"
              className="text-xs sm:text-sm px-2 sm:px-3"
              asChild
            >
              <Link href={link.href}>{link.label}</Link>
            </Button>
          ))}

        {variant === "sign-in" && (
          <Button variant="ghost" size="sm" className="gap-1.5" asChild>
            <Link href="/dcc-home">
              <ArrowLeft className={cn("w-4 h-4", isRtl && "rotate-180")} />
              <span className="hidden sm:inline">{nav.back}</span>
            </Link>
          </Button>
        )}

        {variant === "home" || variant === "about" || variant === "contact" ? (
          <Button size="sm" className="text-xs sm:text-sm" asChild>
            <Link href="/sign-in">{nav.signIn}</Link>
          </Button>
        ) : variant === "sign-in" ? (
          <Button variant="outline" size="sm" className="gap-1.5" asChild>
            <Link href="/dcc-home">
              <Home className="w-4 h-4" />
              <span className="hidden sm:inline">{nav.home}</span>
            </Link>
          </Button>
        ) : null}
      </nav>
    </header>
  );
}
