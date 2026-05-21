import { integrationService } from "./integration-service";
import { connectorRegistry } from "./connector-registry";
import { registerWorkforceConnectors } from "./register-connectors";
import { checkReplayToken, verifyWebhookSignature } from "./integration-security";
import { decryptCredentials } from "./integration-credential-vault";
import { ingestVendorDrafts } from "./integration-pipeline";
import { logger } from "../logger";

registerWorkforceConnectors();

export type WebhookIngestInput = {
  integrationId: number;
  rawBody: string;
  headers: Record<string, string | string[] | undefined>;
  parsedBody: unknown;
};

export async function handleAttendanceWebhook(input: WebhookIngestInput) {
  const integration = await integrationService.requireIntegrationById(input.integrationId);
  if (!integration.isEnabled) {
    throw new Error("Integration disabled");
  }

  if (input.rawBody.length > integration.maxPayloadBytes) {
    throw new Error("Payload too large");
  }

  const creds = decryptCredentials(integration.credentialEncrypted);
  const secret = creds.webhookSecret;
  if (secret) {
    const sig =
      (input.headers["x-signature"] as string) ??
      (input.headers["x-hub-signature-256"] as string);
    if (!verifyWebhookSignature(secret, input.rawBody, sig)) {
      throw new Error("Invalid webhook signature");
    }
  }

  const connector = connectorRegistry.resolve(integration.connectorKey);
  const ctx = integrationService.buildContext(integration);
  const parsed = await connector.parseWebhook(ctx, input.headers, input.parsedBody);

  if (!checkReplayToken(integration.id, parsed.replayToken)) {
    return { accepted: false, reason: "replay_detected", ingested: 0, duplicates: 0, failed: 0 };
  }

  const result = await ingestVendorDrafts(
    integration.workspaceId,
    integration.id,
    integration.connectorKey,
    ctx,
    parsed.events,
  );

  await integrationService.recordSyncResult(integration.id, "completed", result);

  logger.info(
    { integrationId: integration.id, ...result },
    "[integration] webhook processed",
  );

  return { accepted: true, ...result };
}
