import { db } from "@workspace/db";
import { workspaceSubscriptionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { RawSubscriptionRow } from "./tenant-registry";
import {
  snapshotToRawSubscriptionRow,
  workspaceSubscriptionToSnapshot,
} from "./canonical-subscription-registry";

export async function loadCanonicalSubscriptionRawRow(
  workspaceId: number,
  now: Date,
): Promise<{ raw: RawSubscriptionRow | null; subscriptionId: string | null; planCode: string | null }> {
  const [sub] = await db
    .select()
    .from(workspaceSubscriptionsTable)
    .where(eq(workspaceSubscriptionsTable.workspaceId, workspaceId))
    .limit(1);

  if (!sub) {
    return { raw: null, subscriptionId: null, planCode: null };
  }

  const snap = workspaceSubscriptionToSnapshot(sub, now);
  return {
    raw: snapshotToRawSubscriptionRow(snap) as RawSubscriptionRow,
    subscriptionId: String(sub.id),
    planCode: snap.planCode,
  };
}
