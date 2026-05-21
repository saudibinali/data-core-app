import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { activityLogsTable, usersTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { ListActivityQueryParams } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

router.get("/activity", requireAuth, async (req, res): Promise<void> => {
  const params = ListActivityQueryParams.safeParse(req.query);
  const filters = params.success ? params.data : { limit: undefined, ticketId: undefined };
  const limit = filters.limit ?? 50;

  let query = db
    .select({
      id: activityLogsTable.id,
      ticketId: activityLogsTable.ticketId,
      userId: activityLogsTable.userId,
      userName: usersTable.fullName,
      action: activityLogsTable.action,
      metadata: activityLogsTable.metadata,
      createdAt: activityLogsTable.createdAt,
    })
    .from(activityLogsTable)
    .leftJoin(usersTable, eq(activityLogsTable.userId, usersTable.id))
    .$dynamic();

  if (filters.ticketId) {
    query = query.where(eq(activityLogsTable.ticketId, filters.ticketId));
  }

  const logs = await query.orderBy(desc(activityLogsTable.createdAt)).limit(limit);
  res.json(logs);
});

export default router;
