import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { MobileMenuButton } from "./mobile-menu-button";

interface HeaderProps {
  onMenuClick?: () => void;
}

export default function Header({ onMenuClick }: HeaderProps) {
  const { t } = useTranslation();
  const [location] = useLocation();

  let title = t("app_name");
  if (location.startsWith("/dashboard"))   title = t("dashboard");
  else if (location.startsWith("/tickets")) title = t("tickets");
  else if (location.startsWith("/departments")) title = t("departments");
  else if (location.startsWith("/users"))  title = t("users");
  else if (location.startsWith("/notifications")) title = t("notifications");
  else if (location.startsWith("/approvals"))     title = t("approvals");
  else if (location.startsWith("/settings"))      title = t("settings");
  else if (location.startsWith("/messages"))      title = t("mail");
  else if (location.startsWith("/calendar"))      title = t("calendar");
  else if (location.startsWith("/groups"))        title = t("groups");
  else if (location.startsWith("/governance/history")) title = "Historical Analytics";
  else if (location.startsWith("/governance"))    title = "Governance Console";

  return (
    <header className="h-14 border-b border-border bg-background flex items-center gap-3 px-4 sm:px-6 shrink-0 min-w-0">
      {onMenuClick ? <MobileMenuButton onClick={onMenuClick} /> : null}
      <h1 className="text-base sm:text-lg font-semibold truncate min-w-0 flex-1">{title}</h1>
    </header>
  );
}
