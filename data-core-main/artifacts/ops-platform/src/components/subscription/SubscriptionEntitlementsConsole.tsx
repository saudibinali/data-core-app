/**
 * @phase P16-A..E / P16-F - Legacy wrapper; unified console is SubscriptionConsole.
 */

import {
  SubscriptionConsole,
  type SubscriptionConsoleProps,
} from "@/components/subscription/SubscriptionConsole";

export type SubscriptionEntitlementsConsoleProps = Omit<
  SubscriptionConsoleProps,
  "legacyConsoleTestId" | "registrySubscriptionSlot"
>;

export function SubscriptionEntitlementsConsole(props: SubscriptionEntitlementsConsoleProps) {
  return (
    <SubscriptionConsole
      {...props}
      legacyConsoleTestId="subscription-entitlements-console"
    />
  );
}
