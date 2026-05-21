-- P20-D: Geofence & attendance policies (self-service foundation)

CREATE TABLE IF NOT EXISTS "attendance_geofences" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "work_location_id" integer REFERENCES "hr_work_locations"("id") ON DELETE SET NULL,
  "name" text NOT NULL,
  "latitude" double precision NOT NULL,
  "longitude" double precision NOT NULL,
  "radius_meters" integer DEFAULT 200 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_attendance_geofences_workspace" ON "attendance_geofences" ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_attendance_geofences_location" ON "attendance_geofences" ("work_location_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_attendance_geofences_active" ON "attendance_geofences" ("is_active");

CREATE TABLE IF NOT EXISTS "attendance_policies" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "name" text DEFAULT 'Default' NOT NULL,
  "is_default" boolean DEFAULT false NOT NULL,
  "policy_json" text NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_attendance_policies_workspace" ON "attendance_policies" ("workspace_id");
