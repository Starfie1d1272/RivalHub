# F2 baseline evidence

## Current active bytes (d7a25467)

The active file is `drizzle/migrations/0000_v3_baseline.sql`, not the earlier
review artifact named below. Its SHA-256 is
`c9f9bafc7b3bc0525b97c0ff06cae1da339ab1410903553f74b7ba9d119188e1`;
`baseline-identity.json` records the same hash. The adjacent legacy ledger
contains 113 entries and `legacy-contract.json` hashes to
`236cda0feb092ed9f05e052df063eddfadd72c5ec330b531a5805cda12917d1a`,
matching the identity. These byte checks alone do not replay or validate the
current baseline. The following sections preserve the earlier proof and its
limitations; the earlier `387c...` replay is not evidence for these bytes.

This document records the earlier proof artifacts, not a validation of the
adjacent `0000_v3_candidate.sql`: that file subsequently normalizes synthetic
catalog UUIDs/times, removes the instance-specific conversion source note,
and adds a legacy-ledger archive. Its final bytes require a fresh replay.
Those earlier proof artifacts are not the current active migration chain;
the later candidate validation and remaining limits are recorded below.

## Current-byte isolated replay (2026-11-02)

At commit `8e6718b1cb213e0adce42dfa469c1fa33fe3a892`, a newly initialized
Local Supabase replayed the original 113-entry v2 chain and then the current
active chain through the canonical runner. Adoption completed with one active
v3 ledger entry, 113 archived legacy entries and the original email rule
still present. This exercises the adoption contract for the current baseline
bytes above; it is not Hosted or production evidence.

Separately, commit `c55f1b7ec6e1d0c8bd8006ae5c7570f77352a736` produced an
isolated full backup from a synthetic v2 source with one Storage object, using
real age encryption and a loopback object-storage fixture. HEAD/GET/hash
read-back, fetch and full restore to a second Local Supabase completed. The
source and restored 113-entry id/hash/time ledgers matched, the email rule and
Storage object remained, the object bytes had the same SHA-256, and v2 recovery
evidence plus package readiness passed. The application identity was an HTTP
fixture, and the missing host `psql` was replaced by the target container's
real client. This does not exercise the instance installer, stopped-instance
checkpoint mode, failure injection, `--restore-pair`, Hosted or systemd.

## Managed instance journey (2026-11-02)

A temporary adapted host fixture used the source at `d7d631b797a6315e5776ca251c0bff61f745aee4` and the v2 package identity `f2bf9500d2a765571275e7941e90c828f1a66650`. It installed an instance backed by a real Local Supabase with the 105-entry v2 prefix and one real `season-public-assets` object. A real named pg_cron job and its Vault origin were configured on that isolated source. With another database transaction active, the managed scheduler was paused and the installer timed out before migration; the service stand-in stayed stopped and the ledger remained at 105. After resetting the fixture, pre-marker checkpoint failures restored the old service stand-in and original scheduler state.

The successful checkpoint attempt paused the scheduler, captured and read back a real encrypted DB and Storage artifact through a loopback S3 fixture, then migrated/adopted the source to one active v3 entry with 113 archived legacy entries. An injected candidate restart failure after the migration marker left the service stand-in stopped and the original scheduler paused. The fetched checkpoint restored to a second Local Supabase using the real restore runner; its 105 id/hash/time ledger entries matched the checkpoint, and the restored object's SHA-256 matched the source. `--restore-pair` then activated the old package stand-in after its real database readiness check; repeat consumption was rejected. A second check held an active transaction on the restored target: activation timed out, the service stand-in stayed stopped and no completion marker was written; after the transaction ended, target scheduler and all-writer checks passed and paired activation succeeded. The original scheduler remained paused and the new target had no scheduler jobs, so target provisioning remains a separate step.

The fixture intentionally substituted systemd, HTTP/public ingress and process identity, host paths and ownership, Hosted-only endpoint validation, and executed the Supabase CLI's generated dump scripts inside the local database container. The restore used that container's real `psql` client. These substitutions do not establish actual root/systemd, Hosted permissions or a deployed application journey. The restore runner included the legacy-source correction committed as `edabf99e2c1eef7bd29cc41ff503ab407f5d4b7e`; the installer fixture predates only its error-message clarification. External non-managed writers remained an explicit operator precondition, not a proven global fence.

## Later candidate validation

The subsequently prepared active baseline has SHA-256
`387c6388433a250647acd17c55bf97f218983fb7bf2ea15ac376414c6d95cf9c`.
Two independently initialized Local Supabase instances executed the active
baseline and the original 113-migration chain respectively. The existing
physical comparator, 127-table access matrix, application Realtime policy and
managed bucket checks passed. The canonical runner adopted the original chain;
its 113 original id/hash/time entries, synthetic user and approved education
history and the existing official email rule were preserved. Unknown ledgers,
physical drift and a baseline modified without updating the reviewed identity
were rejected. New generic catalog rows preserve business keys and deterministic
institution IDs; generated IDs and timestamps are not frozen. The official
email rule and an instance-specific conversion source note are omitted only
on the fresh path.

The full backup CLI, actual age encryption, loopback S3 fixture, fetch and full
restore ran against separately initialized isolated providers using source
commit `0d0a037e86d68c5504b78da8b1a832d165b7660c`. The restored 113-entry
archive, synthetic catalog/business rows, email rule and Storage object matched;
recovery evidence, release capability and readiness checks passed. A temporary
synthetic follow-on migration also preserved the archive and business row. This
does not establish an actual released follow-on migration, Hosted permissions,
systemd execution or database-wide migration mutual exclusion.

Source: Git commit `ec920fc4118cddbc998053a15ebdc91d9dc09bcf` (#1354, includes #1371). All data came from a newly initialized Local Supabase, followed by the original canonical 0000–0112 Drizzle chain. No production database, data, credentials, or external host was used. This is a review artifact, not an active migration or authorization to adopt.

## Review files

- `f2-baseline-proof-candidate.sql`: schema-only CLI output plus the application-owned supplement; SHA-256 `6b6671468ff9f4792c81b17a50d60065d5d5d9436baa761203bfcb63cbe6a0d9`.
- `f2-baseline-proof-catalog.sql`: five generic seed tables only; SHA-256 `872ae41443d2ed3463fa37c3950df6aaf89026d4ed5d1d60d3bd6da209c27015`.
- `f2-baseline-proof-cli.sql`: unmodified official CLI schema-only output; SHA-256 `634e018c47988b66ffd32f734b96735582a173a07d4eb49c707bf069c6404c11`.
- `f2-baseline-proof-supplement.sql`: explicit 127-table grant correction, existing 0103 application-owned realtime policy, and three bucket contracts; SHA-256 `b32d1e6c83ac899515687a3f0183a4144c20183b1f7e3ee4418e52779425dd76`.

The sample SQL is for **fresh, provider-initialized isolated databases only**; it must not be executed against existing or production data. At the time of that extraction, no v3 journal, ledger adoption, publication, release, or freeze was included.

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
- The extraction alone did not establish source data, frozen history, unknown ledger rejection, idempotent adopt, DB-level migration mutex, v3 lineage, backup/restore or actual Hosted/systemd equivalence; see the later validation above for its narrower evidence. The final terminal must be rechecked against the actually merged branch before generating a new active baseline.
- The attempted `git fetch` combining the live #1354 branch and deleted #1371 head returned an error because #1371 head no longer exists; no deleted reference was retried. The #1354 branch was fetched separately and #1371 merge identity was checked via GitHub.
- Running `pnpm exec` from the archived scratch directory initially refused due to pnpm workspace-location metadata. Candidate and installed workspace lockfiles/manifests were checked identical, then the canonical runner was invoked normally from the original installed workspace with the archived migration/config paths; no validation was disabled.
