CREATE TABLE "workspaces" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo_url" text,
	"primary_color" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspaces_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "platform_modules" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"name_ar" text NOT NULL,
	"description" text,
	"description_ar" text,
	"icon" text DEFAULT 'Box' NOT NULL,
	"version" text DEFAULT '1.0.0' NOT NULL,
	"category" text DEFAULT 'core' NOT NULL,
	"core" boolean DEFAULT false NOT NULL,
	"default_enabled" boolean DEFAULT true NOT NULL,
	"navigation_path" text,
	"permission_key" text,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_modules_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "workspace_module_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"module_key" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_workspace_module" UNIQUE("workspace_id","module_key")
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"manager_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_custom_roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"color" text DEFAULT '#6366f1' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_role_permissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"custom_role_id" integer NOT NULL,
	"permission" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"clerk_id" text,
	"password_hash" text,
	"workspace_id" integer,
	"email" text,
	"first_name" text,
	"last_name" text,
	"full_name" text NOT NULL,
	"employee_number" text,
	"employee_id" text,
	"position" text,
	"avatar_url" text,
	"phone_number" text,
	"extension_number" text,
	"language_preference" text,
	"time_zone" text,
	"employment_status" text DEFAULT 'active' NOT NULL,
	"signature" text,
	"line_manager_id" integer,
	"department_id" integer,
	"role" text DEFAULT 'member' NOT NULL,
	"custom_role_id" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"must_reset_password" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_clerk_id_unique" UNIQUE("clerk_id")
);
--> statement-breakpoint
CREATE TABLE "user_departments" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"department_id" integer NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"department_role" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_departments_user_id_department_id_unique" UNIQUE("user_id","department_id")
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"name" text NOT NULL,
	"email_alias" text,
	"description" text,
	"send_permissions" text DEFAULT 'members_only' NOT NULL,
	"visibility" text DEFAULT 'workspace' NOT NULL,
	"moderation" text DEFAULT 'none' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "group_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"group_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"is_owner" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_members_group_id_user_id_unique" UNIQUE("group_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "ticket_cc" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'open' NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"department_id" integer,
	"created_by_user_id" integer NOT NULL,
	"assignee_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_id" integer NOT NULL,
	"author_id" integer,
	"content" text NOT NULL,
	"is_internal" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"ticket_id" integer,
	"is_read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_id" integer NOT NULL,
	"requested_by_user_id" integer,
	"approver_user_id" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_id" integer,
	"user_id" integer,
	"action" text NOT NULL,
	"metadata" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_invitations" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"email" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"invited_by_user_id" integer,
	"clerk_invitation_id" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_recipients" (
	"id" serial PRIMARY KEY NOT NULL,
	"message_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"recipient_type" text DEFAULT 'to' NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"is_archived_by_recipient" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_recipients_message_id_user_id_unique" UNIQUE("message_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"sender_id" integer,
	"subject" text DEFAULT '(No subject)' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'sent' NOT NULL,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"is_important" boolean DEFAULT false NOT NULL,
	"attachments" json DEFAULT '[]'::json,
	"parent_id" integer,
	"related_ticket_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_event_participants" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"participant_type" text DEFAULT 'main' NOT NULL,
	"status" text DEFAULT 'invited' NOT NULL,
	"rsvp_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"invitation_message" text,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"is_all_day" boolean DEFAULT false NOT NULL,
	"event_type" text DEFAULT 'in_person' NOT NULL,
	"location" text,
	"meeting_link" text,
	"priority" text DEFAULT 'medium' NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"notes" text,
	"attachments" json DEFAULT '[]'::json,
	"created_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_event_registry" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_name" text NOT NULL,
	"module" text NOT NULL,
	"description" text,
	"description_ar" text,
	"schema" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_event_registry_event_name_unique" UNIQUE("event_name")
);
--> statement-breakpoint
CREATE TABLE "workspace_event_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"event_name" text NOT NULL,
	"module" text NOT NULL,
	"triggered_by" integer,
	"status" text DEFAULT 'completed' NOT NULL,
	"payload" jsonb NOT NULL,
	"result" jsonb,
	"error" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workflow_definitions" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"name_ar" text,
	"description" text,
	"description_ar" text,
	"module" text NOT NULL,
	"trigger_event" text NOT NULL,
	"conditions" jsonb DEFAULT '[]' NOT NULL,
	"steps" jsonb DEFAULT '[]' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_execution_steps" (
	"id" serial PRIMARY KEY NOT NULL,
	"execution_id" integer NOT NULL,
	"step_index" integer NOT NULL,
	"step_type" text NOT NULL,
	"step_name" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"input" jsonb DEFAULT '{}' NOT NULL,
	"output" jsonb,
	"error" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workflow_executions" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"workflow_id" integer NOT NULL,
	"trigger_event_log_id" integer,
	"triggered_by" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"current_step_index" integer DEFAULT 0 NOT NULL,
	"context" jsonb DEFAULT '{}' NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workflow_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"execution_id" integer NOT NULL,
	"step_index" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"assignee_id" integer,
	"due_date" timestamp with time zone,
	"priority" text DEFAULT 'medium' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "form_definitions" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"name" text NOT NULL,
	"name_ar" text,
	"description" text,
	"description_ar" text,
	"module" text DEFAULT 'system' NOT NULL,
	"category" text,
	"status" text DEFAULT 'active' NOT NULL,
	"workflow_event" text,
	"permissions" jsonb,
	"settings" jsonb,
	"show_in_self_service" boolean DEFAULT false NOT NULL,
	"created_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "form_fields" (
	"id" serial PRIMARY KEY NOT NULL,
	"form_id" integer NOT NULL,
	"name" text NOT NULL,
	"label" text NOT NULL,
	"label_ar" text,
	"type" text DEFAULT 'text' NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"placeholder" text,
	"placeholder_ar" text,
	"default_value" text,
	"options" jsonb,
	"validation" jsonb,
	"conditional" jsonb,
	"data_source" jsonb,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "form_submission_files" (
	"id" serial PRIMARY KEY NOT NULL,
	"submission_id" integer NOT NULL,
	"field_name" text NOT NULL,
	"original_name" text NOT NULL,
	"storage_path" text NOT NULL,
	"mime_type" text,
	"file_size_bytes" integer,
	"uploaded_by_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "form_submissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"form_id" integer NOT NULL,
	"workspace_id" integer NOT NULL,
	"submitted_by_id" integer NOT NULL,
	"request_number" text,
	"status" text DEFAULT 'submitted' NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"review_note" text,
	"reviewed_by_id" integer,
	"reviewed_at" timestamp with time zone,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"user_id" integer,
	"employee_number" text,
	"first_name" text,
	"last_name" text,
	"full_name" text NOT NULL,
	"email" text,
	"phone_number" text,
	"avatar_url" text,
	"status" text DEFAULT 'active' NOT NULL,
	"nationality" text,
	"gender" text,
	"date_of_birth" date,
	"marital_status" text,
	"address" text,
	"national_id" text,
	"passport_number" text,
	"employment_type" text DEFAULT 'full_time' NOT NULL,
	"hire_date" date,
	"end_date" date,
	"probation_end_date" date,
	"org_unit_id" integer,
	"job_title_id" integer,
	"job_grade_id" integer,
	"position_id" integer,
	"work_location_id" integer,
	"position" text,
	"direct_manager_id" integer,
	"company" text,
	"branch" text,
	"location" text,
	"emergency_contact_name" text,
	"emergency_contact_phone" text,
	"emergency_contact_relation" text,
	"leave_balances" jsonb,
	"onboarding_data" jsonb,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employees_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "hr_attendance" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"date" date NOT NULL,
	"shift_id" integer,
	"check_in" text,
	"check_out" text,
	"status" text DEFAULT 'present' NOT NULL,
	"source_type" text DEFAULT 'manual' NOT NULL,
	"late_minutes" integer DEFAULT 0 NOT NULL,
	"early_leave_minutes" integer DEFAULT 0 NOT NULL,
	"overtime_minutes" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"approved_by" integer,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_calendar_holidays" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"calendar_id" integer NOT NULL,
	"name" text NOT NULL,
	"name_ar" text,
	"date" date NOT NULL,
	"type" text DEFAULT 'holiday' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_contract_types" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"name_ar" text,
	"color" text DEFAULT '#6366f1' NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_custom_field_defs" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"section" text DEFAULT 'custom' NOT NULL,
	"name" text NOT NULL,
	"label" text NOT NULL,
	"label_ar" text,
	"field_type" text DEFAULT 'text' NOT NULL,
	"options" jsonb,
	"linked_config" jsonb,
	"required" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_custom_field_values" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"field_def_id" integer NOT NULL,
	"value" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_document_types" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"name" text NOT NULL,
	"name_ar" text,
	"code" text,
	"has_expiry" boolean DEFAULT false NOT NULL,
	"is_required" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_employee_activity" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"action" text NOT NULL,
	"description" text,
	"changes" jsonb,
	"performed_by" integer,
	"performed_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_employee_compensation_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"compensation_id" integer NOT NULL,
	"component_id" integer NOT NULL,
	"amount" text,
	"percentage" text,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "hr_employee_compensations" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"structure_id" integer,
	"basic_salary" text DEFAULT '0' NOT NULL,
	"currency_code" text DEFAULT 'SAR' NOT NULL,
	"effective_date" date NOT NULL,
	"end_date" date,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"approved_by" integer,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_employee_contracts" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"contract_type" text DEFAULT 'permanent' NOT NULL,
	"start_date" date,
	"end_date" date,
	"status" text DEFAULT 'active' NOT NULL,
	"salary" text,
	"currency" text DEFAULT 'SAR' NOT NULL,
	"notes" text,
	"attachments" jsonb,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_employee_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"document_type" text DEFAULT 'other' NOT NULL,
	"name" text NOT NULL,
	"document_number" text,
	"issue_date" date,
	"expiry_date" date,
	"object_path" text,
	"file_name" text,
	"file_size" integer,
	"notes" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_employee_leaves" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"leave_type" text DEFAULT 'annual' NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"days_count" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"reason" text,
	"notes" text,
	"approved_by" integer,
	"approved_at" timestamp with time zone,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_employee_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"content" text NOT NULL,
	"note_type" text DEFAULT 'general' NOT NULL,
	"is_confidential" boolean DEFAULT false NOT NULL,
	"created_by" integer,
	"created_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_employee_position_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"change_type" text DEFAULT 'other' NOT NULL,
	"effective_date" date NOT NULL,
	"from_title" text,
	"to_title" text,
	"from_org_unit_id" integer,
	"to_org_unit_id" integer,
	"from_grade" text,
	"to_grade" text,
	"from_manager_id" integer,
	"to_manager_id" integer,
	"notes" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_employee_statuses" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"name_ar" text,
	"color" text DEFAULT '#6366f1' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_final" boolean DEFAULT false NOT NULL,
	"allow_self_service" boolean DEFAULT false NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_employment_types" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"name_ar" text,
	"color" text DEFAULT '#6366f1' NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_job_grades" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"name" text NOT NULL,
	"name_ar" text,
	"code" text,
	"level" integer,
	"description" text,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_job_titles" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"name" text NOT NULL,
	"name_ar" text,
	"code" text,
	"grade_id" integer,
	"description" text,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_leave_balances" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"leave_policy_id" integer,
	"leave_type" text DEFAULT 'annual' NOT NULL,
	"year" integer NOT NULL,
	"entitled" text DEFAULT '0' NOT NULL,
	"used" text DEFAULT '0' NOT NULL,
	"pending" text DEFAULT '0' NOT NULL,
	"carried_forward" text DEFAULT '0' NOT NULL,
	"manual_adjustment" text DEFAULT '0' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_leave_policies" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"name" text NOT NULL,
	"name_ar" text,
	"code" text,
	"leave_type" text DEFAULT 'annual' NOT NULL,
	"annual_days" integer DEFAULT 0 NOT NULL,
	"accrual_type" text DEFAULT 'monthly' NOT NULL,
	"carry_over" boolean DEFAULT false NOT NULL,
	"max_carry_over_days" integer,
	"paid" boolean DEFAULT true NOT NULL,
	"requires_approval" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_org_units" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"type" text DEFAULT 'department' NOT NULL,
	"name" text NOT NULL,
	"name_ar" text,
	"code" text,
	"parent_id" integer,
	"color" text DEFAULT '#6366f1' NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_overtime_policies" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"name" text NOT NULL,
	"name_ar" text,
	"day_type" text DEFAULT 'any' NOT NULL,
	"calculation_type" text DEFAULT 'multiplier' NOT NULL,
	"rate_multiplier" text DEFAULT '1.5' NOT NULL,
	"fixed_rate_per_hour" text,
	"max_hours_per_day" text,
	"max_hours_per_month" text,
	"min_threshold_minutes" integer DEFAULT 30 NOT NULL,
	"requires_approval" boolean DEFAULT true NOT NULL,
	"auto_calculate" boolean DEFAULT true NOT NULL,
	"salary_component_id" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_overtime_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"attendance_id" integer,
	"policy_id" integer,
	"shift_id" integer,
	"date" date NOT NULL,
	"start_time" text,
	"end_time" text,
	"duration_minutes" integer DEFAULT 0 NOT NULL,
	"calculated_amount" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"approved_by" integer,
	"approved_at" timestamp with time zone,
	"payroll_run_id" integer,
	"payslip_id" integer,
	"notes" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_payroll_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"period_year" integer NOT NULL,
	"period_month" integer NOT NULL,
	"currency_code" text DEFAULT 'SAR' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"total_basic" text DEFAULT '0' NOT NULL,
	"total_allowances" text DEFAULT '0' NOT NULL,
	"total_deductions" text DEFAULT '0' NOT NULL,
	"total_bonus" text DEFAULT '0' NOT NULL,
	"total_overtime" text DEFAULT '0' NOT NULL,
	"total_gross" text DEFAULT '0' NOT NULL,
	"total_net" text DEFAULT '0' NOT NULL,
	"employee_count" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"processed_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"processed_by" integer,
	"approved_by" integer,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_payslip_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"payslip_id" integer NOT NULL,
	"component_id" integer,
	"component_code" text NOT NULL,
	"component_name" text NOT NULL,
	"component_name_ar" text,
	"component_type" text DEFAULT 'allowance' NOT NULL,
	"amount" text DEFAULT '0' NOT NULL,
	"quantity" text DEFAULT '1' NOT NULL,
	"notes" text,
	"display_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_payslips" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"payroll_run_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"compensation_id" integer,
	"basic_salary" text DEFAULT '0' NOT NULL,
	"total_allowances" text DEFAULT '0' NOT NULL,
	"total_deductions" text DEFAULT '0' NOT NULL,
	"total_bonus" text DEFAULT '0' NOT NULL,
	"total_overtime" text DEFAULT '0' NOT NULL,
	"gross_salary" text DEFAULT '0' NOT NULL,
	"net_salary" text DEFAULT '0' NOT NULL,
	"currency_code" text DEFAULT 'SAR' NOT NULL,
	"working_days" integer,
	"actual_days" integer,
	"absent_days" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_positions" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"job_title_id" integer,
	"org_unit_id" integer,
	"job_grade_id" integer,
	"work_location_id" integer,
	"code" text,
	"title" text NOT NULL,
	"title_ar" text,
	"description" text,
	"status" text DEFAULT 'vacant' NOT NULL,
	"headcount" integer DEFAULT 1 NOT NULL,
	"current_occupancy" integer DEFAULT 0 NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_probation_policies" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"name" text NOT NULL,
	"name_ar" text,
	"duration_days" integer DEFAULT 90 NOT NULL,
	"extendable" boolean DEFAULT false NOT NULL,
	"max_extension_days" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_salary_bands" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"name_ar" text,
	"grade_id" integer,
	"currency_code" text DEFAULT 'SAR' NOT NULL,
	"min_amount" text DEFAULT '0' NOT NULL,
	"midpoint_amount" text,
	"max_amount" text DEFAULT '0' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_salary_components" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"name_ar" text,
	"component_type" text DEFAULT 'allowance' NOT NULL,
	"calculation_type" text DEFAULT 'fixed' NOT NULL,
	"default_value" text,
	"is_taxable" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_salary_structure_components" (
	"id" serial PRIMARY KEY NOT NULL,
	"structure_id" integer NOT NULL,
	"component_id" integer NOT NULL,
	"amount" text,
	"percentage" text,
	"display_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_salary_structures" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"name_ar" text,
	"description" text,
	"currency_code" text DEFAULT 'SAR' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_service_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"name" text NOT NULL,
	"name_ar" text,
	"slug" text NOT NULL,
	"icon" text DEFAULT 'Tag' NOT NULL,
	"color" text DEFAULT '#6366f1' NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_services" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"name" text NOT NULL,
	"name_ar" text,
	"description" text,
	"description_ar" text,
	"icon" text DEFAULT 'FileText' NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"form_id" integer,
	"workflow_event" text,
	"status" text DEFAULT 'active' NOT NULL,
	"permissions" jsonb,
	"settings" jsonb,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_shifts" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"name_ar" text,
	"start_time" text DEFAULT '08:00' NOT NULL,
	"end_time" text DEFAULT '17:00' NOT NULL,
	"break_minutes" integer DEFAULT 60 NOT NULL,
	"grace_minutes" integer DEFAULT 15 NOT NULL,
	"is_flexible" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_work_calendars" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"name_ar" text,
	"work_days" jsonb DEFAULT '[1,2,3,4,5]'::jsonb NOT NULL,
	"timezone" text DEFAULT 'Asia/Riyadh' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_work_locations" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"name" text NOT NULL,
	"name_ar" text,
	"code" text,
	"type" text DEFAULT 'office' NOT NULL,
	"address" text,
	"city" text,
	"country" text,
	"timezone" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_workspace_counters" (
	"workspace_id" integer NOT NULL,
	"counter_name" text NOT NULL,
	"current_value" integer DEFAULT 1000 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_hr_workspace_counters" PRIMARY KEY("workspace_id","counter_name")
);
--> statement-breakpoint
CREATE TABLE "hr_workspace_settings" (
	"workspace_id" integer PRIMARY KEY NOT NULL,
	"numbering_mode" text DEFAULT 'auto' NOT NULL,
	"numbering_start_from" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_settings" (
	"category" text PRIMARY KEY NOT NULL,
	"value" jsonb DEFAULT '{}' NOT NULL,
	"updated_by" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace_module_settings" ADD CONSTRAINT "workspace_module_settings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_custom_roles" ADD CONSTRAINT "workspace_custom_roles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_role_permissions" ADD CONSTRAINT "workspace_role_permissions_custom_role_id_workspace_custom_roles_id_fk" FOREIGN KEY ("custom_role_id") REFERENCES "public"."workspace_custom_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_departments" ADD CONSTRAINT "user_departments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_departments" ADD CONSTRAINT "user_departments_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_cc" ADD CONSTRAINT "ticket_cc_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_cc" ADD CONSTRAINT "ticket_cc_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_comments" ADD CONSTRAINT "ticket_comments_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_comments" ADD CONSTRAINT "ticket_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_approver_user_id_users_id_fk" FOREIGN KEY ("approver_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_recipients" ADD CONSTRAINT "message_recipients_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_recipients" ADD CONSTRAINT "message_recipients_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event_participants" ADD CONSTRAINT "calendar_event_participants_event_id_calendar_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."calendar_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event_participants" ADD CONSTRAINT "calendar_event_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_event_logs" ADD CONSTRAINT "workspace_event_logs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_event_logs" ADD CONSTRAINT "workspace_event_logs_triggered_by_users_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_execution_steps" ADD CONSTRAINT "workflow_execution_steps_execution_id_workflow_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."workflow_executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_workflow_id_workflow_definitions_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_triggered_by_users_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_tasks" ADD CONSTRAINT "workflow_tasks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_tasks" ADD CONSTRAINT "workflow_tasks_execution_id_workflow_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."workflow_executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_tasks" ADD CONSTRAINT "workflow_tasks_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_definitions" ADD CONSTRAINT "form_definitions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_definitions" ADD CONSTRAINT "form_definitions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_fields" ADD CONSTRAINT "form_fields_form_id_form_definitions_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."form_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submission_files" ADD CONSTRAINT "form_submission_files_submission_id_form_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."form_submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submission_files" ADD CONSTRAINT "form_submission_files_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_form_id_form_definitions_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."form_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_submitted_by_id_users_id_fk" FOREIGN KEY ("submitted_by_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_reviewed_by_id_users_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_org_unit_id_hr_org_units_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "public"."hr_org_units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_job_title_id_hr_job_titles_id_fk" FOREIGN KEY ("job_title_id") REFERENCES "public"."hr_job_titles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_job_grade_id_hr_job_grades_id_fk" FOREIGN KEY ("job_grade_id") REFERENCES "public"."hr_job_grades"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_position_id_hr_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."hr_positions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_work_location_id_hr_work_locations_id_fk" FOREIGN KEY ("work_location_id") REFERENCES "public"."hr_work_locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_attendance" ADD CONSTRAINT "hr_attendance_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_attendance" ADD CONSTRAINT "hr_attendance_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_attendance" ADD CONSTRAINT "hr_attendance_shift_id_hr_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."hr_shifts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_attendance" ADD CONSTRAINT "hr_attendance_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_attendance" ADD CONSTRAINT "hr_attendance_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_calendar_holidays" ADD CONSTRAINT "hr_calendar_holidays_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_calendar_holidays" ADD CONSTRAINT "hr_calendar_holidays_calendar_id_hr_work_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."hr_work_calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_contract_types" ADD CONSTRAINT "hr_contract_types_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_custom_field_defs" ADD CONSTRAINT "hr_custom_field_defs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_custom_field_values" ADD CONSTRAINT "hr_custom_field_values_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_custom_field_values" ADD CONSTRAINT "hr_custom_field_values_field_def_id_hr_custom_field_defs_id_fk" FOREIGN KEY ("field_def_id") REFERENCES "public"."hr_custom_field_defs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_document_types" ADD CONSTRAINT "hr_document_types_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_employee_activity" ADD CONSTRAINT "hr_employee_activity_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_employee_activity" ADD CONSTRAINT "hr_employee_activity_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_employee_activity" ADD CONSTRAINT "hr_employee_activity_performed_by_users_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_employee_compensation_items" ADD CONSTRAINT "hr_employee_compensation_items_compensation_id_hr_employee_compensations_id_fk" FOREIGN KEY ("compensation_id") REFERENCES "public"."hr_employee_compensations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_employee_compensation_items" ADD CONSTRAINT "hr_employee_compensation_items_component_id_hr_salary_components_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."hr_salary_components"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_employee_compensations" ADD CONSTRAINT "hr_employee_compensations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_employee_compensations" ADD CONSTRAINT "hr_employee_compensations_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_employee_compensations" ADD CONSTRAINT "hr_employee_compensations_structure_id_hr_salary_structures_id_fk" FOREIGN KEY ("structure_id") REFERENCES "public"."hr_salary_structures"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_employee_compensations" ADD CONSTRAINT "hr_employee_compensations_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_employee_compensations" ADD CONSTRAINT "hr_employee_compensations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_employee_contracts" ADD CONSTRAINT "hr_employee_contracts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_employee_contracts" ADD CONSTRAINT "hr_employee_contracts_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_employee_contracts" ADD CONSTRAINT "hr_employee_contracts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_employee_documents" ADD CONSTRAINT "hr_employee_documents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_employee_documents" ADD CONSTRAINT "hr_employee_documents_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_employee_documents" ADD CONSTRAINT "hr_employee_documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_employee_leaves" ADD CONSTRAINT "hr_employee_leaves_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_employee_leaves" ADD CONSTRAINT "hr_employee_leaves_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_employee_leaves" ADD CONSTRAINT "hr_employee_leaves_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_employee_leaves" ADD CONSTRAINT "hr_employee_leaves_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_employee_notes" ADD CONSTRAINT "hr_employee_notes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_employee_notes" ADD CONSTRAINT "hr_employee_notes_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_employee_notes" ADD CONSTRAINT "hr_employee_notes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_employee_position_history" ADD CONSTRAINT "hr_employee_position_history_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_employee_position_history" ADD CONSTRAINT "hr_employee_position_history_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_employee_position_history" ADD CONSTRAINT "hr_employee_position_history_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_employee_statuses" ADD CONSTRAINT "hr_employee_statuses_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_employment_types" ADD CONSTRAINT "hr_employment_types_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_job_grades" ADD CONSTRAINT "hr_job_grades_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_job_titles" ADD CONSTRAINT "hr_job_titles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_job_titles" ADD CONSTRAINT "hr_job_titles_grade_id_hr_job_grades_id_fk" FOREIGN KEY ("grade_id") REFERENCES "public"."hr_job_grades"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_leave_balances" ADD CONSTRAINT "hr_leave_balances_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_leave_balances" ADD CONSTRAINT "hr_leave_balances_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_leave_balances" ADD CONSTRAINT "hr_leave_balances_leave_policy_id_hr_leave_policies_id_fk" FOREIGN KEY ("leave_policy_id") REFERENCES "public"."hr_leave_policies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_leave_policies" ADD CONSTRAINT "hr_leave_policies_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_org_units" ADD CONSTRAINT "hr_org_units_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_overtime_policies" ADD CONSTRAINT "hr_overtime_policies_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_overtime_policies" ADD CONSTRAINT "hr_overtime_policies_salary_component_id_hr_salary_components_id_fk" FOREIGN KEY ("salary_component_id") REFERENCES "public"."hr_salary_components"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_overtime_records" ADD CONSTRAINT "hr_overtime_records_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_overtime_records" ADD CONSTRAINT "hr_overtime_records_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_overtime_records" ADD CONSTRAINT "hr_overtime_records_attendance_id_hr_attendance_id_fk" FOREIGN KEY ("attendance_id") REFERENCES "public"."hr_attendance"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_overtime_records" ADD CONSTRAINT "hr_overtime_records_policy_id_hr_overtime_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."hr_overtime_policies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_overtime_records" ADD CONSTRAINT "hr_overtime_records_shift_id_hr_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."hr_shifts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_overtime_records" ADD CONSTRAINT "hr_overtime_records_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_overtime_records" ADD CONSTRAINT "hr_overtime_records_payroll_run_id_hr_payroll_runs_id_fk" FOREIGN KEY ("payroll_run_id") REFERENCES "public"."hr_payroll_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_overtime_records" ADD CONSTRAINT "hr_overtime_records_payslip_id_hr_payslips_id_fk" FOREIGN KEY ("payslip_id") REFERENCES "public"."hr_payslips"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_overtime_records" ADD CONSTRAINT "hr_overtime_records_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_payroll_runs" ADD CONSTRAINT "hr_payroll_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_payroll_runs" ADD CONSTRAINT "hr_payroll_runs_processed_by_users_id_fk" FOREIGN KEY ("processed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_payroll_runs" ADD CONSTRAINT "hr_payroll_runs_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_payroll_runs" ADD CONSTRAINT "hr_payroll_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_payslip_lines" ADD CONSTRAINT "hr_payslip_lines_payslip_id_hr_payslips_id_fk" FOREIGN KEY ("payslip_id") REFERENCES "public"."hr_payslips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_payslip_lines" ADD CONSTRAINT "hr_payslip_lines_component_id_hr_salary_components_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."hr_salary_components"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_payslips" ADD CONSTRAINT "hr_payslips_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_payslips" ADD CONSTRAINT "hr_payslips_payroll_run_id_hr_payroll_runs_id_fk" FOREIGN KEY ("payroll_run_id") REFERENCES "public"."hr_payroll_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_payslips" ADD CONSTRAINT "hr_payslips_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_payslips" ADD CONSTRAINT "hr_payslips_compensation_id_hr_employee_compensations_id_fk" FOREIGN KEY ("compensation_id") REFERENCES "public"."hr_employee_compensations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_positions" ADD CONSTRAINT "hr_positions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_positions" ADD CONSTRAINT "hr_positions_job_title_id_hr_job_titles_id_fk" FOREIGN KEY ("job_title_id") REFERENCES "public"."hr_job_titles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_positions" ADD CONSTRAINT "hr_positions_org_unit_id_hr_org_units_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "public"."hr_org_units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_positions" ADD CONSTRAINT "hr_positions_job_grade_id_hr_job_grades_id_fk" FOREIGN KEY ("job_grade_id") REFERENCES "public"."hr_job_grades"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_positions" ADD CONSTRAINT "hr_positions_work_location_id_hr_work_locations_id_fk" FOREIGN KEY ("work_location_id") REFERENCES "public"."hr_work_locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_probation_policies" ADD CONSTRAINT "hr_probation_policies_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_salary_bands" ADD CONSTRAINT "hr_salary_bands_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_salary_bands" ADD CONSTRAINT "hr_salary_bands_grade_id_hr_job_grades_id_fk" FOREIGN KEY ("grade_id") REFERENCES "public"."hr_job_grades"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_salary_components" ADD CONSTRAINT "hr_salary_components_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_salary_structure_components" ADD CONSTRAINT "hr_salary_structure_components_structure_id_hr_salary_structures_id_fk" FOREIGN KEY ("structure_id") REFERENCES "public"."hr_salary_structures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_salary_structure_components" ADD CONSTRAINT "hr_salary_structure_components_component_id_hr_salary_components_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."hr_salary_components"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_salary_structures" ADD CONSTRAINT "hr_salary_structures_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_service_categories" ADD CONSTRAINT "hr_service_categories_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_services" ADD CONSTRAINT "hr_services_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_services" ADD CONSTRAINT "hr_services_form_id_form_definitions_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."form_definitions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_services" ADD CONSTRAINT "hr_services_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_shifts" ADD CONSTRAINT "hr_shifts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_work_calendars" ADD CONSTRAINT "hr_work_calendars_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_work_locations" ADD CONSTRAINT "hr_work_locations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_workspace_counters" ADD CONSTRAINT "hr_workspace_counters_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_workspace_settings" ADD CONSTRAINT "hr_workspace_settings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_users_emp_num_ws" ON "users" USING btree ("workspace_id","employee_number");--> statement-breakpoint
CREATE INDEX "idx_event_logs_workspace" ON "workspace_event_logs" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_event_logs_event_name" ON "workspace_event_logs" USING btree ("event_name");--> statement-breakpoint
CREATE INDEX "idx_event_logs_created_at" ON "workspace_event_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_event_logs_status" ON "workspace_event_logs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_wf_def_workspace" ON "workflow_definitions" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_wf_def_trigger" ON "workflow_definitions" USING btree ("trigger_event");--> statement-breakpoint
CREATE INDEX "idx_wf_def_key" ON "workflow_definitions" USING btree ("workspace_id","key");--> statement-breakpoint
CREATE INDEX "idx_wf_step_execution" ON "workflow_execution_steps" USING btree ("execution_id");--> statement-breakpoint
CREATE INDEX "idx_wf_step_status" ON "workflow_execution_steps" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_wf_exec_workspace" ON "workflow_executions" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_wf_exec_workflow" ON "workflow_executions" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "idx_wf_exec_status" ON "workflow_executions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_wf_exec_started" ON "workflow_executions" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "idx_wf_task_workspace" ON "workflow_tasks" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_wf_task_assignee" ON "workflow_tasks" USING btree ("assignee_id");--> statement-breakpoint
CREATE INDEX "idx_wf_task_status" ON "workflow_tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_form_definitions_workspace" ON "form_definitions" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_form_definitions_module" ON "form_definitions" USING btree ("module");--> statement-breakpoint
CREATE INDEX "idx_form_definitions_status" ON "form_definitions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_form_fields_form" ON "form_fields" USING btree ("form_id");--> statement-breakpoint
CREATE INDEX "idx_form_fields_order" ON "form_fields" USING btree ("form_id","display_order");--> statement-breakpoint
CREATE INDEX "idx_form_files_submission" ON "form_submission_files" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "idx_form_submissions_form" ON "form_submissions" USING btree ("form_id");--> statement-breakpoint
CREATE INDEX "idx_form_submissions_workspace" ON "form_submissions" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_form_submissions_submitter" ON "form_submissions" USING btree ("submitted_by_id");--> statement-breakpoint
CREATE INDEX "idx_form_submissions_status" ON "form_submissions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_employees_workspace" ON "employees" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_employees_user" ON "employees" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_employees_org_unit" ON "employees" USING btree ("org_unit_id");--> statement-breakpoint
CREATE INDEX "idx_employees_status" ON "employees" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_employees_manager" ON "employees" USING btree ("direct_manager_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_hr_employees_emp_num_ws" ON "employees" USING btree ("workspace_id","employee_number");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_hr_attendance_emp_date" ON "hr_attendance" USING btree ("employee_id","date");--> statement-breakpoint
CREATE INDEX "idx_hr_attendance_workspace" ON "hr_attendance" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_hr_attendance_date" ON "hr_attendance" USING btree ("date");--> statement-breakpoint
CREATE INDEX "idx_hr_attendance_status" ON "hr_attendance" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_hr_holidays_calendar" ON "hr_calendar_holidays" USING btree ("calendar_id");--> statement-breakpoint
CREATE INDEX "idx_hr_holidays_date" ON "hr_calendar_holidays" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_hr_contract_type_code" ON "hr_contract_types" USING btree ("workspace_id","code");--> statement-breakpoint
CREATE INDEX "idx_hr_contract_types_workspace" ON "hr_contract_types" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_hr_custom_field_defs_workspace" ON "hr_custom_field_defs" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_hr_custom_field_defs_section" ON "hr_custom_field_defs" USING btree ("section");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_hr_cfv_employee_field" ON "hr_custom_field_values" USING btree ("employee_id","field_def_id");--> statement-breakpoint
CREATE INDEX "idx_hr_cfv_employee" ON "hr_custom_field_values" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "idx_hr_doc_types_workspace" ON "hr_document_types" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_hr_activity_employee" ON "hr_employee_activity" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "idx_hr_activity_created" ON "hr_employee_activity" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_hr_emp_comp_item" ON "hr_employee_compensation_items" USING btree ("compensation_id","component_id");--> statement-breakpoint
CREATE INDEX "idx_hr_emp_comp_items_comp" ON "hr_employee_compensation_items" USING btree ("compensation_id");--> statement-breakpoint
CREATE INDEX "idx_hr_emp_comp_employee" ON "hr_employee_compensations" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "idx_hr_emp_comp_status" ON "hr_employee_compensations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_hr_contracts_employee" ON "hr_employee_contracts" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "idx_hr_contracts_workspace" ON "hr_employee_contracts" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_hr_docs_employee" ON "hr_employee_documents" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "idx_hr_docs_type" ON "hr_employee_documents" USING btree ("document_type");--> statement-breakpoint
CREATE INDEX "idx_hr_leaves_employee" ON "hr_employee_leaves" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "idx_hr_leaves_status" ON "hr_employee_leaves" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_hr_leaves_type" ON "hr_employee_leaves" USING btree ("leave_type");--> statement-breakpoint
CREATE INDEX "idx_hr_notes_employee" ON "hr_employee_notes" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "idx_hr_pos_history_employee" ON "hr_employee_position_history" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "idx_hr_pos_history_date" ON "hr_employee_position_history" USING btree ("effective_date");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_hr_emp_status_code" ON "hr_employee_statuses" USING btree ("workspace_id","code");--> statement-breakpoint
CREATE INDEX "idx_hr_emp_statuses_workspace" ON "hr_employee_statuses" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_hr_emp_type_code" ON "hr_employment_types" USING btree ("workspace_id","code");--> statement-breakpoint
CREATE INDEX "idx_hr_emp_types_workspace" ON "hr_employment_types" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_hr_job_grades_workspace" ON "hr_job_grades" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_hr_job_titles_workspace" ON "hr_job_titles" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_hr_leave_balance" ON "hr_leave_balances" USING btree ("employee_id","leave_policy_id","year");--> statement-breakpoint
CREATE INDEX "idx_hr_leave_balances_employee" ON "hr_leave_balances" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "idx_hr_leave_balances_year" ON "hr_leave_balances" USING btree ("year");--> statement-breakpoint
CREATE INDEX "idx_hr_leave_policies_workspace" ON "hr_leave_policies" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_hr_org_units_workspace" ON "hr_org_units" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_hr_org_units_parent" ON "hr_org_units" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "idx_hr_org_units_type" ON "hr_org_units" USING btree ("type");--> statement-breakpoint
CREATE INDEX "idx_hr_ot_policies_workspace" ON "hr_overtime_policies" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_hr_ot_policies_active" ON "hr_overtime_policies" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_hr_ot_records_workspace" ON "hr_overtime_records" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_hr_ot_records_employee" ON "hr_overtime_records" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "idx_hr_ot_records_date" ON "hr_overtime_records" USING btree ("date");--> statement-breakpoint
CREATE INDEX "idx_hr_ot_records_status" ON "hr_overtime_records" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_hr_payroll_run_period" ON "hr_payroll_runs" USING btree ("workspace_id","period_year","period_month");--> statement-breakpoint
CREATE INDEX "idx_hr_payroll_runs_workspace" ON "hr_payroll_runs" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_hr_payroll_runs_status" ON "hr_payroll_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_hr_payslip_lines_payslip" ON "hr_payslip_lines" USING btree ("payslip_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_hr_payslip" ON "hr_payslips" USING btree ("payroll_run_id","employee_id");--> statement-breakpoint
CREATE INDEX "idx_hr_payslips_run" ON "hr_payslips" USING btree ("payroll_run_id");--> statement-breakpoint
CREATE INDEX "idx_hr_payslips_employee" ON "hr_payslips" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "idx_hr_positions_workspace" ON "hr_positions" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_hr_positions_org_unit" ON "hr_positions" USING btree ("org_unit_id");--> statement-breakpoint
CREATE INDEX "idx_hr_positions_status" ON "hr_positions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_hr_positions_job_title" ON "hr_positions" USING btree ("job_title_id");--> statement-breakpoint
CREATE INDEX "idx_hr_probation_policies_workspace" ON "hr_probation_policies" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_hr_sal_bands_workspace" ON "hr_salary_bands" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_hr_sal_bands_grade" ON "hr_salary_bands" USING btree ("grade_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_hr_sal_comp_code" ON "hr_salary_components" USING btree ("workspace_id","code");--> statement-breakpoint
CREATE INDEX "idx_hr_sal_comp_workspace" ON "hr_salary_components" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_hr_struct_comp" ON "hr_salary_structure_components" USING btree ("structure_id","component_id");--> statement-breakpoint
CREATE INDEX "idx_hr_struct_comp_structure" ON "hr_salary_structure_components" USING btree ("structure_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_hr_sal_struct_code" ON "hr_salary_structures" USING btree ("workspace_id","code");--> statement-breakpoint
CREATE INDEX "idx_hr_sal_struct_workspace" ON "hr_salary_structures" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_hr_categories_workspace" ON "hr_service_categories" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_hr_services_workspace" ON "hr_services" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_hr_services_status" ON "hr_services" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_hr_services_category" ON "hr_services" USING btree ("category");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_hr_shift_code" ON "hr_shifts" USING btree ("workspace_id","code");--> statement-breakpoint
CREATE INDEX "idx_hr_shifts_workspace" ON "hr_shifts" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_hr_cal_code" ON "hr_work_calendars" USING btree ("workspace_id","code");--> statement-breakpoint
CREATE INDEX "idx_hr_work_calendars_workspace" ON "hr_work_calendars" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_hr_work_locations_workspace" ON "hr_work_locations" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_hr_work_locations_type" ON "hr_work_locations" USING btree ("type");