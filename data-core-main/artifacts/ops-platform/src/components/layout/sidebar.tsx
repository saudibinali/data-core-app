import { useState, useMemo } from "react";
import { Link, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { useAppAuth } from "@/lib/auth";
import { useTheme } from "@/components/theme-provider";
import {
  Home, LayoutDashboard, Ticket, Building2, Users, UsersRound, Bell,
  CheckSquare, Settings, LogOut, Moon, Sun, Globe, Mail, CalendarDays,
  GripVertical, Pin, PinOff, ShieldCheck, Box, GitFork, ClipboardList,
  BriefcaseBusiness, ConciergeBell, FileText, CreditCard, Warehouse, Package,
  ArrowLeftRight, ClipboardCheck, Scale, type LucideIcon,
} from "lucide-react";
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor,
  useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, verticalListSortingStrategy, useSortable,
  arrayMove, sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import {
  useGetUnreadNotificationCount,
  useGetUnreadMessageCount,
  useListModules,
} from "@workspace/api-client-react";
import { useSidebarPrefs } from "@/hooks/use-sidebar-prefs";
import { usePermissions } from "@/hooks/use-permissions";

const ICON_MAP: Record<string, LucideIcon> = {
  Home,
  LayoutDashboard,
  Ticket,
  Building2,
  Users,
  UsersRound,
  Bell,
  CheckSquare,
  ShieldCheck,
  Mail,
  CalendarDays,
  GitFork,
  ClipboardList,
  BriefcaseBusiness,
  ConciergeBell,
  FileText,
  CreditCard,
  Box,
  Warehouse,
  Package,
  ArrowLeftRight,
  ClipboardCheck,
  Scale,
};

function resolveIcon(name: string): LucideIcon {
  return ICON_MAP[name] ?? Box;
}

interface NavItemProps {
  id: string;
  icon: React.ElementType;
  label: string;
  isActive: boolean;
  badge?: number;
  isPinned: boolean;
  onPin: () => void;
  onUnpin: () => void;
  onNavigate?: () => void;
  dragHandleProps?: React.HTMLAttributes<HTMLButtonElement>;
  isDragging?: boolean;
  style?: React.CSSProperties;
}

function NavItem({
  id, icon: Icon, label, isActive, badge, isPinned, onPin, onUnpin, onNavigate,
  dragHandleProps, isDragging, style,
}: NavItemProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      style={style}
      className={cn(
        "group relative flex items-center gap-1 rounded-md transition-all",
        isDragging && "opacity-50 z-50",
      )}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        {...dragHandleProps}
        className={cn(
          "p-1 rounded text-muted-foreground/40 hover:text-muted-foreground transition-all cursor-grab active:cursor-grabbing shrink-0",
          hovered ? "opacity-100" : "opacity-0",
        )}
        title="Drag to reorder"
        tabIndex={-1}
      >
        <GripVertical className="w-3.5 h-3.5" />
      </button>

      <Link
        href={id}
        onClick={() => onNavigate?.()}
        className={cn(
          "flex flex-1 items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
          isActive
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground",
        )}
      >
        <Icon className="w-4 h-4 shrink-0" />
        <span className="flex-1 truncate">{label}</span>

        {isPinned && !hovered && (
          <Pin className="w-3 h-3 text-primary/40 shrink-0" />
        )}

        {badge ? (
          <span className="bg-primary text-primary-foreground text-xs font-bold px-2 py-0.5 rounded-full shrink-0">
            {badge}
          </span>
        ) : null}
      </Link>

      <button
        onClick={isPinned ? onUnpin : onPin}
        className={cn(
          "p-1 rounded transition-all shrink-0",
          isPinned
            ? "text-primary opacity-100 hover:text-muted-foreground"
            : "text-muted-foreground/40 hover:text-primary",
          !isPinned && !hovered && "opacity-0 pointer-events-none",
        )}
        title={isPinned ? "Unpin" : "Pin to top"}
      >
        {isPinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}

function SortableNavItem(props: Omit<NavItemProps, "dragHandleProps" | "isDragging" | "style">) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.id,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef}>
      <NavItem
        {...props}
        dragHandleProps={{ ...attributes, ...listeners } as React.HTMLAttributes<HTMLButtonElement>}
        isDragging={isDragging}
        style={style}
      />
    </div>
  );
}

export default function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const [location] = useLocation();
  const { t, i18n } = useTranslation();
  const { signOut, user: authUser } = useAppAuth();

  const { theme, setTheme } = useTheme();

  const { hasPermission, isLoading: permissionsLoading } = usePermissions();

  const { data: unreadCountData } = useGetUnreadNotificationCount({
    query: { queryKey: ["/api/notifications/unread-count"], refetchInterval: 12_000 },
  });
  const { data: unreadMsgData } = useGetUnreadMessageCount({
    query: { queryKey: ["/api/messages/unread-count"], refetchInterval: 12_000 },
  });
  const unreadCount = unreadCountData?.count ?? 0;
  const unreadMsgCount = unreadMsgData?.count ?? 0;

  const badges: Record<string, number> = {
    "/messages":      unreadMsgCount,
    "/notifications": unreadCount,
  };

  // Load enabled modules from API
  const { data: modulesData, isLoading: modulesLoading } = useListModules();

  const enabledModules = useMemo(
    () =>
      (modulesData ?? [])
        .filter((m) => m.enabled && m.navigationPath)
        .sort((a, b) => a.displayOrder - b.displayOrder),
    [modulesData]
  );

  // Dynamic default order derived from enabled modules
  const navPaths = useMemo(
    () => enabledModules.map((m) => m.navigationPath!),
    [enabledModules]
  );

  // Map from path → { icon, label, permissionKey }
  const navMap = useMemo(
    () =>
      Object.fromEntries(
        enabledModules.map((m) => [
          m.navigationPath!,
          {
            icon: resolveIcon(m.icon),
            label: i18n.language.startsWith("ar") ? m.nameAr : m.name,
            permissionKey: m.permissionKey ?? null,
          },
        ])
      ),
    [enabledModules, i18n.language]
  );

  const { pinnedIds, mainOrder, reorderMain, reorderPinned, pin, unpin } =
    useSidebarPrefs(navPaths);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEndPinned(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = pinnedIds.indexOf(String(active.id));
    const newIndex = pinnedIds.indexOf(String(over.id));
    if (oldIndex !== -1 && newIndex !== -1) {
      reorderPinned(arrayMove(pinnedIds, oldIndex, newIndex));
    }
  }

  function handleDragEndMain(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = mainOrder.indexOf(String(active.id));
    const newIndex = mainOrder.indexOf(String(over.id));
    if (oldIndex !== -1 && newIndex !== -1) {
      reorderMain(arrayMove(mainOrder, oldIndex, newIndex));
    }
  }

  // Filter paths by permission (show all while loading to avoid flash)
  const visiblePaths = useMemo(() => {
    if (permissionsLoading || modulesLoading) {
      return new Set(navPaths);
    }
    return new Set(
      enabledModules
        .filter((m) => !m.permissionKey || hasPermission(m.permissionKey))
        .map((m) => m.navigationPath!)
    );
  }, [enabledModules, navPaths, hasPermission, permissionsLoading, modulesLoading]);

  const toggleLanguage = () => i18n.changeLanguage(i18n.language === "en" ? "ar" : "en");
  const toggleTheme    = () => setTheme(theme === "dark" ? "light" : "dark");

  return (
    <div className="w-full h-full border-r border-border bg-sidebar flex flex-col">
      {/* Logo */}
      <div className="h-14 flex items-center px-4 border-b border-border shrink-0">
        <Link
          href="/home"
          onClick={() => onNavigate?.()}
          className="flex items-center gap-2 font-bold text-lg text-sidebar-primary"
        >
          <img
            src={`${import.meta.env.BASE_URL.replace(/\/$/, "")}/logo.png`}
            alt="Logo"
            className="w-8 h-8 rounded"
          />
          <span>{t("app_name")}</span>
        </Link>
      </div>

      {/* Nav */}
      <div className="flex-1 overflow-y-auto py-3 px-2 flex flex-col gap-0.5">

        {/* Pinned section */}
        {pinnedIds.filter((id) => visiblePaths.has(id)).length > 0 && (
          <>
            <p className="px-3 pt-1 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 select-none">
              {t("pinned")}
            </p>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEndPinned}>
              <SortableContext items={pinnedIds.filter((id) => visiblePaths.has(id))} strategy={verticalListSortingStrategy}>
                {pinnedIds.filter((id) => visiblePaths.has(id)).map((id) => {
                  const item = navMap[id];
                  if (!item) return null;
                  return (
                    <SortableNavItem
                      key={id}
                      id={id}
                      icon={item.icon}
                      label={item.label}
                      isActive={location.startsWith(id)}
                      badge={badges[id]}
                      isPinned
                      onPin={() => pin(id)}
                      onUnpin={() => unpin(id)}
                      onNavigate={onNavigate}
                    />
                  );
                })}
              </SortableContext>
            </DndContext>

            <div className="my-2 border-t border-border/50" />
          </>
        )}

        {/* Main section label */}
        {mainOrder.filter((id) => visiblePaths.has(id)).length > 0 &&
          pinnedIds.filter((id) => visiblePaths.has(id)).length > 0 && (
          <p className="px-3 pt-0.5 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 select-none">
            {t("navigation")}
          </p>
        )}

        {/* Loading skeleton */}
        {modulesLoading && (
          <div className="space-y-1 px-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-9 rounded-md bg-sidebar-accent/30 animate-pulse" />
            ))}
          </div>
        )}

        {/* Main nav items */}
        {!modulesLoading && (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEndMain}>
            <SortableContext items={mainOrder.filter((id) => visiblePaths.has(id))} strategy={verticalListSortingStrategy}>
              {mainOrder.filter((id) => visiblePaths.has(id)).map((id) => {
                const item = navMap[id];
                if (!item) return null;
                return (
                  <SortableNavItem
                    key={id}
                    id={id}
                    icon={item.icon}
                    label={item.label}
                    isActive={location.startsWith(id)}
                    badge={badges[id]}
                    isPinned={false}
                    onPin={() => pin(id)}
                    onUnpin={() => unpin(id)}
                    onNavigate={onNavigate}
                  />
                );
              })}
            </SortableContext>
          </DndContext>
        )}
      </div>

      {/* Footer */}
      <div className="mt-auto border-t border-border p-4 flex flex-col gap-2 shrink-0">
        <Link
          href="/settings"
          onClick={() => onNavigate?.()}
          className={cn(
            "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
            location.startsWith("/settings")
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground",
          )}
        >
          <Settings className="w-4 h-4" />
          <span>{t("settings")}</span>
        </Link>

        <div className="flex items-center justify-between px-3 py-2 mt-1">
          <button
            onClick={toggleTheme}
            className="p-1 rounded hover:bg-sidebar-accent text-sidebar-foreground transition-colors"
            title={theme === "dark" ? t("theme_light") : t("theme_dark")}
          >
            {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          <button
            onClick={toggleLanguage}
            className="p-1 rounded hover:bg-sidebar-accent text-sidebar-foreground transition-colors flex items-center gap-1"
            title={i18n.language === "ar" ? t("lang_en") : t("lang_ar")}
          >
            <Globe className="w-4 h-4" />
            <span className="text-xs uppercase">{i18n.language}</span>
          </button>
        </div>

        <div className="flex items-center gap-3 px-2 py-2 rounded-md border border-border bg-background">
          <img
            src={authUser?.avatarUrl || `https://api.dicebear.com/7.x/initials/svg?seed=${authUser?.fullName ?? "User"}`}
            alt={authUser?.fullName ?? "User"}
            className="w-8 h-8 rounded-full shrink-0"
          />
          <div className="flex-1 overflow-hidden">
            <p className="text-sm font-medium truncate">{authUser?.fullName ?? "User"}</p>
            <p className="text-xs text-muted-foreground truncate">
              {authUser?.email ?? ""}
            </p>
          </div>
          <button
            onClick={() => signOut()}
            className="p-1.5 text-muted-foreground hover:text-foreground rounded-md hover:bg-accent transition-colors shrink-0"
            title={t("sign_out")}
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
