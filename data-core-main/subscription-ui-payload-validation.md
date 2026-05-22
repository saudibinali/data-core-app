# Subscription UI Payload Validation

## Source

- Component: `SubscriptionStatePanel.tsx` → `handleCreate()`
- Hook: `useCreateTenantSubscription` → `POST /api/platform/tenants/:tenantId/subscription`
- Form: `subscription-form-ui.tsx` → `validateSubscriptionForm`

## Typical create payload (minimal)

```json
{
  "subscriptionCode": "SUB-001",
  "subscriptionName": "Acme Enterprise",
  "status": "trial"
}
```

Optional fields are **omitted** when empty (not sent as `""`):

- `startDate`, `endDate`, `renewalDate` — `onChange` uses `v || undefined`
- `planName`, `internalNotes` — trimmed or undefined
- `activeContractTermId` — only when user picks a contract

## With commercial account pre-filled

```json
{
  "subscriptionCode": "SUB-001",
  "subscriptionName": "Acme Enterprise",
  "status": "trial",
  "commercialAccountId": 10
}
```

`commercialAccountId: null` is sent when no account exists — backend `parseOptionalId(null)` → `null` (valid).

## Backend mapping (after fix)

| UI omitted field | JSON | Backend before fix | Backend after fix |
|------------------|------|--------------------|-------------------|
| `endDate` | absent | `"MISSING"` → **500** | `null` |
| `renewalDate` | absent | `"MISSING"` → **500** | `null` |
| `startDate` | absent | `null` (only field fixed) | `null` |
| `activeContractTermId` | absent | `"MISSING"` → **500** | `null` |
| `commercialAccountId` | absent | `"MISSING"` → **500** | `null` |

## UI does not call legacy APIs

- No `tenant_subscriptions` endpoints
- No `workspace_entitlements` bulk PATCH from create flow
- No quota/policy endpoints on create
