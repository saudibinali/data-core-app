# Workforce Governance Enforcement — Phase 4

**Status:** Implemented (gradual cutover)

---

## Workspace settings

| Setting | Values | Default |
|---------|--------|---------|
| `workforceGovernanceMode` | legacy \| shadow \| active | **legacy** |
| `workforceActivationRequires` | JSON policy | null (uses built-in defaults) |

### Activation policy JSON

```json
{
  "orgUnit": true,
  "directManager": true,
  "employmentType": true,
  "jobTitle": false
}
```

## Enforcement layers

| Layer | Mode behavior |
|-------|---------------|
| Org linking | Delegates to Phase 2 `orgRuntimeMode` via `validateEmployeeOrgLinking` |
| Employment type | Block/warn when active employee missing type |
| Job title | Block/warn when active employee missing title |
| Invalid org transitions | Manager cycle, invalid org unit, self-manager |

## Mode matrix

| Mode | Behavior |
|------|----------|
| **legacy** | No governance blocks; org validation still uses org runtime mode independently |
| **shadow** | Log warnings only |
| **active** | HTTP 400 with codes: `MISSING_EMPLOYMENT_TYPE`, `MISSING_JOB_TITLE`, plus org codes |

## Wired endpoints

- `PATCH /hr/employees/:id` — governance check before update
- `POST /hr/employees/:id/lifecycle` — governance before lifecycle initiate
- `POST /hr/employees/:id/movements` — org validation via movement service

## Implementation

`artifacts/api-server/src/lib/workforce/operations/governance-service.ts`
