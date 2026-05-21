CREATE TABLE "leave_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"requested_by_user_id" integer NOT NULL,
	"leave_policy_id" integer,
	"leave_type" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"days_requested" integer NOT NULL,
	"business_days_count" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"employee_note" text,
	"manager_note" text,
	"attachment_urls" jsonb,
	"current_approver_id" integer,
	"approved_by_user_id" integer,
	"approved_at" timestamp with time zone,
	"rejected_by_user_id" integer,
	"rejected_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"request_number" text NOT NULL,
	"source_form_id" integer,
	"source_submission_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_approval_steps" (
	"id" serial PRIMARY KEY NOT NULL,
	"leave_request_id" integer NOT NULL,
	"step_order" integer NOT NULL,
	"approver_user_id" integer NOT NULL,
	"approver_role" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"comment" text,
	"decided_at" timestamp with time zone,
	"notified_at" timestamp with time zone,
	"timeout_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_leave_policy_id_hr_leave_policies_id_fk" FOREIGN KEY ("leave_policy_id") REFERENCES "public"."hr_leave_policies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_current_approver_id_users_id_fk" FOREIGN KEY ("current_approver_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_rejected_by_user_id_users_id_fk" FOREIGN KEY ("rejected_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_approval_steps" ADD CONSTRAINT "leave_approval_steps_leave_request_id_leave_requests_id_fk" FOREIGN KEY ("leave_request_id") REFERENCES "public"."leave_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_approval_steps" ADD CONSTRAINT "leave_approval_steps_approver_user_id_users_id_fk" FOREIGN KEY ("approver_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_leave_requests_workspace" ON "leave_requests" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_leave_requests_employee" ON "leave_requests" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "idx_leave_requests_status" ON "leave_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_leave_requests_dates" ON "leave_requests" USING btree ("start_date","end_date");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_leave_request_number" ON "leave_requests" USING btree ("workspace_id","request_number");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_leave_approval_step" ON "leave_approval_steps" USING btree ("leave_request_id","step_order");--> statement-breakpoint
CREATE INDEX "idx_leave_approval_steps_request" ON "leave_approval_steps" USING btree ("leave_request_id");--> statement-breakpoint
CREATE INDEX "idx_leave_approval_steps_approver" ON "leave_approval_steps" USING btree ("approver_user_id");--> statement-breakpoint
CREATE INDEX "idx_leave_approval_steps_status" ON "leave_approval_steps" USING btree ("status");
