# F2 isolated baseline candidate — NOT FROZEN

This document records the earlier proof artifacts, not a validation of the
adjacent `0000_v3_candidate.sql`: that file subsequently normalizes synthetic
catalog UUIDs/times, removes the instance-specific conversion source note,
and adds a legacy-ledger archive. Its final bytes require a fresh replay.
The candidate is not the active migration chain. Adoption remains restricted
to local databases and recovery lineage integration is unfinished.

Source: Git commit `ec920fc4118cddbc998053a15ebdc91d9dc09bcf` (#1354, includes #1371). All data came from a newly initialized Local Supabase, followed by the original canonical 0000–0112 Drizzle chain. No production database, data, credentials, or external host was used. This is a review artifact, not an active migration or authorization to adopt.

## Review files

- `f2-baseline-proof-candidate.sql`: schema-only CLI output plus the application-owned supplement; SHA-256 `6b6671468ff9f4792c81b17a50d60065d5d5d9436baa761203bfcb63cbe6a0d9`.
- `f2-baseline-proof-catalog.sql`: five generic seed tables only; SHA-256 `872ae41443d2ed3463fa37c3950df6aaf89026d4ed5d1d60d3bd6da209c27015`.
- `f2-baseline-proof-cli.sql`: unmodified official CLI schema-only output; SHA-256 `634e018c47988b66ffd32f734b96735582a173a07d4eb49c707bf069c6404c11`.
- `f2-baseline-proof-supplement.sql`: explicit 127-table grant correction, existing 0103 application-owned realtime policy, and three bucket contracts; SHA-256 `b32d1e6c83ac899515687a3f0183a4144c20183b1f7e3ee4418e52779425dd76`.

The sample SQL is for **fresh, provider-initialized isolated databases only**; it must not be executed against existing or production data. No v3 journal, ledger adoption, publication, release, or freeze is included.

## Exact extraction and composition

1. Archive the Git commit to a scratch directory and initialize a new local provider using that commit's Supabase config/templates. Replay `drizzle/migrations` through `scripts/db/canonical-migrate-cli.ts` and `drizzle.local.config.ts` against the local project; 113 ledger entries were present.
2. Run the unmodified official provider schema extraction:

   `pnpm exec supabase db dump --local --workdir /workspace/scratch/f2-baseline-proof --schema public --file /workspace/scratch/f2-baseline-proof-cli.sql`

   This scopes the dump to `public`; Auth/Storage internal schemas are not dumped. The CLI artifact was inspected for `SET log_min_messages` and does not contain it. No previously rejected SQL was replayed or removed from a replay script.
3. Extract only catalog data from the same synthetic database:

   `docker exec supabase_db_rivalhub-f2-baseline-proof pg_dump -U postgres -d postgres --data-only --column-inserts --table=public.institutions --table=public.competitive_platforms --table=public.competitive_platform_ranks --table=public.competitive_platform_seasons --table=public.conversion_policies > /workspace/scratch/f2-baseline-proof-catalog.sql`

   The sixth table `institution_email_domains` is intentionally not seeded for generic instances. The dump has 3,230 inserts, no NJU domain and no `SET log_min_messages`.
4. The supplement was formed by querying the **source synthetic database** for the 127 public base table names and emitting `REVOKE ALL PRIVILEGES ON TABLE public.<quoted-name> FROM anon, authenticated;` for each; concatenating the exact `drizzle/migrations/0103_restore_realtime_after_relocation.sql`; and appending the three explicit application bucket INSERT/contract checks visible in `f2-baseline-proof-supplement.sql`. Bucket rows use `ON CONFLICT (id) DO NOTHING`, followed by exact expected configuration validation. No provider Auth/Storage internal migration or provider data is replayed.
5. Concatenate the untouched CLI output and supplement, in that order, to produce `f2-baseline-proof-candidate.sql`. Provider `pg_cron` and `pg_net` must be available and enabled separately, matching original 0045 and the existing instance provisioning prerequisites.

## Observed verification

Two independent, officially initialized Local Supabase projects were used. The second was reset, provider extensions enabled using its normal local `postgres` role, and the exact combined candidate then catalog file replayed with `psql --single-transaction --set ON_ERROR_STOP=1`. The existing #1365 `compare-migration-contract` compared the resulting target to the original 113-migration source and passed. Existing access matrix passed for 127 public base tables; realtime viewer security boundary and team-logos verifier passed. This comparator covers the documented schema/ACL/function/trigger/policy/bucket/publication metadata; it does not prove business history, all provider internals, role memberships or Hosted permissions.

On both synthetic databases, all rows **and IDs** in the five generic catalog tables matched: institutions 3,196; competitive_platforms 2; competitive_platform_ranks 27; competitive_platform_seasons 4; conversion_policies 1. A scan of counts across all 127 public tables found no other populated source table except institution_email_domains: source 1 (`smail.nju.edu.cn`, student, active and auto-verified), generic target 0. This intentional difference does not authorize altering existing rules on upgrade/restore.

Initial raw CLI schema replay without the supplement was NOT equivalent: pg_cron and pg_net absent, the realtime policy and three buckets absent, and all 127 application relations gained anon/authenticated REFERENCES/TRIGGER/TRUNCATE/MAINTAIN through provider default ACL. The supplement is required and must itself receive security review.

## Unresolved before a real baseline

- The public CLI dump includes `CREATE SCHEMA IF NOT EXISTS public` and `ALTER SCHEMA public OWNER TO pg_database_owner`; behavior/permission on Hosted is unverified. The local proof used provider initialization and normal local role, not an escalated Hosted role.
- The five-table dump contains generated synthetic UUIDs and timestamps. They are not production data, but final design must choose stable identity and `now()`/approval-time semantics deliberately rather than claiming reproducible byte generation from another replay.
- No source data, frozen history, unknown ledger rejection, idempotent adopt, DB-level migration mutex, v3 lineage, backup/restore or actual Hosted/systemd equivalence is established here. The final terminal must be rechecked against the actually merged branch before generating a new active baseline.
- The attempted `git fetch` combining the live #1354 branch and deleted #1371 head returned an error because #1371 head no longer exists; no deleted reference was retried. The #1354 branch was fetched separately and #1371 merge identity was checked via GitHub.
- Running `pnpm exec` from the archived scratch directory initially refused due to pnpm workspace-location metadata. Candidate and installed workspace lockfiles/manifests were checked identical, then the canonical runner was invoked normally from the original installed workspace with the archived migration/config paths; no validation was disabled.
