import { Pool } from "pg";
import { EDUCATION_EVIDENCE_RETENTION_MS } from "../../../src/lib/education/retention-policy";
import { assertIsolatedRecoveryDatabaseUrl } from "./environment";
import {
  assertActiveChainPrefix,
  readExpectedMigrations,
  type ExpectedMigration,
  type Migration,
} from "../production-preflight";
import type { RecoveryMigrationIdentity } from "./manifest";

const CRITICAL_TABLES = [
  "users",
  "user_identities",
  "seasons",
  "competition_entries",
  "competition_entry_participants",
  "competition_entry_roster_revisions",
  "event_rosters",
  "matches",
  "match_maps",
  "match_player_stats",
  "audit_logs",
] as const;

export interface RecoveryVerificationResult {
  migrationTag: string;
  invariantCount: number;
  foreignKeyCount: number;
}

export async function verifyRecoveryDatabase(
  pool: Pick<Pool, "query">,
  options: { expectedMigration?: RecoveryMigrationIdentity; now?: Date; skipExpiredSensitiveEvidence?: boolean } = {},
): Promise<RecoveryVerificationResult> {
  const migrationTag = await verifyMigrationTerminal(pool, options.expectedMigration);
  await verifyCriticalTables(pool);
  await verifyValidatedConstraints(pool);
  const foreignKeyCount = await verifyForeignKeys(pool);

  const invariants = options.skipExpiredSensitiveEvidence
    ? RECOVERY_INVARIANTS.filter((invariant) => invariant.key !== "education.expired_sensitive_evidence")
    : RECOVERY_INVARIANTS;
  for (const invariant of invariants) {
    await assertZero(pool, invariant.key, invariant.query, invariant.parameters?.(options.now ?? new Date()));
  }

  return {
    migrationTag,
    invariantCount: invariants.length,
    foreignKeyCount,
  };
}

export function assertManifestMigrationMatches(
  actual: readonly Migration[],
  expected: readonly ExpectedMigration[],
  manifest: RecoveryMigrationIdentity,
): void {
  assertActiveChainPrefix(actual, expected);
  const terminalIndex = expected.findIndex((entry) => entry.tag === manifest.terminalTag);
  const terminal = actual.at(-1);
  if (
    terminalIndex < 0
    || actual.length !== terminalIndex + 1
    || !terminal
    || terminal.hash !== manifest.terminalHash
    || terminal.when !== manifest.terminalWhen
  ) {
    throw new Error("Restored migration ledger does not match the backup manifest; restore aborted. ");
  }
}

async function verifyMigrationTerminal(
  pool: Pick<Pool, "query">,
  expectedMigration?: RecoveryMigrationIdentity,
): Promise<string> {
  const expected = readExpectedMigrations();
  const result = await pool.query<Migration>(
    "SELECT hash, created_at::bigint::text AS when FROM drizzle.__drizzle_migrations ORDER BY created_at",
  );
  const actual = result.rows.map((row) => ({ hash: row.hash, when: Number(row.when) }));
  if (expectedMigration) {
    assertManifestMigrationMatches(actual, expected, expectedMigration);
  } else {
    assertActiveChainPrefix(actual, expected);
    if (!actual.length) throw new Error("Restored migration ledger is empty; recovery verification failed. ");
  }
  const terminal = actual.at(-1);
  const terminalEntry = expected.find((entry) => entry.hash === terminal?.hash && entry.when === terminal.when);
  if (!terminalEntry) throw new Error("Restored migration terminal is not part of the active chain. ");
  return terminalEntry.tag;
}

async function verifyCriticalTables(pool: Pick<Pool, "query">): Promise<void> {
  const result = await pool.query<{ table_name: string | null }>(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
    [CRITICAL_TABLES],
  );
  const present = new Set(result.rows.map((row) => row.table_name));
  const missing = CRITICAL_TABLES.filter((table) => !present.has(table));
  if (missing.length) throw new Error(`Restored critical tables missing: ${missing.join(", ")}.`);
}

async function verifyValidatedConstraints(pool: Pick<Pool, "query">): Promise<void> {
  const result = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count
     FROM pg_constraint c
     JOIN pg_namespace n ON n.oid = c.connamespace
     WHERE n.nspname IN ('public', 'auth', 'storage')
       AND c.contype IN ('f', 'u', 'p', 'c')
       AND NOT c.convalidated`,
  );
  if (Number(result.rows[0]?.count ?? 0) !== 0) {
    throw new Error("Restored database contains an unvalidated critical constraint.");
  }
}

async function verifyForeignKeys(pool: Pick<Pool, "query">): Promise<number> {
  const constraints = await pool.query<ForeignKeyDefinition>(`
    SELECT
      c.conname,
      child_ns.nspname AS child_schema,
      child_rel.relname AS child_table,
      parent_ns.nspname AS parent_schema,
      parent_rel.relname AS parent_table,
      json_agg(
        json_build_object('child', child_att.attname, 'parent', parent_att.attname)
        ORDER BY child_key.ordinality
      ) AS columns
    FROM pg_constraint c
    JOIN pg_class child_rel ON child_rel.oid = c.conrelid
    JOIN pg_namespace child_ns ON child_ns.oid = child_rel.relnamespace
    JOIN pg_class parent_rel ON parent_rel.oid = c.confrelid
    JOIN pg_namespace parent_ns ON parent_ns.oid = parent_rel.relnamespace
    JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS child_key(attnum, ordinality) ON true
    JOIN LATERAL unnest(c.confkey) WITH ORDINALITY AS parent_key(attnum, ordinality)
      ON parent_key.ordinality = child_key.ordinality
    JOIN pg_attribute child_att
      ON child_att.attrelid = child_rel.oid AND child_att.attnum = child_key.attnum
    JOIN pg_attribute parent_att
      ON parent_att.attrelid = parent_rel.oid AND parent_att.attnum = parent_key.attnum
    WHERE c.contype = 'f'
      AND child_ns.nspname IN ('public', 'auth', 'storage')
    GROUP BY c.conname, child_ns.nspname, child_rel.relname, parent_ns.nspname, parent_rel.relname
  `);

  for (const constraint of constraints.rows) {
    const child = quoteQualified(constraint.child_schema, constraint.child_table);
    const parent = quoteQualified(constraint.parent_schema, constraint.parent_table);
    const childAlias = "child_row";
    const parentAlias = "parent_row";
    const join = constraint.columns
      .map((column) => `${childAlias}.${quoteIdentifier(column.child)} = ${parentAlias}.${quoteIdentifier(column.parent)}`)
      .join(" AND ");
    const nonNull = constraint.columns
      .map((column) => `${childAlias}.${quoteIdentifier(column.child)} IS NOT NULL`)
      .join(" AND ");
    const result = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM ${child} AS ${childAlias}
       LEFT JOIN ${parent} AS ${parentAlias} ON ${join}
       WHERE ${nonNull} AND ${parentAlias}.tableoid IS NULL`,
    );
    if (Number(result.rows[0]?.count ?? 0) !== 0) {
      throw new Error(`Restored foreign key ${constraint.conname} has orphaned rows.`);
    }
  }
  return constraints.rows.length;
}

const RECOVERY_INVARIANTS: readonly RecoveryInvariant[] = [
  {
    key: "auth.active_users_auth_id_mapping",
    query: `SELECT count(*)::text AS count
            FROM public.users u
            LEFT JOIN auth.users au ON au.id = u.auth_id
            WHERE u.status = 'active'
              AND u.auth_id IS NOT NULL
              AND au.id IS NULL`,
  },
  {
    key: "identity.user_identities_dangling",
    query: `SELECT count(*)::text AS count
            FROM public.user_identities i
            LEFT JOIN public.users u ON u.id = i.user_id
            WHERE u.id IS NULL`,
  },
  {
    key: "identity.active_primary_duplicate",
    query: `SELECT count(*)::text AS count
            FROM (
              SELECT user_id, kind
              FROM public.user_identities
              WHERE status = 'active' AND is_primary = true
              GROUP BY user_id, kind
              HAVING count(*) > 1
            ) invalid`,
  },
  {
    key: "identity.active_provider_subject_duplicate",
    query: `SELECT count(*)::text AS count
            FROM (
              SELECT provider, provider_subject
              FROM public.user_identities
              WHERE status = 'active'
              GROUP BY provider, provider_subject
              HAVING count(*) > 1
            ) invalid`,
  },
  {
    key: "identity.merged_target_invalid",
    query: `SELECT count(*)::text AS count
            FROM public.users merged
            LEFT JOIN public.users canonical ON canonical.id = merged.merged_into_user_id
            WHERE merged.status = 'merged'
              AND (canonical.id IS NULL OR canonical.status <> 'active' OR canonical.id = merged.id)`,
  },
  {
    key: "identity.admin_grant_dangling",
    query: `SELECT count(*)::text AS count
            FROM public.season_admin_grants grant_row
            LEFT JOIN public.users user_row ON user_row.id = grant_row.user_id
            LEFT JOIN public.seasons season_row ON season_row.id = grant_row.season_id
            WHERE user_row.id IS NULL OR season_row.id IS NULL`,
  },
  {
    key: "entry.current_roster_revision_scope",
    query: `SELECT count(*)::text AS count
            FROM public.competition_entries entry_row
            LEFT JOIN public.competition_entry_roster_revisions revision_row
              ON revision_row.id = entry_row.current_roster_revision_id
             AND revision_row.entry_id = entry_row.id
            WHERE revision_row.id IS NULL`,
  },
  {
    key: "entry.approved_roster_revision_scope",
    query: `SELECT count(*)::text AS count
            FROM public.competition_entries entry_row
            LEFT JOIN public.competition_entry_roster_revisions revision_row
              ON revision_row.id = entry_row.approved_roster_revision_id
             AND revision_row.entry_id = entry_row.id
            WHERE entry_row.approved_roster_revision_id IS NOT NULL AND revision_row.id IS NULL`,
  },
  {
    key: "entry.active_claim_scope",
    query: `SELECT count(*)::text AS count
            FROM public.competition_entry_active_claims claim_row
            LEFT JOIN public.competition_entries entry_row
              ON entry_row.id = claim_row.entry_id
             AND entry_row.competition_id = claim_row.competition_id
            LEFT JOIN public.competition_entry_participants participant_row
              ON participant_row.id = claim_row.participant_id
             AND participant_row.entry_id = claim_row.entry_id
             AND participant_row.user_id = claim_row.user_id
            WHERE entry_row.id IS NULL OR participant_row.id IS NULL OR participant_row.status <> 'confirmed'`,
  },
  {
    key: "entry.roster_member_scope",
    query: `SELECT count(*)::text AS count
            FROM public.competition_entry_roster_members member_row
            LEFT JOIN public.competition_entry_roster_revisions revision_row
              ON revision_row.id = member_row.revision_id
            LEFT JOIN public.competition_entry_participants participant_row
              ON participant_row.id = member_row.participant_id
             AND participant_row.entry_id = revision_row.entry_id
             AND participant_row.user_id = member_row.user_id
            WHERE revision_row.id IS NULL OR participant_row.id IS NULL`,
  },
  {
    key: "event_roster.source_revision_scope",
    query: `SELECT count(*)::text AS count
            FROM public.event_rosters roster_row
            LEFT JOIN public.competition_entries entry_row ON entry_row.id = roster_row.entry_id
            LEFT JOIN public.competition_entry_roster_revisions revision_row
              ON revision_row.id = roster_row.source_roster_revision_id
             AND revision_row.entry_id = roster_row.entry_id
            WHERE entry_row.id IS NULL
               OR (roster_row.source_roster_revision_id IS NOT NULL AND revision_row.id IS NULL)`,
  },
  {
    key: "event_roster.member_scope",
    query: `SELECT count(*)::text AS count
            FROM public.event_roster_members member_row
            JOIN public.event_rosters roster_row ON roster_row.id = member_row.event_roster_id
            LEFT JOIN public.competition_entry_participants participant_row
              ON participant_row.id = member_row.participant_id
             AND participant_row.entry_id = roster_row.entry_id
             AND participant_row.user_id = member_row.user_id
            WHERE member_row.participant_id IS NOT NULL AND participant_row.id IS NULL`,
  },
  {
    key: "stage.entrant_scope",
    query: `SELECT count(*)::text AS count
            FROM public.major_stage_entrants stage_entrant
            LEFT JOIN public.major_stage_runs stage_run
              ON stage_run.id = stage_entrant.stage_run_id
             AND stage_run.season_id = stage_entrant.season_id
            LEFT JOIN public.major_tournament_entrants tournament_entrant
              ON tournament_entrant.id = stage_entrant.tournament_entrant_id
             AND tournament_entrant.season_id = stage_entrant.season_id
            WHERE stage_run.id IS NULL OR tournament_entrant.id IS NULL`,
  },
  {
    key: "match.major_ownership_shape",
    query: `SELECT count(*)::text AS count
            FROM public.matches
            WHERE (ownership = 'manual' AND (major_stage_run_id IS NOT NULL OR managed_key IS NOT NULL))
               OR (ownership = 'major_stage' AND (major_stage_run_id IS NULL OR managed_key IS NULL))`,
  },
  {
    key: "match.map_entry_season_scope",
    query: `SELECT count(*)::text AS count
            FROM public.match_maps map_row
            JOIN public.matches match_row ON match_row.id = map_row.match_id
            LEFT JOIN public.competition_entries entry_row
              ON entry_row.id = map_row.picked_by_entry_id
             AND entry_row.competition_id = match_row.season_id
            WHERE map_row.picked_by_entry_id IS NOT NULL AND entry_row.id IS NULL`,
  },
  {
    key: "match.stats_map_match_scope",
    query: `SELECT count(*)::text AS count
            FROM public.match_player_stats stat_row
            JOIN public.match_maps map_row ON map_row.id = stat_row.map_id
            WHERE map_row.match_id <> stat_row.match_id`,
  },
  {
    key: "stage.final_result_scope",
    query: `SELECT count(*)::text AS count
            FROM public.major_final_results result_row
            LEFT JOIN public.major_stage_runs stage_run
              ON stage_run.id = result_row.playoff_stage_run_id
             AND stage_run.season_id = result_row.season_id
            LEFT JOIN public.competition_entries entry_row
              ON entry_row.id = result_row.champion_entry_id
             AND entry_row.competition_id = result_row.season_id
            WHERE stage_run.id IS NULL OR entry_row.id IS NULL`,
  },
  {
    key: "honor.scope",
    query: `SELECT count(*)::text AS count
            FROM public.tournament_honors honor_row
            LEFT JOIN public.seasons season_row ON season_row.id = honor_row.season_id
            LEFT JOIN public.competition_entries entry_row
              ON entry_row.id = honor_row.entry_id
             AND entry_row.competition_id = honor_row.season_id
            LEFT JOIN public.major_final_results final_row
              ON final_row.id = honor_row.source_final_result_id
             AND final_row.season_id = honor_row.season_id
            WHERE season_row.id IS NULL
               OR (honor_row.entry_id IS NOT NULL AND entry_row.id IS NULL)
               OR (honor_row.source_final_result_id IS NOT NULL AND final_row.id IS NULL)`,
  },
  {
    key: "education.expired_sensitive_evidence",
    query: `SELECT count(*)::text AS count
            FROM public.education_verifications
            WHERE status <> 'pending'
              AND reviewed_at <= $1
              AND (
                (evidence_type = 'manual_other' AND evidence_object_key IS NOT NULL)
                OR (evidence_type <> 'manual_other' AND evidence_code IS NOT NULL)
              )`,
    parameters: (now) => [new Date((now ?? new Date()).getTime() - EDUCATION_EVIDENCE_RETENTION_MS)],
  },
] as const;

interface RecoveryInvariant {
  key: string;
  query: string;
  parameters?: (now: Date) => readonly unknown[];
}

interface ForeignKeyDefinition {
  conname: string;
  child_schema: string;
  child_table: string;
  parent_schema: string;
  parent_table: string;
  columns: Array<{ child: string; parent: string }>;
}

async function assertZero(
  pool: Pick<Pool, "query">,
  key: string,
  query: string,
  parameters: readonly unknown[] = [],
): Promise<void> {
  const result = await pool.query<{ count: string }>(query, [...parameters]);
  const count = Number(result.rows[0]?.count ?? 0);
  if (count !== 0) throw new Error(`Recovery invariant failed: ${key} (${count}).`);
}

function quoteQualified(schema: string, table: string): string {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

async function main(): Promise<void> {
  const databaseUrl = assertIsolatedRecoveryDatabaseUrl(process.env);
  const pool = new Pool({ connectionString: databaseUrl, ssl: false, max: 1 });
  try {
    const result = await verifyRecoveryDatabase(pool, {
      expectedMigration: readExpectedMigrationFromEnvironment(),
    });
    console.log(`Recovery verification passed: migration=${result.migrationTag}, invariants=${result.invariantCount}, foreignKeys=${result.foreignKeyCount}.`);
  } finally {
    await pool.end();
  }
}

function readExpectedMigrationFromEnvironment(): RecoveryMigrationIdentity | undefined {
  const tag = process.env.RIVALHUB_RECOVERY_EXPECTED_MIGRATION_TAG;
  const hash = process.env.RIVALHUB_RECOVERY_EXPECTED_MIGRATION_HASH;
  const when = process.env.RIVALHUB_RECOVERY_EXPECTED_MIGRATION_WHEN;
  if (!tag && !hash && !when) return undefined;
  if (!tag || !hash || !when || !/^\d+$/.test(when)) {
    throw new Error("Recovery expected migration manifest fields must be provided together. ");
  }
  return {
    terminalTag: tag,
    terminalHash: hash,
    terminalWhen: Number(when),
  };
}

if (process.argv[1]?.endsWith("verify.ts")) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Recovery verification failed.");
    process.exitCode = 1;
  });
}
