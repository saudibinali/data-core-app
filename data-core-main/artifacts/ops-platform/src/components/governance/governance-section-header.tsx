/**
 * @file   components/governance/governance-section-header.tsx
 * @phase  P12-A - Governance Dashboard Shell & Navigation Foundations
 *
 * Consistent page header for all governance console sections.
 */

import { Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface GovernanceSectionHeaderProps {
  icon: React.ElementType;
  title: string;
  description: string;
}

export function GovernanceSectionHeader({
  icon: Icon,
  title,
  description,
}: GovernanceSectionHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Icon className="w-5 h-5 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        </div>
        <p className="text-muted-foreground text-sm max-w-2xl">{description}</p>
      </div>
      <Badge
        variant="outline"
        className="gap-1.5 text-xs border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-400 shrink-0"
      >
        <Eye className="w-3 h-3" />
        Read-Only
      </Badge>
    </div>
  );
}
