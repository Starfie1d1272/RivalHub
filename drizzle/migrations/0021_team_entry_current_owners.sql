-- Team / CompetitionEntry stable convergence. The old projection tables and
-- numeric roster pointers stay in place until every fact below has been
-- validated and backfilled.
LOCK TABLE "teams", "team_memberships", "team_captain_tenures", "team_name_history",
  "team_invitations", "competition_entries", "competition_entry_participants",
  "competition_entry_active_claims", "competition_entry_roster_revisions",
  "competition_entry_submissions", "competition_entry_representative_tenures",
  "competition_entry_legacy_identities", "event_rosters" IN ACCESS EXCLUSIVE MODE;--> statement-breakpoint

CREATE TABLE "team_captain_changes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "team_id" uuid NOT NULL,
  "from_user_id" uuid,
  "to_user_id" uuid NOT NULL,
  "changed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "changed_by_actor_id" text NOT NULL,
  CONSTRAINT "team_captain_changes_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "team_captain_changes_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "team_captain_changes_to_user_id_users_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action
);--> statement-breakpoint
CREATE TABLE "team_name_changes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "team_id" uuid NOT NULL,
  "old_name" text,
  "new_name" text NOT NULL,
  "changed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "changed_by_actor_id" text NOT NULL,
  CONSTRAINT "team_name_changes_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action
);--> statement-breakpoint
CREATE TABLE "competition_entry_representative_changes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "entry_id" uuid NOT NULL,
  "from_user_id" uuid,
  "to_user_id" uuid NOT NULL,
  "changed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "changed_by_actor_id" text NOT NULL,
  CONSTRAINT "competition_entry_representative_changes_entry_id_competition_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."competition_entries"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "competition_entry_representative_changes_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "competition_entry_representative_changes_to_user_id_users_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action
);--> statement-breakpoint

ALTER TABLE "competition_entries" ADD COLUMN "current_roster_revision_id" uuid;--> statement-breakpoint
ALTER TABLE "competition_entries" ADD COLUMN "approved_roster_revision_id" uuid;--> statement-breakpoint
ALTER TABLE "event_rosters" ADD COLUMN "confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event_rosters" ADD COLUMN "confirmed_by" text;--> statement-breakpoint
ALTER TABLE "competition_entry_roster_revisions" RENAME COLUMN "revision" TO "revision_number";--> statement-breakpoint

-- The old role projection is no longer an authority. Validate the facts that
-- are needed to remove it before the column and enum disappear.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM team_memberships
    WHERE ended_at IS NULL
    GROUP BY user_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'team-entry migration cannot collapse multiple current Team memberships for one user' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM teams team
    WHERE team.status = 'active'
      AND NOT EXISTS (
        SELECT 1 FROM team_memberships membership
        WHERE membership.team_id = team.id
          AND membership.user_id = team.captain_user_id
          AND membership.status = 'active'
          AND membership.ended_at IS NULL
      )
  ) THEN
    RAISE EXCEPTION 'team-entry migration found an active Team without its current active captain membership' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM teams team
    WHERE NOT EXISTS (
      SELECT 1 FROM team_captain_tenures tenure
      WHERE tenure.team_id = team.id
        AND tenure.started_at = (SELECT max(previous.started_at) FROM team_captain_tenures previous WHERE previous.team_id = team.id)
        AND tenure.user_id = team.captain_user_id
    )
  ) THEN
    RAISE EXCEPTION 'team-entry migration found a Team whose captain pointer is not represented by the latest captain tenure' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (SELECT 1 FROM team_captain_tenures WHERE transferred_by IS NULL) THEN
    RAISE EXCEPTION 'team-entry migration cannot backfill a captain change without an actor' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM team_name_history WHERE changed_by IS NULL) THEN
    RAISE EXCEPTION 'team-entry migration cannot backfill a name change without an actor' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM competition_entry_representative_tenures WHERE transferred_by IS NULL) THEN
    RAISE EXCEPTION 'team-entry migration cannot backfill a representative change without an actor' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM teams team
    WHERE NOT EXISTS (SELECT 1 FROM team_name_history history WHERE history.team_id = team.id)
  ) THEN
    RAISE EXCEPTION 'team-entry migration found a Team without name history' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM teams team
    WHERE NOT EXISTS (
      SELECT 1 FROM team_name_history history
      WHERE history.team_id = team.id
        AND history.started_at = (SELECT max(previous.started_at) FROM team_name_history previous WHERE previous.team_id = team.id)
        AND history.name = team.name
    )
  ) THEN
    RAISE EXCEPTION 'team-entry migration found a Team whose name is not represented by the latest name history' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM competition_entries entry
    WHERE NOT EXISTS (
      SELECT 1 FROM competition_entry_representative_tenures history
      WHERE history.entry_id = entry.id
        AND history.started_at = (SELECT max(previous.started_at) FROM competition_entry_representative_tenures previous WHERE previous.entry_id = entry.id)
        AND history.user_id = entry.representative_user_id
    )
  ) THEN
    RAISE EXCEPTION 'team-entry migration found an Entry whose representative is not represented by the latest representative tenure' USING ERRCODE = '23514';
  END IF;
END $$;--> statement-breakpoint

INSERT INTO team_captain_changes (id, team_id, from_user_id, to_user_id, changed_at, changed_by_actor_id)
SELECT id, team_id,
  lag(user_id) OVER (PARTITION BY team_id ORDER BY started_at, id),
  user_id, started_at, transferred_by
FROM team_captain_tenures;--> statement-breakpoint
INSERT INTO team_name_changes (id, team_id, old_name, new_name, changed_at, changed_by_actor_id)
SELECT id, team_id,
  lag(name) OVER (PARTITION BY team_id ORDER BY started_at, id),
  name, started_at, changed_by
FROM team_name_history;--> statement-breakpoint
INSERT INTO competition_entry_representative_changes (id, entry_id, from_user_id, to_user_id, changed_at, changed_by_actor_id)
SELECT id, entry_id,
  lag(user_id) OVER (PARTITION BY entry_id ORDER BY started_at, id),
  user_id, started_at, transferred_by
FROM competition_entry_representative_tenures;--> statement-breakpoint

-- Legacy source columns are migration provenance only. Preserve every
-- complete pair in the dedicated identity table and refuse ambiguous data.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM competition_entries
    WHERE (legacy_source_type IS NULL) <> (legacy_source_id IS NULL)
  ) THEN
    RAISE EXCEPTION 'team-entry migration found a partial legacy identity pair' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT legacy_source_type, legacy_source_id
    FROM competition_entries
    WHERE legacy_source_type IS NOT NULL
    GROUP BY legacy_source_type, legacy_source_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'team-entry migration found duplicate legacy identity provenance' USING ERRCODE = '23505';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM competition_entries entry
    JOIN competition_entry_legacy_identities identity_fact
      ON identity_fact.legacy_type = entry.legacy_source_type
     AND identity_fact.legacy_id = entry.legacy_source_id
     AND identity_fact.entry_id <> entry.id
    WHERE entry.legacy_source_type IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'team-entry migration found conflicting legacy identity provenance' USING ERRCODE = '23505';
  END IF;
END $$;--> statement-breakpoint
INSERT INTO competition_entry_legacy_identities (entry_id, legacy_type, legacy_id)
SELECT entry.id, entry.legacy_source_type, entry.legacy_source_id
FROM competition_entries entry
WHERE entry.legacy_source_type IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM competition_entry_legacy_identities identity_fact
    WHERE identity_fact.legacy_type = entry.legacy_source_type
      AND identity_fact.legacy_id = entry.legacy_source_id
  );--> statement-breakpoint

-- Convert the numeric pointer only through the unique (entry, number) key.
-- Missing or ambiguous mappings stop the migration before the old columns are
-- removed.
DO $$
BEGIN
  IF EXISTS (
    SELECT entry.id
    FROM competition_entries entry
    LEFT JOIN competition_entry_roster_revisions revision
      ON revision.entry_id = entry.id
     AND revision.revision_number = entry.current_roster_revision
    GROUP BY entry.id
    HAVING count(revision.id) <> 1
  ) THEN
    RAISE EXCEPTION 'team-entry migration found a missing or ambiguous current roster revision' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM competition_entries entry
    LEFT JOIN competition_entry_roster_revisions revision
      ON revision.entry_id = entry.id
     AND revision.revision_number = entry.approved_roster_revision
    WHERE entry.approved_roster_revision IS NOT NULL
      AND (revision.id IS NULL OR revision.status <> 'approved')
  ) THEN
    RAISE EXCEPTION 'team-entry migration found an approved roster revision that is missing or not approved' USING ERRCODE = '23514';
  END IF;
END $$;--> statement-breakpoint
UPDATE competition_entries entry
SET current_roster_revision_id = revision.id
FROM competition_entry_roster_revisions revision
WHERE revision.entry_id = entry.id
  AND revision.revision_number = entry.current_roster_revision;--> statement-breakpoint
UPDATE competition_entries entry
SET approved_roster_revision_id = revision.id
FROM competition_entry_roster_revisions revision
WHERE entry.approved_roster_revision IS NOT NULL
  AND revision.entry_id = entry.id
  AND revision.revision_number = entry.approved_roster_revision;--> statement-breakpoint

-- Accepted/declined responses must name the responder. A direct invitation
-- identifies the only valid responder; a share-link response without an actor
-- is irrecoverably ambiguous and therefore fails closed. Non-response states
-- are normalized to the required NULL shape.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM team_invitations
    WHERE status IN ('accepted', 'declined')
      AND responded_at IS NULL
  ) THEN
    RAISE EXCEPTION 'team-entry migration found an accepted or declined invitation without a response timestamp' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM team_invitations
    WHERE status IN ('accepted', 'declined')
      AND responded_by_user_id IS NULL
      AND invited_user_id IS NULL
  ) THEN
    RAISE EXCEPTION 'team-entry migration cannot infer the responder for a share-link invitation' USING ERRCODE = '23514';
  END IF;
END $$;--> statement-breakpoint
UPDATE team_invitations
SET responded_by_user_id = invited_user_id
WHERE status IN ('accepted', 'declined')
  AND responded_by_user_id IS NULL;--> statement-breakpoint
UPDATE team_invitations
SET responded_at = NULL, responded_by_user_id = NULL
WHERE status IN ('pending', 'revoked', 'expired');--> statement-breakpoint

-- Old frozen rows already contain the exact freeze actor/time, so those facts
-- also establish the confirmation boundary. A legacy confirmed row has no
-- equivalent actor/time and cannot be guessed.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM event_rosters
    WHERE status = 'frozen'
      AND (frozen_at IS NULL OR frozen_by IS NULL)
  ) THEN
    RAISE EXCEPTION 'team-entry migration found a frozen EventRoster without complete freeze metadata' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM event_rosters WHERE status = 'confirmed') THEN
    RAISE EXCEPTION 'team-entry migration cannot infer confirmation metadata for a legacy confirmed EventRoster' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM event_rosters
    WHERE status = 'preparing'
      AND (frozen_at IS NOT NULL OR frozen_by IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'team-entry migration found preparing EventRoster freeze metadata' USING ERRCODE = '23514';
  END IF;
END $$;--> statement-breakpoint
UPDATE event_rosters
SET confirmed_at = frozen_at, confirmed_by = frozen_by
WHERE status = 'frozen';--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM competition_entries
    WHERE current_roster_revision_id IS NULL
  ) THEN
    RAISE EXCEPTION 'team-entry migration could not backfill every current roster revision pointer' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM event_rosters roster
    JOIN competition_entries entry ON entry.id = roster.entry_id
    WHERE roster.status IN ('confirmed', 'frozen')
      AND (entry.approved_roster_revision_id IS NULL OR roster.source_roster_revision_id IS DISTINCT FROM entry.approved_roster_revision_id)
  ) THEN
    RAISE EXCEPTION 'team-entry migration found a confirmed or frozen EventRoster whose source is not the approved Entry revision' USING ERRCODE = '23514';
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "competition_entry_roster_revisions" DROP CONSTRAINT "competition_entry_roster_revisions_entry_revision_unique";--> statement-breakpoint
ALTER TABLE "competition_entries" DROP CONSTRAINT "competition_entries_revision_shape_check";--> statement-breakpoint
ALTER TABLE "event_rosters" DROP CONSTRAINT "event_rosters_freeze_shape_check";--> statement-breakpoint
ALTER TABLE "team_memberships" DROP CONSTRAINT "team_memberships_captain_must_be_active_check";--> statement-breakpoint
DROP INDEX "competition_entries_legacy_source_unique";--> statement-breakpoint
DROP INDEX "team_memberships_one_active_team_per_user";--> statement-breakpoint
DROP INDEX "team_memberships_one_current_captain_per_team";--> statement-breakpoint
DROP INDEX "team_memberships_one_current_captaincy_per_user";--> statement-breakpoint

ALTER TABLE "competition_entries" DROP COLUMN "current_roster_revision";--> statement-breakpoint
ALTER TABLE "competition_entries" DROP COLUMN "approved_roster_revision";--> statement-breakpoint
ALTER TABLE "competition_entries" DROP COLUMN "legacy_source_type";--> statement-breakpoint
ALTER TABLE "competition_entries" DROP COLUMN "legacy_source_id";--> statement-breakpoint
ALTER TABLE "event_rosters" DROP COLUMN "policy_snapshot";--> statement-breakpoint
ALTER TABLE "team_memberships" DROP COLUMN "role";--> statement-breakpoint
ALTER TABLE "competition_entries" ALTER COLUMN "current_roster_revision_id" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "competition_entries" ADD CONSTRAINT "competition_entries_id_competition_id_unique" UNIQUE ("id", "competition_id");--> statement-breakpoint
ALTER TABLE "competition_entry_participants" ADD CONSTRAINT "competition_entry_participants_id_entry_user_unique" UNIQUE ("id", "entry_id", "user_id");--> statement-breakpoint
ALTER TABLE "competition_entry_roster_revisions" ADD CONSTRAINT "competition_entry_roster_revisions_entry_revision_number_unique" UNIQUE ("entry_id", "revision_number");--> statement-breakpoint
ALTER TABLE "competition_entry_roster_revisions" ADD CONSTRAINT "competition_entry_roster_revisions_id_entry_id_unique" UNIQUE ("id", "entry_id");--> statement-breakpoint
ALTER TABLE "competition_entries" ADD CONSTRAINT "competition_entries_current_roster_revision_scope_fk" FOREIGN KEY ("current_roster_revision_id", "id") REFERENCES "public"."competition_entry_roster_revisions"("id", "entry_id") DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "competition_entries" ADD CONSTRAINT "competition_entries_approved_roster_revision_scope_fk" FOREIGN KEY ("approved_roster_revision_id", "id") REFERENCES "public"."competition_entry_roster_revisions"("id", "entry_id") DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "competition_entry_active_claims" ADD CONSTRAINT "competition_entry_active_claims_entry_competition_scope_fk" FOREIGN KEY ("entry_id", "competition_id") REFERENCES "public"."competition_entries"("id", "competition_id");--> statement-breakpoint
ALTER TABLE "competition_entry_active_claims" ADD CONSTRAINT "competition_entry_active_claims_participant_scope_fk" FOREIGN KEY ("participant_id", "entry_id", "user_id") REFERENCES "public"."competition_entry_participants"("id", "entry_id", "user_id");--> statement-breakpoint
ALTER TABLE "competition_entry_submissions" ADD CONSTRAINT "competition_entry_submissions_roster_revision_entry_scope_fk" FOREIGN KEY ("roster_revision_id", "entry_id") REFERENCES "public"."competition_entry_roster_revisions"("id", "entry_id");--> statement-breakpoint
ALTER TABLE "event_rosters" ADD CONSTRAINT "event_rosters_source_roster_revision_entry_scope_fk" FOREIGN KEY ("source_roster_revision_id", "entry_id") REFERENCES "public"."competition_entry_roster_revisions"("id", "entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "team_memberships_one_current_team_per_user" ON "team_memberships" USING btree ("user_id") WHERE "team_memberships"."ended_at" IS NULL;--> statement-breakpoint

ALTER TABLE "event_rosters" ADD CONSTRAINT "event_rosters_freeze_shape_check" CHECK (
  ("event_rosters"."status" = 'preparing' AND "event_rosters"."confirmed_at" IS NULL AND "event_rosters"."confirmed_by" IS NULL AND "event_rosters"."frozen_at" IS NULL AND "event_rosters"."frozen_by" IS NULL)
  OR ("event_rosters"."status" = 'confirmed' AND "event_rosters"."confirmed_at" IS NOT NULL AND "event_rosters"."confirmed_by" IS NOT NULL AND "event_rosters"."frozen_at" IS NULL AND "event_rosters"."frozen_by" IS NULL)
  OR ("event_rosters"."status" = 'frozen' AND "event_rosters"."confirmed_at" IS NOT NULL AND "event_rosters"."confirmed_by" IS NOT NULL AND "event_rosters"."frozen_at" IS NOT NULL AND "event_rosters"."frozen_by" IS NOT NULL)
);--> statement-breakpoint
ALTER TABLE "team_invitations" ADD CONSTRAINT "team_invitations_response_shape_check" CHECK (
  ("team_invitations"."status" IN ('accepted', 'declined') AND "team_invitations"."responded_at" IS NOT NULL AND "team_invitations"."responded_by_user_id" IS NOT NULL)
  OR ("team_invitations"."status" IN ('pending', 'revoked', 'expired') AND "team_invitations"."responded_at" IS NULL AND "team_invitations"."responded_by_user_id" IS NULL)
);--> statement-breakpoint

-- These checks are deferred so create/transfer/approve commands can update
-- the pointer and its append-only fact in one transaction.
CREATE OR REPLACE FUNCTION "public"."rivalhub_assert_team_current_state"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  affected_team_id uuid;
  team_row record;
  latest_captain record;
  latest_name record;
  previous_captain record;
  previous_name record;
BEGIN
  IF TG_TABLE_NAME = 'teams' THEN
    affected_team_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  ELSIF TG_TABLE_NAME IN ('team_memberships', 'team_captain_changes', 'team_name_changes') THEN
    affected_team_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.team_id ELSE NEW.team_id END;
  END IF;

  SELECT * INTO team_row FROM teams WHERE id = affected_team_id;
  IF NOT FOUND THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  SELECT * INTO latest_captain
  FROM team_captain_changes
  WHERE team_id = affected_team_id
  ORDER BY changed_at DESC, id DESC
  LIMIT 1;
  IF latest_captain IS NULL OR latest_captain.to_user_id <> team_row.captain_user_id THEN
    RAISE EXCEPTION 'Team captain pointer must match the latest captain change' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO latest_name
  FROM team_name_changes
  WHERE team_id = affected_team_id
  ORDER BY changed_at DESC, id DESC
  LIMIT 1;
  IF latest_name IS NULL OR latest_name.new_name <> team_row.name THEN
    RAISE EXCEPTION 'Team name must match the latest name change' USING ERRCODE = '23514';
  END IF;

  IF team_row.status = 'active' AND NOT EXISTS (
    SELECT 1 FROM team_memberships membership
    WHERE membership.team_id = affected_team_id
      AND membership.user_id = team_row.captain_user_id
      AND membership.status = 'active'
      AND membership.ended_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Active Team captain must have an active current membership' USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT' AND TG_TABLE_NAME = 'team_captain_changes' THEN
    SELECT * INTO previous_captain
    FROM team_captain_changes
    WHERE team_id = NEW.team_id
      AND (changed_at, id) < (NEW.changed_at, NEW.id)
    ORDER BY changed_at DESC, id DESC
    LIMIT 1;
    IF (previous_captain IS NULL AND NEW.from_user_id IS NOT NULL)
      OR (previous_captain IS NOT NULL AND NEW.from_user_id IS DISTINCT FROM previous_captain.to_user_id) THEN
      RAISE EXCEPTION 'Captain change from_user_id must continue the append-only chain' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_OP = 'INSERT' AND TG_TABLE_NAME = 'team_name_changes' THEN
    SELECT * INTO previous_name
    FROM team_name_changes
    WHERE team_id = NEW.team_id
      AND (changed_at, id) < (NEW.changed_at, NEW.id)
    ORDER BY changed_at DESC, id DESC
    LIMIT 1;
    IF (previous_name IS NULL AND NEW.old_name IS NOT NULL)
      OR (previous_name IS NOT NULL AND NEW.old_name IS DISTINCT FROM previous_name.new_name) THEN
      RAISE EXCEPTION 'Name change old_name must continue the append-only chain' USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "teams_current_state_integrity"
AFTER INSERT OR UPDATE OR DELETE ON "teams"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION "public"."rivalhub_assert_team_current_state"();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "team_memberships_current_state_integrity"
AFTER INSERT OR UPDATE OR DELETE ON "team_memberships"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION "public"."rivalhub_assert_team_current_state"();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "team_captain_changes_current_state_integrity"
AFTER INSERT ON "team_captain_changes"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION "public"."rivalhub_assert_team_current_state"();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "team_name_changes_current_state_integrity"
AFTER INSERT ON "team_name_changes"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION "public"."rivalhub_assert_team_current_state"();--> statement-breakpoint

CREATE OR REPLACE FUNCTION "public"."rivalhub_assert_team_entry_history_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '23514';
END $$;--> statement-breakpoint
CREATE TRIGGER "team_captain_changes_append_only"
BEFORE UPDATE OR DELETE ON "team_captain_changes"
FOR EACH ROW EXECUTE FUNCTION "public"."rivalhub_assert_team_entry_history_append_only"();--> statement-breakpoint
CREATE TRIGGER "team_name_changes_append_only"
BEFORE UPDATE OR DELETE ON "team_name_changes"
FOR EACH ROW EXECUTE FUNCTION "public"."rivalhub_assert_team_entry_history_append_only"();--> statement-breakpoint
CREATE TRIGGER "competition_entry_representative_changes_append_only"
BEFORE UPDATE OR DELETE ON "competition_entry_representative_changes"
FOR EACH ROW EXECUTE FUNCTION "public"."rivalhub_assert_team_entry_history_append_only"();--> statement-breakpoint

CREATE OR REPLACE FUNCTION "public"."rivalhub_assert_competition_entry_current_state"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  affected_entry_id uuid;
  entry_row record;
  current_revision record;
  approved_revision record;
  latest_representative record;
  previous_representative record;
BEGIN
  IF TG_TABLE_NAME = 'competition_entries' THEN
    affected_entry_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  ELSIF TG_TABLE_NAME IN ('competition_entry_roster_revisions', 'competition_entry_representative_changes') THEN
    affected_entry_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.entry_id ELSE NEW.entry_id END;
  END IF;

  SELECT * INTO entry_row FROM competition_entries WHERE id = affected_entry_id;
  IF NOT FOUND THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  SELECT * INTO current_revision
  FROM competition_entry_roster_revisions
  WHERE id = entry_row.current_roster_revision_id
    AND entry_id = affected_entry_id;
  IF current_revision IS NULL OR current_revision.revision_number <> (
    SELECT max(revision_number) FROM competition_entry_roster_revisions WHERE entry_id = affected_entry_id
  ) THEN
    RAISE EXCEPTION 'CompetitionEntry current roster pointer must target its latest revision' USING ERRCODE = '23514';
  END IF;

  IF entry_row.approved_roster_revision_id IS NOT NULL THEN
    SELECT * INTO approved_revision
    FROM competition_entry_roster_revisions
    WHERE id = entry_row.approved_roster_revision_id
      AND entry_id = affected_entry_id;
    IF approved_revision IS NULL OR approved_revision.status <> 'approved' THEN
      RAISE EXCEPTION 'CompetitionEntry approved roster pointer must target an approved revision in the same Entry' USING ERRCODE = '23514';
    END IF;
  END IF;

  SELECT * INTO latest_representative
  FROM competition_entry_representative_changes
  WHERE entry_id = affected_entry_id
  ORDER BY changed_at DESC, id DESC
  LIMIT 1;
  IF latest_representative IS NULL OR latest_representative.to_user_id <> entry_row.representative_user_id THEN
    RAISE EXCEPTION 'CompetitionEntry representative pointer must match the latest representative change' USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT' AND TG_TABLE_NAME = 'competition_entry_representative_changes' THEN
    SELECT * INTO previous_representative
    FROM competition_entry_representative_changes
    WHERE entry_id = NEW.entry_id
      AND (changed_at, id) < (NEW.changed_at, NEW.id)
    ORDER BY changed_at DESC, id DESC
    LIMIT 1;
    IF (previous_representative IS NULL AND NEW.from_user_id IS NOT NULL)
      OR (previous_representative IS NOT NULL AND NEW.from_user_id IS DISTINCT FROM previous_representative.to_user_id) THEN
      RAISE EXCEPTION 'Representative change from_user_id must continue the append-only chain' USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "competition_entries_current_state_integrity"
AFTER INSERT OR UPDATE OR DELETE ON "competition_entries"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION "public"."rivalhub_assert_competition_entry_current_state"();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "competition_entry_roster_revisions_current_state_integrity"
AFTER INSERT OR UPDATE OR DELETE ON "competition_entry_roster_revisions"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION "public"."rivalhub_assert_competition_entry_current_state"();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "competition_entry_representative_changes_current_state_integrity"
AFTER INSERT ON "competition_entry_representative_changes"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION "public"."rivalhub_assert_competition_entry_current_state"();--> statement-breakpoint

CREATE OR REPLACE FUNCTION "public"."rivalhub_assert_event_roster_approved_source"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  affected_entry_id uuid;
  roster record;
BEGIN
  IF TG_TABLE_NAME = 'event_rosters' THEN
    affected_entry_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.entry_id ELSE NEW.entry_id END;
  ELSIF TG_TABLE_NAME = 'competition_entries' THEN
    affected_entry_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  ELSE
    affected_entry_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.entry_id ELSE NEW.entry_id END;
  END IF;

  FOR roster IN SELECT * FROM event_rosters WHERE entry_id = affected_entry_id LOOP
    IF roster.status IN ('confirmed', 'frozen') THEN
      IF roster.source_roster_revision_id IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM competition_entries entry
          WHERE entry.id = affected_entry_id
            AND entry.approved_roster_revision_id = roster.source_roster_revision_id
        )
        OR NOT EXISTS (
          SELECT 1 FROM competition_entry_roster_revisions revision
          WHERE revision.id = roster.source_roster_revision_id
            AND revision.entry_id = affected_entry_id
            AND revision.status = 'approved'
        ) THEN
        RAISE EXCEPTION 'Confirmed or frozen EventRoster must source the approved Entry roster revision' USING ERRCODE = '23514';
      END IF;
    END IF;
  END LOOP;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "event_rosters_approved_source_integrity"
AFTER INSERT OR UPDATE OR DELETE ON "event_rosters"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION "public"."rivalhub_assert_event_roster_approved_source"();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "competition_entries_event_roster_source_integrity"
AFTER INSERT OR UPDATE OR DELETE ON "competition_entries"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION "public"."rivalhub_assert_event_roster_approved_source"();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "competition_entry_revisions_event_roster_source_integrity"
AFTER INSERT OR UPDATE OR DELETE ON "competition_entry_roster_revisions"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION "public"."rivalhub_assert_event_roster_approved_source"();--> statement-breakpoint

ALTER TABLE "team_captain_changes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "team_name_changes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "competition_entry_representative_changes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "team_captain_changes", "team_name_changes", "competition_entry_representative_changes" FROM anon, authenticated;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."rivalhub_assert_team_current_state"() FROM PUBLIC, anon, authenticated;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."rivalhub_assert_team_entry_history_append_only"() FROM PUBLIC, anon, authenticated;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."rivalhub_assert_competition_entry_current_state"() FROM PUBLIC, anon, authenticated;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."rivalhub_assert_event_roster_approved_source"() FROM PUBLIC, anon, authenticated;--> statement-breakpoint

DROP TABLE "team_captain_tenures";--> statement-breakpoint
DROP TABLE "team_name_history";--> statement-breakpoint
DROP TABLE "competition_entry_representative_tenures";--> statement-breakpoint
DROP TYPE "public"."team_membership_role";
