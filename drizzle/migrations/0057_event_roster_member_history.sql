ALTER TABLE "event_roster_members" DROP CONSTRAINT "event_roster_members_roster_user_unique";--> statement-breakpoint
ALTER TABLE "event_roster_members" DROP CONSTRAINT "event_roster_members_participant_unique";--> statement-breakpoint
ALTER TABLE "event_roster_members" ADD COLUMN "is_current" boolean DEFAULT true NOT NULL;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed Existing roster uniqueness guarantees the partial current-member indexes will validate without collisions; the roster-member relation is expected to remain small.
CREATE UNIQUE INDEX "event_roster_members_roster_user_current_unique" ON "event_roster_members" USING btree ("event_roster_id","user_id") WHERE "event_roster_members"."is_current";--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed Existing roster uniqueness guarantees the partial current-member indexes will validate without collisions; the roster-member relation is expected to remain small.
CREATE UNIQUE INDEX "event_roster_members_participant_current_unique" ON "event_roster_members" USING btree ("event_roster_id","participant_id") WHERE "event_roster_members"."is_current";
