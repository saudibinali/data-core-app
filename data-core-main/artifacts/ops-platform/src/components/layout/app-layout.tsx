import React from "react";
import Sidebar from "./sidebar";
import Header from "./header";
import { useMobileNav } from "@/hooks/use-mobile-nav";
import { Sheet, SheetContent } from "@/components/ui/sheet";

interface AppLayoutProps {
  children: React.ReactNode;
  banner?: React.ReactNode;
  fullWidth?: boolean;
}

export default function AppLayout({ children, banner, fullWidth }: AppLayoutProps) {
  const { open, setOpen, openNav, closeNav } = useMobileNav();

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-background">
      <div className="hidden lg:flex w-64 shrink-0 h-full">
        <Sidebar />
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="left"
          className="w-[min(100vw,16rem)] max-w-[16rem] p-0 gap-0 border-r border-border [&>button]:top-3 [&>button]:end-3"
          aria-describedby={undefined}
        >
          <Sidebar onNavigate={closeNav} />
        </SheetContent>
      </Sheet>

      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <Header onMenuClick={openNav} />
        {banner}
        {fullWidth ? (
          <main className="flex-1 min-w-0 overflow-hidden">
            {children}
          </main>
        ) : (
          <main className="app-shell-main">
            <div className="app-shell-container">{children}</div>
          </main>
        )}
      </div>
    </div>
  );
}
