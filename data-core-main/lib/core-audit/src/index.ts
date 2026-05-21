/**
 * @workspace/core-audit
 *
 * Public surface of the core-audit package.
 * Export only the types that cross package boundaries.
 * Do NOT export runtime implementations from here.
 */

export type {
  AuditAction,
  AuditEntityRef,
  AuditRecord,
  AuditEmitRequest,
} from "./types";
