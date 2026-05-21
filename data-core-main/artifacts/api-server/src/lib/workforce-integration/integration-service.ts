import { db } from "@workspace/db";
import {
  attendanceIntegrationsTable,
  attendanceSyncJobsTable,
} from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { connectorRegistry } from "./connector-registry";
import { registerWorkforceConnectors } from "./register-connectors";
import {
  decryptCredentials,
  encryptCredentials,
  redactIntegrationForApi,
  type CredentialBundle,
} from "./integration-credential-vault";
import {
  generateWebhookSecret,
  hashWebhookSecret,
  parseConfigJson,
} from "./integration-security";
import type { ConnectorContext } from "./types";
import { appEventBus } from "../events/app-bus";
import { EVENT_TYPES } from "@workspace/core-events";
import { logAttendanceAccess } from "../workforce-attendance/access-log";

registerWorkforceConnectors();

export type CreateIntegrationInput = {
  workspaceId: number;
  name: string;
  connectorKey: string;
  config?: Record<string, unknown>;
  credentials?: CredentialBundle;
  pollIntervalMinutes?: number;
  createdByUserId?: number;
};

export class IntegrationService {
  buildContext(integration: typeof attendanceIntegrationsTable.$inferSelect): ConnectorContext {
    return {
      workspaceId: integration.workspaceId,
      integrationId: integration.id,
      connectorKey: integration.connectorKey,
      config: parseConfigJson(integration.configJson),
      credentials: decryptCredentials(integration.credentialEncrypted),
    };
  }

  async list(workspaceId: number) {
    const rows = await db
      .select()
      .from(attendanceIntegrationsTable)
      .where(eq(attendanceIntegrationsTable.workspaceId, workspaceId))
      .orderBy(desc(attendanceIntegrationsTable.id));
    return rows.map((r) => redactIntegrationForApi(r));
  }

  async get(workspaceId: number, integrationId: number) {
    const [row] = await db
      .select()
      .from(attendanceIntegrationsTable)
      .where(
        and(
          eq(attendanceIntegrationsTable.id, integrationId),
          eq(attendanceIntegrationsTable.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (!row) throw new Error("Integration not found");
    return redactIntegrationForApi(row);
  }

  async create(input: CreateIntegrationInput) {
    connectorRegistry.validateConnectorKey(input.connectorKey);
    const connector = connectorRegistry.resolve(input.connectorKey);
    const config = input.config ?? {};
    connector.validateConfig(config);

    const creds = input.credentials ?? {};
    let webhookSecretHash: string | null = null;
    if (
      input.connectorKey === "generic_webhook" ||
      input.connectorKey === "direct_api"
    ) {
      if (!creds.webhookSecret) creds.webhookSecret = generateWebhookSecret();
      webhookSecretHash = hashWebhookSecret(creds.webhookSecret);
    }

    const [row] = await db
      .insert(attendanceIntegrationsTable)
      .values({
        workspaceId: input.workspaceId,
        name: input.name,
        connectorKey: input.connectorKey,
        configJson: JSON.stringify(config),
        credentialEncrypted:
          Object.keys(creds).length > 0 ? encryptCredentials(creds) : null,
        webhookSecretHash,
        pollIntervalMinutes: input.pollIntervalMinutes ?? 15,
        createdByUserId: input.createdByUserId ?? null,
      })
      .returning();

    logAttendanceAccess({
      workspaceId: input.workspaceId,
      userId: input.createdByUserId,
      action: "integration_create",
      resourceType: "attendance_integration",
      resourceId: row!.id,
    });

    const apiRow = redactIntegrationForApi(row!);
    const webhookSecretOnce =
      creds.webhookSecret &&
      (input.connectorKey === "generic_webhook" || input.connectorKey === "direct_api")
        ? creds.webhookSecret
        : undefined;
    return { ...apiRow, webhookSecretOnce };
  }

  async update(
    workspaceId: number,
    integrationId: number,
    patch: {
      name?: string;
      config?: Record<string, unknown>;
      credentials?: CredentialBundle;
      rotateWebhookSecret?: boolean;
      pollIntervalMinutes?: number;
      isEnabled?: boolean;
    },
    userId?: number,
  ) {
    const [existing] = await db
      .select()
      .from(attendanceIntegrationsTable)
      .where(
        and(
          eq(attendanceIntegrationsTable.id, integrationId),
          eq(attendanceIntegrationsTable.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (!existing) throw new Error("Integration not found");

    const updates: Partial<typeof attendanceIntegrationsTable.$inferInsert> = {};
    if (patch.name) updates.name = patch.name;
    if (patch.config) {
      const connector = connectorRegistry.resolve(existing.connectorKey);
      connector.validateConfig(patch.config);
      updates.configJson = JSON.stringify(patch.config);
    }
    if (patch.pollIntervalMinutes != null) {
      updates.pollIntervalMinutes = patch.pollIntervalMinutes;
    }
    if (patch.isEnabled != null) {
      updates.isEnabled = patch.isEnabled;
      if (!patch.isEnabled) {
        void appEventBus.emit({
          type: EVENT_TYPES.ATTENDANCE_INTEGRATION_DISABLED,
          module: "hr",
          workspace: { workspaceId },
          actor: { userId, role: undefined },
          metadata: { idempotencyKey: `att-int-disabled-${integrationId}-${Date.now()}` },
          data: { integrationId, name: existing.name, connectorKey: existing.connectorKey },
        });
      }
    }

    if (patch.credentials || patch.rotateWebhookSecret) {
      const creds = decryptCredentials(existing.credentialEncrypted);
      if (patch.credentials) Object.assign(creds, patch.credentials);
      if (patch.rotateWebhookSecret) {
        creds.webhookSecret = generateWebhookSecret();
        updates.webhookSecretHash = hashWebhookSecret(creds.webhookSecret);
        updates.credentialVersion = (existing.credentialVersion ?? 1) + 1;
      }
      updates.credentialEncrypted = encryptCredentials(creds);
    }

    const [row] = await db
      .update(attendanceIntegrationsTable)
      .set(updates)
      .where(eq(attendanceIntegrationsTable.id, integrationId))
      .returning();

    const apiRow = redactIntegrationForApi(row!);
    const webhookSecretOnce = patch.rotateWebhookSecret
      ? decryptCredentials(row!.credentialEncrypted).webhookSecret
      : undefined;
    return { ...apiRow, webhookSecretOnce };
  }

  async testConnection(workspaceId: number, integrationId: number) {
    const integration = await this.requireIntegration(workspaceId, integrationId);
    if (!integration.isEnabled) {
      return { ok: false, message: "Integration is disabled" };
    }
    const connector = connectorRegistry.resolve(integration.connectorKey);
    const ctx = this.buildContext(integration);
    return connector.testConnection(ctx);
  }

  async syncNow(workspaceId: number, integrationId: number, userId?: number) {
    const integration = await this.requireIntegration(workspaceId, integrationId);
    const [job] = await db
      .insert(attendanceSyncJobsTable)
      .values({
        workspaceId,
        integrationId,
        jobType: "poll",
        status: "pending",
        nextRunAt: new Date(),
      })
      .returning();

    logAttendanceAccess({
      workspaceId,
      userId,
      action: "integration_sync_now",
      resourceType: "attendance_sync_job",
      resourceId: job!.id,
    });

    return { jobId: job!.id, integrationId: integration.id };
  }

  async status(workspaceId: number, integrationId: number) {
    const integration = await this.requireIntegration(workspaceId, integrationId);
    const jobs = await db
      .select()
      .from(attendanceSyncJobsTable)
      .where(
        and(
          eq(attendanceSyncJobsTable.workspaceId, workspaceId),
          eq(attendanceSyncJobsTable.integrationId, integrationId),
        ),
      )
      .orderBy(desc(attendanceSyncJobsTable.id))
      .limit(5);

    return {
      integration: redactIntegrationForApi(integration),
      recentJobs: jobs,
    };
  }

  async requireIntegration(workspaceId: number, integrationId: number) {
    const [row] = await db
      .select()
      .from(attendanceIntegrationsTable)
      .where(
        and(
          eq(attendanceIntegrationsTable.id, integrationId),
          eq(attendanceIntegrationsTable.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (!row) throw new Error("Integration not found");
    return row;
  }

  async requireIntegrationById(integrationId: number) {
    const [row] = await db
      .select()
      .from(attendanceIntegrationsTable)
      .where(eq(attendanceIntegrationsTable.id, integrationId))
      .limit(1);
    if (!row) throw new Error("Integration not found");
    return row;
  }

  async recordSyncResult(
    integrationId: number,
    status: "completed" | "failed",
    metrics?: { ingested?: number; failed?: number; errors?: string[] },
  ) {
    const failures = status === "failed" ? 1 : 0;
    const [row] = await db
      .select({ consecutiveFailures: attendanceIntegrationsTable.consecutiveFailures })
      .from(attendanceIntegrationsTable)
      .where(eq(attendanceIntegrationsTable.id, integrationId))
      .limit(1);
    const consecutive =
      status === "failed" ? (row?.consecutiveFailures ?? 0) + 1 : 0;

    await db
      .update(attendanceIntegrationsTable)
      .set({
        lastSyncAt: new Date(),
        lastSyncStatus: status,
        consecutiveFailures: consecutive,
      })
      .where(eq(attendanceIntegrationsTable.id, integrationId));

    if (status === "failed" && metrics) {
      const integration = await this.requireIntegrationById(integrationId);
      void appEventBus.emit({
        type: EVENT_TYPES.ATTENDANCE_SYNC_FAILED,
        module: "hr",
        workspace: { workspaceId: integration.workspaceId },
        actor: { userId: undefined, role: undefined },
        metadata: { idempotencyKey: `att-sync-fail-${integrationId}-${Date.now()}` },
        data: {
          integrationId,
          name: integration.name,
          connectorKey: integration.connectorKey,
          error: metrics.errors?.[0] ?? "sync failed",
        },
      });
    } else if (status === "completed") {
      const integration = await this.requireIntegrationById(integrationId);
      void appEventBus.emit({
        type: EVENT_TYPES.ATTENDANCE_SYNC_COMPLETED,
        module: "hr",
        workspace: { workspaceId: integration.workspaceId },
        actor: { userId: undefined, role: undefined },
        metadata: { idempotencyKey: `att-sync-ok-${integrationId}-${Date.now()}` },
        data: {
          integrationId,
          name: integration.name,
          ingested: metrics?.ingested ?? 0,
          failed: metrics?.failed ?? 0,
        },
      });
    }
  }
}

export const integrationService = new IntegrationService();
