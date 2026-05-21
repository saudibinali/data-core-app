-- P17-B/D/E — Platform user permission overrides, access reviews, invitations

CREATE TABLE IF NOT EXISTS "platform_user_permission_overrides" (
  "id" serial PRIMARY KEY,
  "platform_user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "permission_code" text NOT NULL,
  "effect" text NOT NULL,
  "reason" text NOT NULL,
  "created_by" integer NOT NULL,
  "updated_by" integer NOT NULL,
  "removed_at" timestamptz,
  "removed_by" integer,
  "remove_reason" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "platform_user_perm_override_active_unique_idx"
  ON "platform_user_permission_overrides" ("platform_user_id", "permission_code")
  WHERE "removed_at" IS NULL;

CREATE INDEX IF NOT EXISTS "platform_user_perm_override_user_idx"
  ON "platform_user_permission_overrides" ("platform_user_id");

CREATE TABLE IF NOT EXISTS "platform_user_access_reviews" (
  "id" serial PRIMARY KEY,
  "platform_user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "reviewed_by" integer NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "reviewed_at" timestamptz NOT NULL DEFAULT now(),
  "review_status" text NOT NULL,
  "review_notes" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "platform_user_access_review_user_idx"
  ON "platform_user_access_reviews" ("platform_user_id");

CREATE TABLE IF NOT EXISTS "platform_user_invitations" (
  "id" serial PRIMARY KEY,
  "platform_user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "email" text NOT NULL,
  "token_hash" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "expires_at" timestamptz NOT NULL,
  "accepted_at" timestamptz,
  "revoked_at" timestamptz,
  "revoked_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "revoke_reason" text,
  "created_by" integer NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "platform_user_invitation_one_pending_per_user_idx"
  ON "platform_user_invitations" ("platform_user_id")
  WHERE "status" = 'pending';

CREATE INDEX IF NOT EXISTS "platform_user_invitation_user_idx"
  ON "platform_user_invitations" ("platform_user_id");

CREATE INDEX IF NOT EXISTS "platform_user_invitation_status_idx"
  ON "platform_user_invitations" ("status");
