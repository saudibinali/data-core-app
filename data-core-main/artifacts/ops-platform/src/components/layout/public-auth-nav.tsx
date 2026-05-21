import { Link } from "wouter";
import { ArrowLeft, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Variant = "home" | "sign-in" | "minimal";

interface PublicAuthNavProps {
  variant: Variant;
  className?: string;
}

export function PublicAuthNav({ variant, className }: PublicAuthNavProps) {
  return (
    <header
      className={cn(
        "h-14 sm:h-16 flex items-center justify-between gap-3 px-4 sm:px-6 lg:px-12 border-b border-border bg-background shrink-0",
        className,
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
        <Link
          href="/dcc-home"
          className="flex items-center gap-2 font-bold text-base sm:text-lg text-foreground hover:opacity-90 transition-opacity min-w-0"
        >
          <img
            src={`${import.meta.env.BASE_URL.replace(/\/$/, "")}/logo.png`}
            alt="Data Core Center"
            className="w-8 h-8 rounded shrink-0"
          />
          <span className="truncate">Data Core Center</span>
        </Link>
      </div>

      <nav className="flex items-center gap-2 shrink-0" aria-label="Public navigation">
        {variant === "sign-in" && (
          <Button variant="ghost" size="sm" className="gap-1.5" asChild>
            <Link href="/dcc-home">
              <ArrowLeft className="w-4 h-4" />
              <span className="hidden sm:inline">Back</span>
            </Link>
          </Button>
        )}
        {variant === "home" ? (
          <Button size="sm" asChild>
            <Link href="/sign-in">Sign In</Link>
          </Button>
        ) : variant === "sign-in" ? (
          <Button variant="outline" size="sm" className="gap-1.5" asChild>
            <Link href="/dcc-home">
              <Home className="w-4 h-4" />
              <span className="hidden sm:inline">Home</span>
            </Link>
          </Button>
        ) : null}
      </nav>
    </header>
  );
}
