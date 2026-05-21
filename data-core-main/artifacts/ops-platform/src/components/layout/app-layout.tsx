import React from "react";
import Sidebar from "./sidebar";
import Header from "./header";

interface AppLayoutProps {
  children: React.ReactNode;
  banner?: React.ReactNode;
  fullWidth?: boolean;
}

export default function AppLayout({ children, banner, fullWidth }: AppLayoutProps) {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <div className="flex flex-col flex-1 overflow-hidden">
        <Header />
        {banner}
        {fullWidth ? (
          <main className="flex-1 overflow-hidden">
            {children}
          </main>
        ) : (
          <main className="flex-1 overflow-y-auto p-6">
            <div className="mx-auto max-w-6xl">
              {children}
            </div>
          </main>
        )}
      </div>
    </div>
  );
}
