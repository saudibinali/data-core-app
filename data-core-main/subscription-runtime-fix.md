# Subscription Runtime Fix

## Code change

**File:** `artifacts/api-server/src/routes/workspace-subscriptions.ts`

**Helpers added:**

```typescript
function dateFieldToNull(v: string | null | "INVALID" | "MISSING"): string | null
function optionalIdToNull(v: number | null | "INVALID" | "MISSING"): number | null
```

**POST create:** normalize `commercialAccountId`, `activeContractTermId`, `startDate`, `endDate`, `renewalDate` before `validateSubscriptionDates` and `.insert()`.

**PATCH update:** same normalization for optional IDs and date patches.

## Verified flows (automated)

| Flow | Test / check |
|------|----------------|
| Create minimal subscription | New vitest case — 201, insert values all `null` for omitted optionals |
| Create full subscription | Existing test — 201 |
| Duplicate guard | 409 |
| Invalid dates | 400 |
| Forbidden Stripe fields | 400 |
| Cross-tenant commercial account | 400 |

## Manual verification (after API restart)

1. Create subscription — code + name only → **201**
2. Edit subscription — add dates + contract → **200**
3. PATCH status — reason + status → **200**
4. Product modules toggle → **200**
5. Workspace access update → **200**

## Principles

- No try/catch masking DB errors
- No fake success responses
- Invalid input still returns **400** with explicit message
- DB errors only when schema/data is genuinely wrong
