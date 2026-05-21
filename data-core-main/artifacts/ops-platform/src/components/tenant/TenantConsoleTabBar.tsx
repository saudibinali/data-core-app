/**
 * Tenant administration console tab bar - primary tabs + More dropdown.
 */

import {
  Activity,
  BarChart3,
  Briefcase,
  ChevronDown,
  ClipboardList,
  CreditCard,
  Heart,
  LayoutDashboard,
  Package,
  RefreshCw,
  Shield,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  CONSOLE_TAB_CONFIG,
  partitionVisibleConsoleTabs,
  isConsoleMoreTab,
  type ConsoleTab,
} from "@/lib/tenant-admin-console-config";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const TAB_ICON: Record<ConsoleTab, LucideIcon> = {
  overview: LayoutDashboard,
  lifecycle: Activity,
  subscription: CreditCard,
  subscription_entitlements: Shield,
  entitlements: Package,
  usage: BarChart3,
  renewal: RefreshCw,
  health: Heart,
  evaluation: ClipboardList,
  commercial: Briefcase,
};

export interface TenantConsoleTabBarProps {
  visibleTabs: ConsoleTab[];
  activeTab: ConsoleTab;
  onTabChange: (tab: ConsoleTab) => void;
}

function TabButton({
  tab,
  active,
  onSelect,
}: {
  tab: ConsoleTab;
  active: boolean;
  onSelect: (tab: ConsoleTab) => void;
}) {
  const cfg = CONSOLE_TAB_CONFIG[tab];
  const Icon = TAB_ICON[tab];

  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      id={`console-tab-${tab}`}
      aria-controls={`console-tabpanel-${tab}`}
      onClick={() => onSelect(tab)}
      data-testid={cfg.testId}
      className={cn(
        "flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium whitespace-nowrap border-b-2 transition-colors shrink-0",
        active
          ? "border-primary text-primary bg-background"
          : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/40",
      )}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden />
      {cfg.label}
      {!cfg.readOnly && (
        <span
          className="ml-0.5 w-1.5 h-1.5 rounded-full bg-primary/60 shrink-0"
          title="Editable section"
          aria-hidden
        />
      )}
    </button>
  );
}

export function TenantConsoleTabBar({
  visibleTabs,
  activeTab,
  onTabChange,
}: TenantConsoleTabBarProps) {
  const { primaryTabs, moreTabs } = partitionVisibleConsoleTabs(visibleTabs);
  const moreMenuActive = isConsoleMoreTab(activeTab) && moreTabs.includes(activeTab);

  return (
    <div
      className="flex items-stretch flex-wrap gap-0 border-b border-border bg-muted/30 overflow-hidden min-w-0"
      data-testid="console-tab-bar"
      role="tablist"
      aria-label="Tenant administration sections"
    >
      {primaryTabs.map((tab) => (
        <TabButton
          key={tab}
          tab={tab}
          active={activeTab === tab}
          onSelect={onTabChange}
        />
      ))}

      {moreTabs.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              role="tab"
              aria-selected={moreMenuActive}
              aria-haspopup="menu"
              aria-expanded={undefined}
              data-testid="console-tab-more-trigger"
              className={cn(
                "h-auto rounded-none px-4 py-2.5 text-xs font-medium border-b-2 gap-1 shrink-0",
                moreMenuActive
                  ? "border-primary text-primary bg-background"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/40",
              )}
            >
              More
              <ChevronDown className="w-3.5 h-3.5 opacity-70" aria-hidden />
              {moreMenuActive && (
                <span className="sr-only"> (current section)</span>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            side="bottom"
            collisionPadding={8}
            className="min-w-[14rem] max-h-[min(70vh,var(--radix-dropdown-menu-content-available-height))]"
            data-testid="console-tab-more-menu"
          >
            {moreTabs.map((tab) => {
              const cfg = CONSOLE_TAB_CONFIG[tab];
              const Icon = TAB_ICON[tab];
              const selected = activeTab === tab;
              return (
                <DropdownMenuItem
                  key={tab}
                  data-testid={`console-tab-more-item-${tab}`}
                  className={cn(
                    "text-xs cursor-pointer gap-2",
                    selected && "bg-accent text-accent-foreground font-medium",
                  )}
                  aria-selected={selected}
                  onSelect={() => onTabChange(tab)}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden />
                  <span className="flex-1">{cfg.label}</span>
                  {selected && (
                    <span className="text-[10px] text-muted-foreground" aria-hidden>
                      ●
                    </span>
                  )}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
