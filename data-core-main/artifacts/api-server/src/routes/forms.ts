import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  formDefinitionsTable,
  formFieldsTable,
  formSubmissionsTable,
  formSubmissionFilesTable,
  usersTable,
  workspacesTable,
  workflowExecutionsTable,
  workflowTasksTable,
} from "@workspace/db";
import {
  eq, and, desc, count, sql, asc, inArray,
} from "drizzle-orm";
import {
  type AuthRequest,
  requireAuth,
  requireWorkspaceAdmin,
} from "../middlewares/requireAuth";
import { appEventBus } from "../lib/events/app-bus";
import { EVENT_TYPES } from "@workspace/core-events";
import { sendSubmissionConfirmation } from "../lib/email.js";

const router: IRouter = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseId(val: unknown): number | null {
  const n = parseInt(String(val), 10);
  return isNaN(n) ? null : n;
}

function formatFieldValue(val: unknown): string {
  if (val === null || val === undefined || val === "") return "";
  if (Array.isArray(val)) return val.join(", ");
  if (typeof val === "object") {
    const obj = val as Record<string, unknown>;
    return obj["name"] ? String(obj["name"]) : JSON.stringify(val);
  }
  return String(val);
}

// ── GET /self-service/forms ───────────────────────────────────────────────────

router.get("/self-service/forms", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

  const fieldCounts = db
    .select({ formId: formFieldsTable.formId, fieldCnt: count().as("field_cnt") })
    .from(formFieldsTable)
    .groupBy(formFieldsTable.formId)
    .as("field_counts");

  const rows = await db
    .select({
      id:               formDefinitionsTable.id,
      workspaceId:      formDefinitionsTable.workspaceId,
      name:             formDefinitionsTable.name,
      nameAr:           formDefinitionsTable.nameAr,
      description:      formDefinitionsTable.description,
      descriptionAr:    formDefinitionsTable.descriptionAr,
      module:           formDefinitionsTable.module,
      category:         formDefinitionsTable.category,
      status:           formDefinitionsTable.status,
      workflowEvent:    formDefinitionsTable.workflowEvent,
      showInSelfService: formDefinitionsTable.showInSelfService,
      permissions:      formDefinitionsTable.permissions,
      settings:         formDefinitionsTable.settings,
      createdByUserId:  formDefinitionsTable.createdByUserId,
      submissionCount:  sql<number>`0`,
      fieldCount:       sql<number>`coalesce(${fieldCounts.fieldCnt}, 0)`,
      createdAt:        formDefinitionsTable.createdAt,
      updatedAt:        formDefinitionsTable.updatedAt,
    })
    .from(formDefinitionsTable)
    .leftJoin(fieldCounts, eq(formDefinitionsTable.id, fieldCounts.formId))
    .where(and(
      eq(formDefinitionsTable.workspaceId, req.workspaceId),
      eq(formDefinitionsTable.status, "active"),
      eq(formDefinitionsTable.showInSelfService, true),
    ))
    .orderBy(asc(formDefinitionsTable.module), asc(formDefinitionsTable.name));

  // Filter by visibleTo - same logic as /self-service/services
  const userRole = req.userRole ?? "member";
  const filtered = rows.filter((form) => {
    const perms = form.permissions as Record<string, unknown> | null;
    const visibleTo = (perms?.visibleTo as string | undefined) ?? "all";
    if (visibleTo === "all")           return true;
    if (visibleTo === "member")        return true;
    if (visibleTo === "manager_above") return ["manager", "admin", "super_admin"].includes(userRole);
    if (visibleTo === "admin_only")    return ["admin", "super_admin"].includes(userRole);
    return true;
  });

  res.json(filtered);
});

// ── GET /forms ────────────────────────────────────────────────────────────────

router.get("/forms", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

  const { module, category, status } = req.query as Record<string, string | undefined>;

  const conditions = [eq(formDefinitionsTable.workspaceId, req.workspaceId)];
  if (module)   conditions.push(eq(formDefinitionsTable.module,   module));
  if (category) conditions.push(eq(formDefinitionsTable.category, category));
  if (status)   conditions.push(eq(formDefinitionsTable.status,   status));

  const submissionCounts = db
    .select({
      formId: formSubmissionsTable.formId,
      subCnt: count().as("sub_cnt"),
    })
    .from(formSubmissionsTable)
    .groupBy(formSubmissionsTable.formId)
    .as("sub_counts");

  const fieldCounts = db
    .select({
      formId: formFieldsTable.formId,
      fieldCnt: count().as("field_cnt"),
    })
    .from(formFieldsTable)
    .groupBy(formFieldsTable.formId)
    .as("field_counts");

  const rows = await db
    .select({
      id:               formDefinitionsTable.id,
      workspaceId:      formDefinitionsTable.workspaceId,
      name:             formDefinitionsTable.name,
      nameAr:           formDefinitionsTable.nameAr,
      description:      formDefinitionsTable.description,
      descriptionAr:    formDefinitionsTable.descriptionAr,
      module:           formDefinitionsTable.module,
      category:         formDefinitionsTable.category,
      status:           formDefinitionsTable.status,
      workflowEvent:    formDefinitionsTable.workflowEvent,
      showInSelfService: formDefinitionsTable.showInSelfService,
      permissions:      formDefinitionsTable.permissions,
      settings:         formDefinitionsTable.settings,
      createdByUserId:  formDefinitionsTable.createdByUserId,
      submissionCount:  sql<number>`coalesce(${submissionCounts.subCnt}, 0)`,
      fieldCount:       sql<number>`coalesce(${fieldCounts.fieldCnt}, 0)`,
      createdAt:        formDefinitionsTable.createdAt,
      updatedAt:        formDefinitionsTable.updatedAt,
    })
    .from(formDefinitionsTable)
    .leftJoin(submissionCounts, eq(formDefinitionsTable.id, submissionCounts.formId))
    .leftJoin(fieldCounts, eq(formDefinitionsTable.id, fieldCounts.formId))
    .where(and(...conditions))
    .orderBy(asc(formDefinitionsTable.module), asc(formDefinitionsTable.name));

  res.json(rows);
});

// ── POST /forms ───────────────────────────────────────────────────────────────

router.post("/forms", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId || !req.userId) { res.status(403).json({ error: "No workspace" }); return; }

  const { name, nameAr, description, descriptionAr, module: mod, category, status, workflowEvent, showInSelfService, permissions, settings } = req.body as Record<string, unknown>;

  if (!name || !mod) { res.status(400).json({ error: "name and module are required" }); return; }

  const [form] = await db
    .insert(formDefinitionsTable)
    .values({
      workspaceId:      req.workspaceId,
      name:             String(name),
      nameAr:           nameAr ? String(nameAr) : null,
      description:      description ? String(description) : null,
      descriptionAr:    descriptionAr ? String(descriptionAr) : null,
      module:           String(mod),
      category:         category ? String(category) : null,
      status:           status ? String(status) : "active",
      workflowEvent:    workflowEvent ? String(workflowEvent) : null,
      showInSelfService: showInSelfService === true,
      permissions:      permissions ?? null,
      settings:         settings ?? null,
      createdByUserId:  req.userId,
    })
    .returning();

  res.status(201).json({ ...form, submissionCount: 0, fieldCount: 0 });
});

// ── GET /forms/:id ────────────────────────────────────────────────────────────

router.get("/forms/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

  const id = parseId(req.params["id"]);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }

  const [form] = await db
    .select()
    .from(formDefinitionsTable)
    .where(and(eq(formDefinitionsTable.id, id), eq(formDefinitionsTable.workspaceId, req.workspaceId)));

  if (!form) { res.status(404).json({ error: "Form not found" }); return; }

  // Only active forms visible to regular users; drafts only to admins
  if (form.status === "draft" && req.userRole !== "admin" && req.userRole !== "super_admin") {
    res.status(404).json({ error: "Form not found" }); return;
  }

  const fields = await db
    .select()
    .from(formFieldsTable)
    .where(eq(formFieldsTable.formId, id))
    .orderBy(asc(formFieldsTable.displayOrder));

  res.json({ ...form, fields });
});

// ── PATCH /forms/:id ─────────────────────────────────────────────────────────

router.patch("/forms/:id", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

  const id = parseId(req.params["id"]);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }

  const { name, nameAr, description, descriptionAr, module: mod, category, status, workflowEvent, showInSelfService, permissions, settings } = req.body as Record<string, unknown>;

  const updates: Partial<typeof formDefinitionsTable.$inferInsert> = {};
  if (name              !== undefined) updates.name              = String(name);
  if (nameAr            !== undefined) updates.nameAr            = nameAr ? String(nameAr) : null;
  if (description       !== undefined) updates.description       = description ? String(description) : null;
  if (descriptionAr     !== undefined) updates.descriptionAr     = descriptionAr ? String(descriptionAr) : null;
  if (mod               !== undefined) updates.module            = String(mod);
  if (category          !== undefined) updates.category          = category ? String(category) : null;
  if (status            !== undefined) updates.status            = String(status);
  if (workflowEvent     !== undefined) updates.workflowEvent     = workflowEvent ? String(workflowEvent) : null;
  if (showInSelfService !== undefined) updates.showInSelfService = showInSelfService === true;
  if (permissions       !== undefined) updates.permissions       = permissions as Record<string, unknown>;
  if (settings          !== undefined) updates.settings          = settings as Record<string, unknown>;

  const [updated] = await db
    .update(formDefinitionsTable)
    .set(updates)
    .where(and(eq(formDefinitionsTable.id, id), eq(formDefinitionsTable.workspaceId, req.workspaceId)))
    .returning();

  if (!updated) { res.status(404).json({ error: "Form not found" }); return; }
  res.json(updated);
});

// ── DELETE /forms/:id ─────────────────────────────────────────────────────────

router.delete("/forms/:id", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

  const id = parseId(req.params["id"]);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }

  await db
    .delete(formDefinitionsTable)
    .where(and(eq(formDefinitionsTable.id, id), eq(formDefinitionsTable.workspaceId, req.workspaceId)));

  res.status(204).send();
});

// ── POST /forms/:id/fields ────────────────────────────────────────────────────

router.post("/forms/:id/fields", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

  const formId = parseId(req.params["id"]);
  if (!formId) { res.status(400).json({ error: "Invalid id" }); return; }

  const [form] = await db.select({ id: formDefinitionsTable.id })
    .from(formDefinitionsTable)
    .where(and(eq(formDefinitionsTable.id, formId), eq(formDefinitionsTable.workspaceId, req.workspaceId)));
  if (!form) { res.status(404).json({ error: "Form not found" }); return; }

  const {
    name, label, labelAr, type, required, placeholder, placeholderAr,
    defaultValue, options, validation, conditional, dataSource, displayOrder,
  } = req.body as Record<string, unknown>;

  if (!name || !label || !type) { res.status(400).json({ error: "name, label, and type are required" }); return; }

  // auto-assign displayOrder if not provided
  let order = typeof displayOrder === "number" ? displayOrder : 0;
  if (!displayOrder) {
    const [{ maxOrder }] = await db
      .select({ maxOrder: sql<number>`coalesce(max(${formFieldsTable.displayOrder}), -1)` })
      .from(formFieldsTable)
      .where(eq(formFieldsTable.formId, formId));
    order = (maxOrder ?? -1) + 1;
  }

  const [field] = await db
    .insert(formFieldsTable)
    .values({
      formId,
      name:          String(name),
      label:         String(label),
      labelAr:       labelAr ? String(labelAr) : null,
      type:          String(type),
      required:      required === true,
      placeholder:   placeholder ? String(placeholder) : null,
      placeholderAr: placeholderAr ? String(placeholderAr) : null,
      defaultValue:  defaultValue ? String(defaultValue) : null,
      options:       options ?? null,
      validation:    validation ?? null,
      conditional:   conditional ?? null,
      dataSource:    dataSource ?? null,
      displayOrder:  order,
    })
    .returning();

  res.status(201).json(field);
});

// ── PATCH /forms/:id/fields/reorder ───────────────────────────────────────────

router.patch("/forms/:id/fields/reorder", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

  const formId = parseId(req.params["id"]);
  if (!formId) { res.status(400).json({ error: "Invalid id" }); return; }

  const { fieldIds } = req.body as { fieldIds?: number[] };
  if (!Array.isArray(fieldIds)) { res.status(400).json({ error: "fieldIds array required" }); return; }

  await Promise.all(
    fieldIds.map((fid, idx) =>
      db.update(formFieldsTable)
        .set({ displayOrder: idx })
        .where(and(eq(formFieldsTable.id, fid), eq(formFieldsTable.formId, formId))),
    ),
  );

  res.json({ ok: true });
});

// ── PATCH /forms/:id/fields/:fieldId ─────────────────────────────────────────

router.patch("/forms/:id/fields/:fieldId", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

  const formId  = parseId(req.params["id"]);
  const fieldId = parseId(req.params["fieldId"]);
  if (!formId || !fieldId) { res.status(400).json({ error: "Invalid id" }); return; }

  const body = req.body as Record<string, unknown>;
  const updates: Partial<typeof formFieldsTable.$inferInsert> = {};

  if (body["name"]          !== undefined) updates.name          = String(body["name"]);
  if (body["label"]         !== undefined) updates.label         = String(body["label"]);
  if (body["labelAr"]       !== undefined) updates.labelAr       = body["labelAr"] ? String(body["labelAr"]) : null;
  if (body["type"]          !== undefined) updates.type          = String(body["type"]);
  if (body["required"]      !== undefined) updates.required      = body["required"] === true;
  if (body["placeholder"]   !== undefined) updates.placeholder   = body["placeholder"] ? String(body["placeholder"]) : null;
  if (body["placeholderAr"] !== undefined) updates.placeholderAr = body["placeholderAr"] ? String(body["placeholderAr"]) : null;
  if (body["defaultValue"]  !== undefined) updates.defaultValue  = body["defaultValue"] ? String(body["defaultValue"]) : null;
  if (body["options"]       !== undefined) updates.options       = body["options"] as unknown[];
  if (body["validation"]    !== undefined) updates.validation    = body["validation"] as Record<string, unknown>;
  if (body["conditional"]   !== undefined) updates.conditional   = body["conditional"] as Record<string, unknown>;
  if (body["dataSource"]    !== undefined) updates.dataSource    = body["dataSource"] as Record<string, unknown> | null;
  if (body["displayOrder"]  !== undefined) updates.displayOrder  = Number(body["displayOrder"]);

  const [updated] = await db
    .update(formFieldsTable)
    .set(updates)
    .where(and(eq(formFieldsTable.id, fieldId), eq(formFieldsTable.formId, formId)))
    .returning();

  if (!updated) { res.status(404).json({ error: "Field not found" }); return; }
  res.json(updated);
});

// ── DELETE /forms/:id/fields/:fieldId ─────────────────────────────────────────

router.delete("/forms/:id/fields/:fieldId", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

  const formId  = parseId(req.params["id"]);
  const fieldId = parseId(req.params["fieldId"]);
  if (!formId || !fieldId) { res.status(400).json({ error: "Invalid id" }); return; }

  await db.delete(formFieldsTable)
    .where(and(eq(formFieldsTable.id, fieldId), eq(formFieldsTable.formId, formId)));

  res.status(204).send();
});

// ── POST /forms/:id/submissions ───────────────────────────────────────────────

router.post("/forms/:id/submissions", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId || !req.userId) { res.status(403).json({ error: "No workspace" }); return; }

  const formId = parseId(req.params["id"]);
  if (!formId) { res.status(400).json({ error: "Invalid id" }); return; }

  const [form] = await db
    .select()
    .from(formDefinitionsTable)
    .where(and(eq(formDefinitionsTable.id, formId), eq(formDefinitionsTable.workspaceId, req.workspaceId)));
  if (!form || form.status === "archived") { res.status(404).json({ error: "Form not found or archived" }); return; }

  const { data, status: submitStatus } = req.body as { data?: Record<string, unknown>; status?: string };
  if (!data || typeof data !== "object") { res.status(400).json({ error: "data object is required" }); return; }

  // ── Required field validation ─────────────────────────────────────────────
  const fields = await db
    .select()
    .from(formFieldsTable)
    .where(eq(formFieldsTable.formId, formId))
    .orderBy(asc(formFieldsTable.displayOrder));

  const validationErrors: Record<string, string> = {};

  for (const field of fields) {
    const val = data[field.name];
    const isEmpty = val === undefined || val === null || val === "";

    if (field.required && isEmpty) {
      validationErrors[field.name] = `${field.label} is required`;
      continue;
    }
    if (isEmpty) continue;

    const v = field.validation as Record<string, unknown> | null;
    if (v) {
      if (field.type === "number" && v["min"] !== undefined && Number(val) < Number(v["min"]))
        validationErrors[field.name] = `Minimum value is ${v["min"]}`;
      if (field.type === "number" && v["max"] !== undefined && Number(val) > Number(v["max"]))
        validationErrors[field.name] = `Maximum value is ${v["max"]}`;
      if ((field.type === "text" || field.type === "textarea") && v["minLength"] && String(val).length < Number(v["minLength"]))
        validationErrors[field.name] = `Minimum ${v["minLength"]} characters`;
      if ((field.type === "text" || field.type === "textarea") && v["maxLength"] && String(val).length > Number(v["maxLength"]))
        validationErrors[field.name] = `Maximum ${v["maxLength"]} characters`;
      if (v["pattern"] && !new RegExp(String(v["pattern"])).test(String(val)))
        validationErrors[field.name] = `Invalid format`;
    }
  }

  if (Object.keys(validationErrors).length > 0) {
    res.status(422).json({ error: "Validation failed", fields: validationErrors });
    return;
  }

  const finalStatus = submitStatus === "draft" ? "draft" : "submitted";

  const [submission] = await db
    .insert(formSubmissionsTable)
    .values({
      formId,
      workspaceId:   req.workspaceId,
      submittedById: req.userId,
      status:        finalStatus,
      data,
    })
    .returning();

  if (!submission) { res.status(500).json({ error: "Failed to create submission" }); return; }

  // ── Generate request number ────────────────────────────────────────────────
  let requestNumber: string | null = null;
  if (finalStatus === "submitted") {
    const year = new Date().getFullYear();
    const yearStart = new Date(`${year}-01-01T00:00:00Z`);
    const [countRow] = await db
      .select({ total: count() })
      .from(formSubmissionsTable)
      .where(and(
        eq(formSubmissionsTable.workspaceId, req.workspaceId),
        eq(formSubmissionsTable.status, "submitted"),
        sql`${formSubmissionsTable.submittedAt} >= ${yearStart.toISOString()}`,
      ));
    const seq = (countRow?.total ?? 0);
    requestNumber = `REQ-${year}-${String(seq).padStart(5, "0")}`;
    await db
      .update(formSubmissionsTable)
      .set({ requestNumber })
      .where(eq(formSubmissionsTable.id, submission.id));
  }

  // ── Fire canonical form.submitted event ──────────────────────────────────
  //
  // ── EVENT OWNERSHIP BOUNDARY ─────────────────────────────────────────────
  // forms.ts emits EVENT_TYPES.FORM_SUBMITTED ONLY.  Never a domain event.
  //
  // Domain events (leave.requested, approval.created) require typed, computed
  // payloads (foreign-key IDs, domain-specific fields).  A generic form
  // submission carries only raw form answers - emitting a domain event here
  // is a silent contract violation.  Domain routes (hr.ts, approvals.ts)
  // own their respective domain events.
  //
  // ── WORKFLOW ROUTING VIA workflowEventHint ────────────────────────────────
  // form.workflowEvent (DB column) is stored as workflowEventHint inside the
  // payload.  It is a WorkflowEngine-only routing key - NOT a bus event type.
  // WorkflowEngine.handleEvent() performs secondary (TIER 2) matching on this
  // hint, enabling per-form workflow_definitions rows to be triggered even
  // though all forms emit the single canonical "form.submitted" event type.
  //
  // Correct hint values (set at form-creation / seed time):
  //   "hr.form.submitted"        - HR module generic forms
  //   "approvals.form.submitted" - Approval-routed forms
  //   "system.form.submitted"    - General / IT / feedback forms
  //   "hr.annual-leave.submitted" - specific HR service slug
  //
  // ── BRIDGE COMPATIBILITY ──────────────────────────────────────────────────
  // appEventBus.emit() → bridge → eventDispatcher.dispatch() → workspace_event_logs
  // The bridge sets payload.event = "form.submitted" (the bus event type).
  // WorkflowEngine reads payload.data.workflowEventHint for TIER 2 matching.
  //
  if (finalStatus === "submitted") {
    void appEventBus.emit({
      type:      EVENT_TYPES.FORM_SUBMITTED,
      module:    "forms",
      workspace: { workspaceId: req.workspaceId! },
      actor:     { userId: req.userId!, role: req.userRole },
      metadata:  { idempotencyKey: `form-submitted-${submission.id}`, requestId: String(req.id) },
      data: {
        submissionId:      submission.id,
        formId:            form.id,
        formName:          form.name,
        owningModule:      form.module,
        submittedByUserId: req.userId!,
        answers:           data,
        workflowEventHint: form.workflowEvent ?? undefined,
      },
    });
  }

  // ── Send confirmation email ───────────────────────────────────────────────
  if (finalStatus === "submitted" && requestNumber) {
    void (async () => {
      try {
        // Get submitter email
        const [submitter] = await db
          .select({ email: usersTable.email, fullName: usersTable.fullName })
          .from(usersTable)
          .where(eq(usersTable.id, req.userId!));

        if (!submitter?.email) return;

        // Get workspace name
        const [ws] = await db
          .select({ name: workspacesTable.name })
          .from(workspacesTable)
          .where(eq(workspacesTable.id, req.workspaceId!));

        // Build human-readable field values
        const formattedFields = fields.map((f) => ({
          label:   f.label,
          labelAr: f.labelAr,
          value:   formatFieldValue(data[f.name]),
        }));

        await sendSubmissionConfirmation({
          toEmail:        submitter.email,
          submitterName:  submitter.fullName,
          requestNumber:  requestNumber!,
          formName:       form.name,
          formNameAr:     form.nameAr,
          status:         finalStatus,
          submittedAt:    submission.submittedAt,
          workspaceName:  ws?.name,
          fields:         formattedFields,
        });
      } catch (err) {
        req.log.error({ err }, "Failed to send confirmation email");
      }
    })();
  }

  res.status(201).json({ ...submission, requestNumber, files: [] });
});

// ── GET /forms/:id/submissions ────────────────────────────────────────────────

router.get("/forms/:id/submissions", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

  const formId = parseId(req.params["id"]);
  if (!formId) { res.status(400).json({ error: "Invalid id" }); return; }

  const { status } = req.query as Record<string, string | undefined>;
  const conditions = [
    eq(formSubmissionsTable.formId, formId),
    eq(formSubmissionsTable.workspaceId, req.workspaceId),
  ];
  if (status) conditions.push(eq(formSubmissionsTable.status, status));

  const rows = await db
    .select({
      id:              formSubmissionsTable.id,
      formId:          formSubmissionsTable.formId,
      formName:        formDefinitionsTable.name,
      workspaceId:     formSubmissionsTable.workspaceId,
      submittedById:   formSubmissionsTable.submittedById,
      submittedByName: usersTable.fullName,
      status:          formSubmissionsTable.status,
      data:            formSubmissionsTable.data,
      reviewNote:      formSubmissionsTable.reviewNote,
      reviewedById:    formSubmissionsTable.reviewedById,
      reviewedAt:      formSubmissionsTable.reviewedAt,
      submittedAt:     formSubmissionsTable.submittedAt,
      createdAt:       formSubmissionsTable.createdAt,
      updatedAt:       formSubmissionsTable.updatedAt,
    })
    .from(formSubmissionsTable)
    .leftJoin(usersTable, eq(formSubmissionsTable.submittedById, usersTable.id))
    .leftJoin(formDefinitionsTable, eq(formSubmissionsTable.formId, formDefinitionsTable.id))
    .where(and(...conditions))
    .orderBy(desc(formSubmissionsTable.submittedAt));

  res.json(rows.map((r) => ({ ...r, files: [] })));
});

// ── GET /my-submissions ───────────────────────────────────────────────────────
// Returns the authenticated user's own submissions (for "My Requests" tab)

router.get("/my-submissions", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId || !req.userId) { res.status(403).json({ error: "No workspace" }); return; }

  const { status } = req.query as Record<string, string | undefined>;
  const conditions = [
    eq(formSubmissionsTable.workspaceId, req.workspaceId),
    eq(formSubmissionsTable.submittedById, req.userId),
  ];
  if (status) conditions.push(eq(formSubmissionsTable.status, status));

  const rows = await db
    .select({
      id:              formSubmissionsTable.id,
      requestNumber:   formSubmissionsTable.requestNumber,
      formId:          formSubmissionsTable.formId,
      formName:        formDefinitionsTable.name,
      formNameAr:      formDefinitionsTable.nameAr,
      workspaceId:     formSubmissionsTable.workspaceId,
      submittedById:   formSubmissionsTable.submittedById,
      status:          formSubmissionsTable.status,
      data:            formSubmissionsTable.data,
      reviewNote:      formSubmissionsTable.reviewNote,
      reviewedById:    formSubmissionsTable.reviewedById,
      reviewedAt:      formSubmissionsTable.reviewedAt,
      submittedAt:     formSubmissionsTable.submittedAt,
      createdAt:       formSubmissionsTable.createdAt,
      updatedAt:       formSubmissionsTable.updatedAt,
    })
    .from(formSubmissionsTable)
    .leftJoin(formDefinitionsTable, eq(formSubmissionsTable.formId, formDefinitionsTable.id))
    .where(and(...conditions))
    .orderBy(desc(formSubmissionsTable.submittedAt));

  // For each running submission, look up the current workflow step / assignee
  const submissionIds = rows.map((r) => r.id);
  let stepMap: Record<number, { currentStepLabel: string | null; waitingOnName: string | null }> = {};

  if (submissionIds.length > 0) {
    // Find running workflow executions for these submissions
    const executions = await db
      .select({
        id:           workflowExecutionsTable.id,
        context:      workflowExecutionsTable.context,
        currentStep:  workflowExecutionsTable.currentStepIndex,
        status:       workflowExecutionsTable.status,
      })
      .from(workflowExecutionsTable)
      .where(and(
        eq(workflowExecutionsTable.workspaceId, req.workspaceId),
        eq(workflowExecutionsTable.status, "running"),
      ));

    // Match executions to submissions via context.submissionId
    const execForSubmission: Record<number, number> = {};
    for (const exec of executions) {
      const ctx = exec.context as Record<string, unknown>;
      const sid = Number(ctx["submissionId"]);
      if (sid && submissionIds.includes(sid)) {
        execForSubmission[sid] = exec.id;
      }
    }

    const execIds = Object.values(execForSubmission);
    if (execIds.length > 0) {
      const pendingTasks = await db
        .select({
          executionId: workflowTasksTable.executionId,
          title:       workflowTasksTable.title,
          assigneeId:  workflowTasksTable.assigneeId,
          assigneeName: usersTable.fullName,
        })
        .from(workflowTasksTable)
        .leftJoin(usersTable, eq(workflowTasksTable.assigneeId, usersTable.id))
        .where(and(
          inArray(workflowTasksTable.executionId, execIds),
          eq(workflowTasksTable.status, "pending"),
        ));

      for (const [subId, execId] of Object.entries(execForSubmission)) {
        const task = pendingTasks.find((t) => t.executionId === execId);
        stepMap[Number(subId)] = {
          currentStepLabel: task?.title ?? null,
          waitingOnName:    task?.assigneeName ?? null,
        };
      }
    }
  }

  res.json(rows.map((r) => ({
    ...r,
    submittedByName:  null,
    reviewedByName:   null,
    currentStepLabel: stepMap[r.id]?.currentStepLabel ?? null,
    waitingOnName:    stepMap[r.id]?.waitingOnName ?? null,
    files:            [],
  })));
});

// ── GET /form-submissions ─────────────────────────────────────────────────────

router.get("/form-submissions", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

  const { status, formId: formIdQ } = req.query as Record<string, string | undefined>;
  const conditions = [eq(formSubmissionsTable.workspaceId, req.workspaceId)];
  if (status)    conditions.push(eq(formSubmissionsTable.status, status));
  if (formIdQ)   conditions.push(eq(formSubmissionsTable.formId, parseInt(formIdQ)));

  const rows = await db
    .select({
      id:              formSubmissionsTable.id,
      formId:          formSubmissionsTable.formId,
      formName:        formDefinitionsTable.name,
      workspaceId:     formSubmissionsTable.workspaceId,
      submittedById:   formSubmissionsTable.submittedById,
      submittedByName: usersTable.fullName,
      status:          formSubmissionsTable.status,
      data:            formSubmissionsTable.data,
      reviewNote:      formSubmissionsTable.reviewNote,
      reviewedById:    formSubmissionsTable.reviewedById,
      reviewedAt:      formSubmissionsTable.reviewedAt,
      submittedAt:     formSubmissionsTable.submittedAt,
      createdAt:       formSubmissionsTable.createdAt,
      updatedAt:       formSubmissionsTable.updatedAt,
    })
    .from(formSubmissionsTable)
    .leftJoin(usersTable, eq(formSubmissionsTable.submittedById, usersTable.id))
    .leftJoin(formDefinitionsTable, eq(formSubmissionsTable.formId, formDefinitionsTable.id))
    .where(and(...conditions))
    .orderBy(desc(formSubmissionsTable.submittedAt));

  res.json(rows.map((r) => ({ ...r, files: [] })));
});

// ── GET /form-submissions/:id ─────────────────────────────────────────────────

router.get("/form-submissions/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

  const id = parseId(req.params["id"]);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }

  const [row] = await db
    .select({
      id:              formSubmissionsTable.id,
      formId:          formSubmissionsTable.formId,
      formName:        formDefinitionsTable.name,
      workspaceId:     formSubmissionsTable.workspaceId,
      submittedById:   formSubmissionsTable.submittedById,
      submittedByName: usersTable.fullName,
      status:          formSubmissionsTable.status,
      data:            formSubmissionsTable.data,
      reviewNote:      formSubmissionsTable.reviewNote,
      reviewedById:    formSubmissionsTable.reviewedById,
      reviewedAt:      formSubmissionsTable.reviewedAt,
      submittedAt:     formSubmissionsTable.submittedAt,
      createdAt:       formSubmissionsTable.createdAt,
      updatedAt:       formSubmissionsTable.updatedAt,
    })
    .from(formSubmissionsTable)
    .leftJoin(usersTable, eq(formSubmissionsTable.submittedById, usersTable.id))
    .leftJoin(formDefinitionsTable, eq(formSubmissionsTable.formId, formDefinitionsTable.id))
    .where(and(eq(formSubmissionsTable.id, id), eq(formSubmissionsTable.workspaceId, req.workspaceId)));

  if (!row) { res.status(404).json({ error: "Submission not found" }); return; }

  // Only submitter or admin can view
  const isAdmin = req.userRole === "admin" || req.userRole === "super_admin";
  if (!isAdmin && row.submittedById !== req.userId) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const files = await db
    .select()
    .from(formSubmissionFilesTable)
    .where(eq(formSubmissionFilesTable.submissionId, id));

  res.json({ ...row, files });
});

// ── PATCH /form-submissions/:id ───────────────────────────────────────────────

router.patch("/form-submissions/:id", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId || !req.userId) { res.status(403).json({ error: "No workspace" }); return; }

  const id = parseId(req.params["id"]);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }

  const { status, reviewNote } = req.body as { status?: string; reviewNote?: string };
  if (!status) { res.status(400).json({ error: "status is required" }); return; }

  const VALID = ["pending_approval", "approved", "rejected", "cancelled", "completed"];
  if (!VALID.includes(status)) { res.status(400).json({ error: `Invalid status. Valid: ${VALID.join(", ")}` }); return; }

  const [updated] = await db
    .update(formSubmissionsTable)
    .set({
      status,
      reviewNote:   reviewNote ?? null,
      reviewedById: req.userId,
      reviewedAt:   new Date(),
    })
    .where(and(eq(formSubmissionsTable.id, id), eq(formSubmissionsTable.workspaceId, req.workspaceId)))
    .returning();

  if (!updated) { res.status(404).json({ error: "Submission not found" }); return; }

  // Fetch with joins for full response
  const [row] = await db
    .select({
      id:              formSubmissionsTable.id,
      formId:          formSubmissionsTable.formId,
      formName:        formDefinitionsTable.name,
      workspaceId:     formSubmissionsTable.workspaceId,
      submittedById:   formSubmissionsTable.submittedById,
      submittedByName: usersTable.fullName,
      status:          formSubmissionsTable.status,
      data:            formSubmissionsTable.data,
      reviewNote:      formSubmissionsTable.reviewNote,
      reviewedById:    formSubmissionsTable.reviewedById,
      reviewedAt:      formSubmissionsTable.reviewedAt,
      submittedAt:     formSubmissionsTable.submittedAt,
      createdAt:       formSubmissionsTable.createdAt,
      updatedAt:       formSubmissionsTable.updatedAt,
    })
    .from(formSubmissionsTable)
    .leftJoin(usersTable, eq(formSubmissionsTable.submittedById, usersTable.id))
    .leftJoin(formDefinitionsTable, eq(formSubmissionsTable.formId, formDefinitionsTable.id))
    .where(eq(formSubmissionsTable.id, id));

  res.json({ ...row, files: [] });
});

export default router;
