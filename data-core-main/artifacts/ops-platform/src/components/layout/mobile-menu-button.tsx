import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface MobileMenuButtonProps {
  onClick: () => void;
  className?: string;
  label?: string;
}

export function MobileMenuButton({
  onClick,
  className,
  label = "Open menu",
}: MobileMenuButtonProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn("lg:hidden shrink-0", className)}
      onClick={onClick}
      aria-label={label}
      data-testid="mobile-menu-button"
    >
      <Menu className="h-5 w-5" />
    </Button>
  );
}
