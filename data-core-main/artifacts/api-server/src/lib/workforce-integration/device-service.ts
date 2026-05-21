import { db } from "@workspace/db";
import { attendanceDevicesTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

export class DeviceService {
  async touchDevice(input: {
    workspaceId: number;
    integrationId: number | null;
    deviceUid: string;
    deviceType?: string;
    workLocationId?: number | null;
  }): Promise<number> {
    const [existing] = await db
      .select({ id: attendanceDevicesTable.id })
      .from(attendanceDevicesTable)
      .where(
        and(
          eq(attendanceDevicesTable.workspaceId, input.workspaceId),
          eq(attendanceDevicesTable.deviceUid, input.deviceUid),
        ),
      )
      .limit(1);

    const now = new Date();
    if (existing) {
      await db
        .update(attendanceDevicesTable)
        .set({
          lastSeenAt: now,
          integrationId: input.integrationId,
          deviceType: input.deviceType ?? undefined,
          workLocationId: input.workLocationId ?? undefined,
          status: "active",
        })
        .where(eq(attendanceDevicesTable.id, existing.id));
      return existing.id;
    }

    const [ins] = await db
      .insert(attendanceDevicesTable)
      .values({
        workspaceId: input.workspaceId,
        integrationId: input.integrationId,
        deviceUid: input.deviceUid,
        deviceType: input.deviceType ?? "terminal",
        workLocationId: input.workLocationId ?? null,
        status: "active",
        lastSeenAt: now,
      })
      .returning({ id: attendanceDevicesTable.id });
    return ins!.id;
  }

  async listDevices(workspaceId: number, integrationId?: number) {
    const conditions = [eq(attendanceDevicesTable.workspaceId, workspaceId)];
    if (integrationId != null) {
      return db
        .select()
        .from(attendanceDevicesTable)
        .where(
          and(
            eq(attendanceDevicesTable.workspaceId, workspaceId),
            eq(attendanceDevicesTable.integrationId, integrationId),
          ),
        );
    }
    return db.select().from(attendanceDevicesTable).where(and(...conditions));
  }
}

export const deviceService = new DeviceService();
