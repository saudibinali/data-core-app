# Approval Inbox Runtime — Phase 3

## Endpoint

`GET /api/self-service/approvals`

Returns pending steps where:

- `approver_user_id = current user`
- `approval_steps.status = pending`
- `approval_instances.status = pending`

## Item shape

```json
{
  "instanceId": 12,
  "stepId": 34,
  "processCode": "leave.standard",
  "processName": "leave / standard",
  "entityType": "leave_request",
  "entityId": 99,
  "dueAt": "2026-05-22T12:00:00.000Z",
  "slaWarning": true,
  "isDelegated": false,
  "routingSource": "direct_manager",
  "context": { "leaveType": "annual", "startDate": "2026-06-01" }
}
```

## Actions

| Entity | Approve path |
|--------|--------------|
| `leave_request` | `PATCH /hr/leave-requests/:id/approve` |
| Other | `PATCH /self-service/approvals/:instanceId/steps/:stepId/approve` |

## Detail

`GET /self-service/approvals/:instanceId` — instance + steps + policy

## SLA

`slaWarning: true` when due within 6 hours.
