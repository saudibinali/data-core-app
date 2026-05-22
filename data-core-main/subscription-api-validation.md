# Subscription API Validation

## Canonical create route

| Property | Value |
|----------|--------|
| Method | `POST` |
| Path | `/api/platform/tenants/:tenantId/subscription` |
| Handler | `workspace-subscriptions.ts` |
| Permission | `platform.subscriptions.update` + super-admin |

## Router order (no shadowing)

In `routes/index.ts`:

- `tenantsRouter` — P13 `GET/PATCH .../subscription` **removed**
- `workspaceSubscriptionsRouter` — owns subscription CRUD

Frontend `use-tenant-subscription.ts` calls `/api/platform/tenants/${tenantId}/subscription` — **correct**.

## Request lifecycle (create)

1. `requireAuth` → `requireSuperAdmin` → `requirePlatformPermission`
2. Reject forbidden payment fields
3. Load workspace; 404 if missing
4. 409 if subscription already exists
5. Parse required `subscriptionCode`, `subscriptionName`, `status`
6. Parse optional IDs and dates → **normalize MISSING → null** (fix)
7. Validate commercial account / contract ownership
8. `validateSubscriptionDates`
9. `INSERT workspace_subscriptions RETURNING`
10. `INSERT activity_logs` audit
11. `201` + `serializeSubscription`

## Response shape

```json
{ "subscription": { "id", "workspaceId", "subscriptionCode", ... } }
```

## Related canonical routes

- `GET/PATCH` same path
- `PATCH .../subscription/status`
- `GET/PATCH .../product-modules` (module access)

## Removed (must not be called)

- P13 `PATCH /platform/tenants/:id/subscription` (metadata)
- `/platform/tenants/:id/entitlements` workspace_entitlements stack
