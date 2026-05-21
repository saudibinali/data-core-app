import { processIngestedEvent } from "../workforce-attendance/pipeline";
import type { RawEventDraft, ConnectorContext } from "./types";
import { employeeMapService } from "./employee-map-service";
import { deviceService } from "./device-service";
import { connectorRegistry } from "./connector-registry";
import { logger } from "../logger";

const VENDOR_SOURCE = "vendor";

export type IngestVendorDraftInput = {
  workspaceId: number;
  integrationId: number;
  connectorKey: string;
  ctx: ConnectorContext;
  draft: RawEventDraft;
  createdByUserId?: number;
};

export async function ingestVendorEventDraft(input: IngestVendorDraftInput) {
  const connector = connectorRegistry.resolve(input.connectorKey);

  let employeeId = await connector.resolveEmployee(input.ctx, input.draft.externalEmployeeId);
  if (employeeId == null) {
    const mapped = await employeeMapService.resolveEmployeeId(
      input.workspaceId,
      input.integrationId,
      input.draft.externalEmployeeId,
    );
    employeeId = mapped.employeeId;
    if (!employeeId) {
      await employeeMapService.upsertMapping({
        workspaceId: input.workspaceId,
        integrationId: input.integrationId,
        externalEmployeeId: input.draft.externalEmployeeId,
        employeeId: null,
        status: "unresolved",
        confidence: 0,
      });
      throw new Error(`Unresolved employee mapping: ${input.draft.externalEmployeeId}`);
    }
  }

  if (input.draft.externalDeviceId) {
    let deviceId = await connector.resolveDevice(input.ctx, input.draft.externalDeviceId);
    if (deviceId == null) {
      deviceId = await deviceService.touchDevice({
        workspaceId: input.workspaceId,
        integrationId: input.integrationId,
        deviceUid: input.draft.externalDeviceId,
        deviceType: "terminal",
      });
    }
    input.draft.payload = { ...input.draft.payload, deviceId };
  }

  const externalId = `int:${input.integrationId}:${input.draft.externalEventId}`;

  return processIngestedEvent(
    {
      workspaceId: input.workspaceId,
      sourceCode: VENDOR_SOURCE,
      employeeId,
      eventTypeHint: input.draft.eventTypeHint,
      occurredAt: input.draft.occurredAt,
      payload: {
        ...input.draft.payload,
        integrationId: input.integrationId,
        connectorKey: input.connectorKey,
      },
      externalId,
      createdByUserId: input.createdByUserId,
    },
    { createdByUserId: input.createdByUserId },
  );
}

export async function ingestVendorDrafts(
  workspaceId: number,
  integrationId: number,
  connectorKey: string,
  ctx: ConnectorContext,
  drafts: RawEventDraft[],
): Promise<{ ingested: number; duplicates: number; failed: number; errors: string[] }> {
  let ingested = 0;
  let duplicates = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const draft of drafts) {
    try {
      const result = await ingestVendorEventDraft({
        workspaceId,
        integrationId,
        connectorKey,
        ctx,
        draft,
      });
      if (result.duplicate) duplicates++;
      else ingested++;
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(msg);
      logger.warn({ integrationId, msg }, "[integration] draft ingest failed");
    }
  }

  return { ingested, duplicates, failed, errors };
}
