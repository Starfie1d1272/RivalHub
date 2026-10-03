CREATE TABLE "application_session_controls" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"revoked_before" timestamp with time zone DEFAULT 'epoch'::timestamptz NOT NULL,
	"password_mutation_id" uuid
);
--> statement-breakpoint
CREATE TABLE "application_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed New empty session control table; additive FK before application deployment.
ALTER TABLE "application_session_controls" ADD CONSTRAINT "application_session_controls_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed New empty session registry; additive FK before application deployment.
ALTER TABLE "application_sessions" ADD CONSTRAINT "application_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed Index on new empty session registry.
CREATE INDEX "application_sessions_user_idx" ON "application_sessions" USING btree ("user_id");--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "application_sessions", "application_session_controls" FROM anon, authenticated;
--> statement-breakpoint
ALTER TABLE "application_sessions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "application_session_controls" ENABLE ROW LEVEL SECURITY;
