import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { TxDb } from "../../../src/db/client";
import { describe, expect, it } from "vitest";
import * as schema from "../../../src/db/schema";
import { MAX_CAPTAIN_VOTES } from "../../../src/lib/captains/rules";
import { completeSecondaryIdentityLinkInTx, hashIdentityLinkState } from "../../../src/lib/identity/linking";
import { buildUserMergePreflight, executeUserMergeInTx } from "../../../src/lib/identity/merge";
import { loadSelfServiceMergeAuthorization, selectSelfServiceMergePair } from "../../../src/lib/identity/self-service";
import { createLocalPool } from "./harness/database";

describe("canonical user identity merge PostgreSQL invariants", () => {
  it("keeps the selected profile intact, reparents person facts, retires loser competitive facts, and leaves a durable alias", async () => {
    const pool = createLocalPool();
    const ids = { canonical: randomUUID(), merged: randomUUID(), admin: randomUUID() };
    const database = drizzle(pool, { schema });
    try {
      const institution = await pool.query<{ id: string }>("SELECT id FROM institutions ORDER BY id LIMIT 1");
      if (!institution.rows[0]) throw new Error("Local fixture 需要高校目录记录。");
      await pool.query(
        "INSERT INTO users (id, email, display_name, qq, role) VALUES ($1, $2, 'Selected profile', 'selected-qq', 'user'), ($3, $4, 'Loser profile', 'loser-qq', 'user'), ($5, $6, 'Merge admin', 'admin-qq', 'super_admin')",
        [ids.canonical, `canonical-${ids.canonical}@local.test`, ids.merged, `merged-${ids.merged}@local.test`, ids.admin, `merge-admin-${ids.admin}@local.test`],
      );
      await pool.query(
        "INSERT INTO education_verifications (user_id, institution_id, academic_status, evidence_type, status, reviewed_by, reviewed_at) VALUES ($1, $2, 'enrolled', 'institutional_email', 'approved', 'system:local-test', now())",
        [ids.merged, institution.rows[0].id],
      );
      await pool.query(
        "INSERT INTO competitive_rank_facts (user_id, platform, kind, status, rank, rating) VALUES ($1, 'local-test', 'historical_peak', 'ranked', 'A', 1800)",
        [ids.merged],
      );
      await pool.query(
        "INSERT INTO audit_logs (action, actor_id, target_type, target_id, meta) VALUES ('local.identity.history', $1, 'user', $1, '{}'::jsonb)",
        [ids.merged],
      );

      const preflight = await buildUserMergePreflight(database, {
        canonicalUserId: ids.canonical,
        mergedUserId: ids.merged,
      }, { evidenceClass: "super_admin_review" });
      expect(preflight.executable).toBe(true);
      expect(preflight.items).toEqual(expect.arrayContaining([
        expect.objectContaining({ key: "reference:education_verifications.user_id", category: "AUTOMATIC", domain: "教育认证记录" }),
        expect.objectContaining({ key: "competitive:loser-profile", category: "AUTOMATIC", domain: "待归并竞技资料" }),
        expect.objectContaining({ key: "profile:canonical", category: "PRESERVE", domain: "保留账号资料" }),
      ]));

      await database.transaction((tx) => executeUserMergeInTx(tx, {
        canonicalUserId: ids.canonical,
        mergedUserId: ids.merged,
        actorUserId: ids.admin,
        expectedFingerprint: preflight.fingerprint,
        evidenceClass: "super_admin_review",
        reason: "local PostgreSQL merge invariant test",
      }));

      await expect(pool.query("SELECT count(*)::text AS count FROM education_verifications WHERE user_id = $1", [ids.canonical])).resolves.toMatchObject({ rows: [{ count: "1" }] });
      await expect(pool.query("SELECT count(*)::text AS count FROM competitive_rank_facts WHERE user_id = $1", [ids.canonical])).resolves.toMatchObject({ rows: [{ count: "0" }] });
      await expect(pool.query("SELECT display_name, qq FROM users WHERE id = $1", [ids.canonical])).resolves.toMatchObject({ rows: [{ display_name: "Selected profile", qq: "selected-qq" }] });
      await expect(pool.query("SELECT status::text, merged_into_user_id FROM users WHERE id = $1", [ids.merged])).resolves.toMatchObject({ rows: [{ status: "merged", merged_into_user_id: ids.canonical }] });
      await expect(pool.query("SELECT canonical_user_id, merged_user_id FROM user_merge_ledger WHERE merged_user_id = $1", [ids.merged])).resolves.toMatchObject({ rows: [{ canonical_user_id: ids.canonical, merged_user_id: ids.merged }] });
      await expect(pool.query("SELECT actor_id FROM audit_logs WHERE action = 'local.identity.history' AND target_id = $1", [ids.merged])).resolves.toMatchObject({ rows: [{ actor_id: ids.merged }] });
    } finally {
      await pool.query("DELETE FROM audit_logs WHERE actor_id = ANY($1::uuid[])", [[ids.canonical, ids.merged, ids.admin]]).catch(() => {});
      await pool.query("DELETE FROM user_merge_ledger WHERE merged_user_id = $1", [ids.merged]).catch(() => {});
      await pool.query("DELETE FROM education_verifications WHERE user_id = ANY($1::uuid[])", [[ids.canonical, ids.merged]]).catch(() => {});
      await pool.query("DELETE FROM competitive_rank_facts WHERE user_id = ANY($1::uuid[])", [[ids.canonical, ids.merged]]).catch(() => {});
      await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [[ids.canonical, ids.merged, ids.admin]]).catch(() => {});
      await pool.end();
    }
  });

  it("reparents or deduplicates every season-registration foreign key without losing draft or vote history", async () => {
    const pool = createLocalPool();
    const ids = {
      canonical: randomUUID(),
      merged: randomUUID(),
      captain: randomUUID(),
      candidate: randomUUID(),
      admin: randomUUID(),
      seasonOne: randomUUID(),
      seasonTwo: randomUUID(),
      seasonThree: randomUUID(),
      canonicalRegistrationOne: randomUUID(),
      mergedRegistrationOne: randomUUID(),
      canonicalRegistrationTwo: randomUUID(),
      mergedRegistrationTwo: randomUUID(),
      mergedRegistrationThree: randomUUID(),
      captainRegistration: randomUUID(),
      candidateRegistration: randomUUID(),
      entryOne: randomUUID(),
      revisionOne: randomUUID(),
      entryTwo: randomUUID(),
      revisionTwo: randomUUID(),
      draftPickCanonical: randomUUID(),
      draftPickMergedEquivalent: randomUUID(),
      draftPickMergedOnly: randomUUID(),
      voteCanonical: randomUUID(),
      voteMergedDuplicate: randomUUID(),
      voteMergedVoter: randomUUID(),
      voteMergedCandidate: randomUUID(),
    };
    const rollbackFixture = Symbol("rollback fixture");
    const database = drizzle(pool, { schema });
    try {
      try {
        await database.transaction(async (tx) => {
          for (const seasonId of [ids.seasonOne, ids.seasonTwo, ids.seasonThree]) await insertTestSeason(tx, seasonId);
          for (const [userId, label] of [
            [ids.canonical, "canonical"],
            [ids.merged, "merged"],
            [ids.captain, "captain"],
            [ids.candidate, "candidate"],
            [ids.admin, "admin"],
          ] as const) await insertTestUser(tx, userId, `${label}-${userId}@local.test`, label === "admin" ? "super_admin" : "user");

          await insertTestRegistration(tx, ids.canonicalRegistrationOne, ids.canonical, ids.seasonOne, "approved");
          await insertTestRegistration(tx, ids.mergedRegistrationOne, ids.merged, ids.seasonOne, "approved");
          await insertTestRegistration(tx, ids.canonicalRegistrationTwo, ids.canonical, ids.seasonTwo, "approved");
          await insertTestRegistration(tx, ids.mergedRegistrationTwo, ids.merged, ids.seasonTwo, "approved");
          await insertTestRegistration(tx, ids.mergedRegistrationThree, ids.merged, ids.seasonThree, "approved");
          await insertTestRegistration(tx, ids.captainRegistration, ids.captain, ids.seasonOne, "approved");
          await insertTestRegistration(tx, ids.candidateRegistration, ids.candidate, ids.seasonOne, "approved");

          await insertTestEntry(tx, {
            entryId: ids.entryOne,
            revisionId: ids.revisionOne,
            seasonId: ids.seasonOne,
            sourceRegistrationId: ids.mergedRegistrationOne,
            representativeUserId: ids.canonical,
          });
          await insertTestEntry(tx, {
            entryId: ids.entryTwo,
            revisionId: ids.revisionTwo,
            seasonId: ids.seasonTwo,
            sourceRegistrationId: ids.mergedRegistrationTwo,
            representativeUserId: ids.canonical,
          });
          await tx.execute(sql`
            INSERT INTO draft_picks (id, season_id, entry_id, registration_id, round, pick_number, auto_picked)
            VALUES
              (${ids.draftPickCanonical}, ${ids.seasonOne}, ${ids.entryOne}, ${ids.canonicalRegistrationOne}, 1, 1, false),
              (${ids.draftPickMergedEquivalent}, ${ids.seasonOne}, ${ids.entryOne}, ${ids.mergedRegistrationOne}, 1, 1, false),
              (${ids.draftPickMergedOnly}, ${ids.seasonTwo}, ${ids.entryTwo}, ${ids.mergedRegistrationTwo}, 2, 2, true)
          `);
          await tx.execute(sql`
            INSERT INTO captain_votes (id, voter_registration_id, candidate_registration_id, created_at)
            VALUES
              (${ids.voteCanonical}, ${ids.canonicalRegistrationOne}, ${ids.candidateRegistration}, now() - interval '4 seconds'),
              (${ids.voteMergedDuplicate}, ${ids.mergedRegistrationOne}, ${ids.candidateRegistration}, now() - interval '3 seconds'),
              (${ids.voteMergedVoter}, ${ids.mergedRegistrationOne}, ${ids.captainRegistration}, now() - interval '2 seconds'),
              (${ids.voteMergedCandidate}, ${ids.captainRegistration}, ${ids.mergedRegistrationOne}, now() - interval '1 second')
          `);

          const preflight = await buildUserMergePreflight(tx, {
            canonicalUserId: ids.canonical,
            mergedUserId: ids.merged,
          }, { evidenceClass: "super_admin_review" });
          expect(preflight.executable).toBe(true);
          expect(preflight.items).not.toEqual(expect.arrayContaining([
            expect.objectContaining({ key: "registration:draft-pick-conflict", category: "BLOCKER" }),
            expect.objectContaining({ key: "registration:captain-self-vote", category: "BLOCKER" }),
          ]));

          await executeUserMergeInTx(tx, {
            canonicalUserId: ids.canonical,
            mergedUserId: ids.merged,
            actorUserId: ids.admin,
            expectedFingerprint: preflight.fingerprint,
            evidenceClass: "super_admin_review",
            reason: "season registration foreign-key invariant test",
          });

          await expect(tx.execute(sql`SELECT source_registration_id FROM competition_entries WHERE id = ${ids.entryOne}`)).resolves.toMatchObject({ rows: [{ source_registration_id: ids.canonicalRegistrationOne }] });
          await expect(tx.execute(sql`SELECT source_registration_id FROM competition_entries WHERE id = ${ids.entryTwo}`)).resolves.toMatchObject({ rows: [{ source_registration_id: ids.canonicalRegistrationTwo }] });
          await expect(tx.execute(sql`SELECT registration_id FROM draft_picks WHERE id = ${ids.draftPickCanonical}`)).resolves.toMatchObject({ rows: [{ registration_id: ids.canonicalRegistrationOne }] });
          await expect(tx.execute(sql`SELECT count(*)::int AS count FROM draft_picks WHERE id = ${ids.draftPickMergedEquivalent}`)).resolves.toMatchObject({ rows: [{ count: 0 }] });
          await expect(tx.execute(sql`SELECT registration_id FROM draft_picks WHERE id = ${ids.draftPickMergedOnly}`)).resolves.toMatchObject({ rows: [{ registration_id: ids.canonicalRegistrationTwo }] });
          await expect(tx.execute(sql`SELECT user_id FROM season_registrations WHERE id = ${ids.mergedRegistrationThree}`)).resolves.toMatchObject({ rows: [{ user_id: ids.canonical }] });
          await expect(tx.execute(sql`SELECT count(*)::int AS count FROM season_registrations WHERE user_id = ${ids.merged}`)).resolves.toMatchObject({ rows: [{ count: 0 }] });
          await expect(tx.execute(sql`SELECT voter_registration_id, candidate_registration_id FROM captain_votes ORDER BY created_at, id`)).resolves.toMatchObject({ rows: [
            { voter_registration_id: ids.canonicalRegistrationOne, candidate_registration_id: ids.candidateRegistration },
            { voter_registration_id: ids.canonicalRegistrationOne, candidate_registration_id: ids.captainRegistration },
            { voter_registration_id: ids.captainRegistration, candidate_registration_id: ids.canonicalRegistrationOne },
          ] });

          throw rollbackFixture;
        });
      } catch (error) {
        if (error !== rollbackFixture) throw error;
      }
    } finally {
      await pool.end();
    }
  });

  it("blocks unresolved registration references, incompatible draft picks, and generated self-votes in preflight", async () => {
    const pool = createLocalPool();
    const ids = {
      canonical: randomUUID(),
      merged: randomUUID(),
      other: randomUUID(),
      admin: randomUUID(),
      seasonOne: randomUUID(),
      seasonTwo: randomUUID(),
      canonicalRegistration: randomUUID(),
      mergedRegistration: randomUUID(),
      mergedPendingRegistration: randomUUID(),
      otherRegistration: randomUUID(),
      entry: randomUUID(),
      revision: randomUUID(),
      canonicalPick: randomUUID(),
      mergedPick: randomUUID(),
      selfVote: randomUUID(),
      pendingVoterVote: randomUUID(),
      pendingCandidateVote: randomUUID(),
    };
    const rollbackFixture = Symbol("rollback fixture");
    const database = drizzle(pool, { schema });
    try {
      try {
        await database.transaction(async (tx) => {
          await insertTestSeason(tx, ids.seasonOne);
          await insertTestSeason(tx, ids.seasonTwo);
          await insertTestUser(tx, ids.canonical, `canonical-${ids.canonical}@local.test`);
          await insertTestUser(tx, ids.merged, `merged-${ids.merged}@local.test`);
          await insertTestUser(tx, ids.other, `other-${ids.other}@local.test`);
          await insertTestUser(tx, ids.admin, `admin-${ids.admin}@local.test`, "super_admin");
          await insertTestRegistration(tx, ids.canonicalRegistration, ids.canonical, ids.seasonOne, "approved");
          await insertTestRegistration(tx, ids.mergedRegistration, ids.merged, ids.seasonOne, "approved");
          await insertTestRegistration(tx, ids.mergedPendingRegistration, ids.merged, ids.seasonTwo, "pending");
          await insertTestRegistration(tx, ids.otherRegistration, ids.other, ids.seasonTwo, "approved");
          await insertTestEntry(tx, {
            entryId: ids.entry,
            revisionId: ids.revision,
            seasonId: ids.seasonOne,
            sourceRegistrationId: null,
            representativeUserId: ids.canonical,
          });
          await tx.execute(sql`
            INSERT INTO draft_picks (id, season_id, entry_id, registration_id, round, pick_number, auto_picked, client_request_id)
            VALUES
              (${ids.canonicalPick}, ${ids.seasonOne}, ${ids.entry}, ${ids.canonicalRegistration}, 1, 1, false, ${`request-${ids.canonicalPick}`}),
              (${ids.mergedPick}, ${ids.seasonOne}, ${ids.entry}, ${ids.mergedRegistration}, 2, 2, true, ${`request-${ids.mergedPick}`})
          `);
          await tx.execute(sql`
            INSERT INTO captain_votes (id, voter_registration_id, candidate_registration_id)
            VALUES
              (${ids.selfVote}, ${ids.mergedRegistration}, ${ids.canonicalRegistration}),
              (${ids.pendingVoterVote}, ${ids.mergedPendingRegistration}, ${ids.otherRegistration}),
              (${ids.pendingCandidateVote}, ${ids.otherRegistration}, ${ids.mergedPendingRegistration})
          `);

          const preflight = await buildUserMergePreflight(tx, {
            canonicalUserId: ids.canonical,
            mergedUserId: ids.merged,
          }, { evidenceClass: "super_admin_review" });
          expect(preflight.executable).toBe(false);
          expect(preflight.items).toEqual(expect.arrayContaining([
            expect.objectContaining({ key: "registration:draft-pick-conflict", category: "BLOCKER", count: 1 }),
            expect.objectContaining({ key: "registration:captain-self-vote", category: "BLOCKER", count: 1 }),
            expect.objectContaining({ key: "registration:captain-voter-reference-blocker", category: "BLOCKER", count: 1 }),
            expect.objectContaining({ key: "registration:captain-candidate-reference-blocker", category: "BLOCKER", count: 1 }),
          ]));

          throw rollbackFixture;
        });
      } catch (error) {
        if (error !== rollbackFixture) throw error;
      }
    } finally {
      await pool.end();
    }
  });

  it("blocks captain vote-limit conflicts after registration remap without executing the merge", async () => {
    const pool = createLocalPool();
    const ids = {
      canonical: randomUUID(),
      merged: randomUUID(),
      admin: randomUUID(),
      season: randomUUID(),
      canonicalRegistration: randomUUID(),
      mergedRegistration: randomUUID(),
      candidateUsers: Array.from({ length: MAX_CAPTAIN_VOTES + 1 }, () => randomUUID()),
      candidateRegistrations: Array.from({ length: MAX_CAPTAIN_VOTES + 1 }, () => randomUUID()),
      voteIds: Array.from({ length: MAX_CAPTAIN_VOTES + 1 }, () => randomUUID()),
    };
    const rollbackFixture = Symbol("rollback fixture");
    const database = drizzle(pool, { schema });
    try {
      try {
        await database.transaction(async (tx) => {
          await insertTestSeason(tx, ids.season);
          await insertTestUser(tx, ids.canonical, `canonical-${ids.canonical}@local.test`);
          await insertTestUser(tx, ids.merged, `merged-${ids.merged}@local.test`);
          await insertTestUser(tx, ids.admin, `admin-${ids.admin}@local.test`, "super_admin");
          for (const [index, userId] of ids.candidateUsers.entries()) {
            await insertTestUser(tx, userId, `candidate-${index}-${userId}@local.test`);
          }
          await insertTestRegistration(tx, ids.canonicalRegistration, ids.canonical, ids.season, "approved");
          await insertTestRegistration(tx, ids.mergedRegistration, ids.merged, ids.season, "approved");
          for (const [index, registrationId] of ids.candidateRegistrations.entries()) {
            await insertTestRegistration(tx, registrationId, ids.candidateUsers[index]!, ids.season, "approved");
          }

          const voteValues = ids.candidateRegistrations.map((candidateRegistrationId, index) => sql`(
            ${ids.voteIds[index]!},
            ${index < MAX_CAPTAIN_VOTES ? ids.canonicalRegistration : ids.mergedRegistration},
            ${candidateRegistrationId}
          )`);
          await tx.execute(sql`
            INSERT INTO captain_votes (id, voter_registration_id, candidate_registration_id)
            VALUES ${sql.join(voteValues, sql`, `)}
          `);

          const preflight = await buildUserMergePreflight(tx, {
            canonicalUserId: ids.canonical,
            mergedUserId: ids.merged,
          }, { evidenceClass: "super_admin_review" });
          expect(preflight.executable).toBe(false);
          expect(preflight.items).toEqual(expect.arrayContaining([
            expect.objectContaining({ key: "registration:captain-vote-limit-conflict", category: "BLOCKER", count: 1 }),
          ]));

          await expect(executeUserMergeInTx(tx, {
            canonicalUserId: ids.canonical,
            mergedUserId: ids.merged,
            actorUserId: ids.admin,
            expectedFingerprint: preflight.fingerprint,
            evidenceClass: "super_admin_review",
            reason: "captain vote limit merge invariant test",
          })).rejects.toThrow("存在未解决冲突");
          await expect(tx.execute(sql`SELECT status::text, merged_into_user_id FROM users WHERE id = ${ids.merged}`)).resolves.toMatchObject({ rows: [{ status: "active", merged_into_user_id: null }] });
          await expect(tx.execute(sql`SELECT count(*)::int AS count FROM captain_votes WHERE voter_registration_id IN (${ids.canonicalRegistration}, ${ids.mergedRegistration})`)).resolves.toMatchObject({ rows: [{ count: MAX_CAPTAIN_VOTES + 1 }] });

          throw rollbackFixture;
        });
      } catch (error) {
        if (error !== rollbackFixture) throw error;
      }
    } finally {
      await pool.end();
    }
  });

  it("turns an unverified historical counterparty identity into usable OTP proof before self-service merge", async () => {
    const pool = createLocalPool();
    const ids = { current: randomUUID(), counterparty: randomUUID(), auth: randomUUID(), request: randomUUID(), emailIdentity: randomUUID(), authIdentity: randomUUID() };
    const email = `counterparty-${ids.counterparty}@local.test`;
    const stateToken = `state-${ids.request}-${randomUUID()}`;
    const verifiedAt = new Date("2026-09-07T10:00:00.000Z");
    const rollbackFixture = Symbol("rollback fixture");
    const database = drizzle(pool, { schema });
    try {
      try {
        await database.transaction(async (tx) => {
          await insertTestUser(tx, ids.current, `current-${ids.current}@local.test`);
          await insertTestUser(tx, ids.counterparty, email);
          await tx.execute(sql`
            INSERT INTO user_identities (id, user_id, kind, provider, provider_subject, normalized_value, verified_at, provenance, status, is_primary)
            VALUES
              (${ids.emailIdentity}, ${ids.counterparty}, 'email', 'email', ${email}, ${email}, NULL, 'signup_confirmation', 'active', true),
              (${ids.authIdentity}, ${ids.counterparty}, 'auth', 'supabase_auth', ${ids.auth}, ${email}, NULL, 'signup_confirmation', 'active', true)
          `);
          await tx.execute(sql`
            INSERT INTO identity_link_requests (id, user_id, normalized_email, state_token_hash, status, expires_at)
            VALUES (${ids.request}, ${ids.current}, ${email}, ${hashIdentityLinkState(stateToken)}, 'pending', now() + interval '30 minutes')
          `);

          const outcome = await completeSecondaryIdentityLinkInTx(tx, {
            requestId: ids.request,
            stateToken,
            currentUserId: ids.current,
            authId: ids.auth,
            email,
            verifiedAt,
          });
          expect(outcome.kind).toBe("merge_required");
          if (outcome.kind !== "merge_required") throw new Error("OTP proof should require self-service merge");

          const proofResult = await tx.execute(sql`SELECT id, verified_at, provenance FROM user_identities WHERE id = ${ids.emailIdentity}`);
          expect(proofResult.rows).toMatchObject([{ id: ids.emailIdentity, provenance: "user_verified_link" }]);
          expect(new Date(String(proofResult.rows[0]?.verified_at)).toISOString()).toBe(verifiedAt.toISOString());
          const authorization = await loadSelfServiceMergeAuthorization(tx, { authorizationId: outcome.authorizationId, actorUserId: ids.current });
          expect(authorization.counterpartyUserId).toBe(ids.counterparty);
          const pair = selectSelfServiceMergePair(authorization, ids.current);
          const preflight = await buildUserMergePreflight(tx, pair, { evidenceClass: "dual_identity_control" });
          expect(preflight.executable).toBe(true);
          await executeUserMergeInTx(tx, {
            ...pair,
            actorUserId: ids.current,
            expectedFingerprint: preflight.fingerprint,
            evidenceClass: "dual_identity_control",
            reason: "OTP proof integration invariant test",
            authorizationId: authorization.id,
          });
          await expect(tx.execute(sql`SELECT status::text, merged_into_user_id FROM users WHERE id = ${ids.counterparty}`)).resolves.toMatchObject({ rows: [{ status: "merged", merged_into_user_id: ids.current }] });

          throw rollbackFixture;
        });
      } catch (error) {
        if (error !== rollbackFixture) throw error;
      }
    } finally {
      await pool.end();
    }
  });
});

async function insertTestSeason(tx: TxDb, seasonId: string): Promise<void> {
  await tx.execute(sql`INSERT INTO seasons (id, slug, name, kind) VALUES (${seasonId}, ${`identity-merge-${seasonId}`}, 'Identity merge fixture', 'custom')`);
}

async function insertTestUser(tx: TxDb, userId: string, email: string, role: "user" | "super_admin" = "user"): Promise<void> {
  await tx.execute(sql`INSERT INTO users (id, email, role) VALUES (${userId}, ${email}, ${role})`);
}

async function insertTestRegistration(tx: TxDb, registrationId: string, userId: string, seasonId: string, status: "pending" | "approved"): Promise<void> {
  await tx.execute(sql`
    INSERT INTO season_registrations (
      id, user_id, season_id, primary_position, secondary_position, peak_rank, peak_rank_season,
      peak_rating, current_season_peak_rank, current_rating, gameplay_style, status
    ) VALUES (
      ${registrationId}, ${userId}, ${seasonId}, 'igl', 'awper', 'A', 'identity-merge',
      1000, 'A', 1000, 'identity merge fixture', ${status}
    )
  `);
}

async function insertTestEntry(tx: TxDb, input: {
  entryId: string;
  revisionId: string;
  seasonId: string;
  sourceRegistrationId: string | null;
  representativeUserId: string;
}): Promise<void> {
  await tx.execute(sql`
    INSERT INTO competition_entries (
      id, competition_id, source, source_registration_id, name, representative_user_id, current_roster_revision_id
    ) VALUES (
      ${input.entryId}, ${input.seasonId}, 'event_native', ${input.sourceRegistrationId}, 'Identity merge fixture entry', ${input.representativeUserId}, ${input.revisionId}
    )
  `);
  await tx.execute(sql`
    INSERT INTO competition_entry_roster_revisions (id, entry_id, revision_number, status, origin, created_by)
    VALUES (${input.revisionId}, ${input.entryId}, 1, 'draft', 'initial', 'identity-merge-test')
  `);
  await tx.execute(sql`
    INSERT INTO competition_entry_representative_changes (entry_id, from_user_id, to_user_id, changed_by_actor_id)
    VALUES (${input.entryId}, NULL, ${input.representativeUserId}, 'identity-merge-test')
  `);
}
