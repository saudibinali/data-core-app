# Workflow UX Redesign — Phase 3

## Removed from default tenant experience

- Exposed `trigger_event` picker as primary workflow creation path
- JSON condition builder as default approval configuration
- Ticket-only `/approvals` as sole approval surface

## Added

| Route | Purpose |
|-------|---------|
| `/process-templates` | Human-readable approval policies |
| `/self-service/approvals` | Unified inbox (org-routed) |

## Workflows page changes

- Header links to Process Templates + Approval Inbox
- **Create Workflow** visible only for `workflow.manage` (technical admin)
- Description updated to business-process language

## Approval inbox UX

- Shows process name, routing source, SLA warning
- Leave items: approve/reject via canonical `/hr/leave-requests/:id/*` (domain-safe)
- Other entities: unified `/self-service/approvals/.../steps/...` API

## Future (Phase 4+)

- Hide `/workflows` list entirely for standard HR admins
- Process template editor (no step JSON)
- Inbox filters: delegated, escalated, overdue
