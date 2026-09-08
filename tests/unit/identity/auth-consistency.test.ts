import { describe, expect, it } from "vitest";
import {
  buildAuthConsistencyRepairPlan,
  buildAuthConsistencyReport,
  summarizeAuthConsistencyReport,
  type AuthConsistencyAuthUser,
  type AuthConsistencyCanonicalUser,
  type AuthConsistencyIdentity,
} from "@/lib/identity/auth-consistency";

const NOW = new Date("2026-09-09T00:00:00.000Z");

function authUser(overrides: Partial<AuthConsistencyAuthUser> = {}): AuthConsistencyAuthUser {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    email: "auth@example.test",
    createdAt: new Date("2026-09-08T23:00:00.000Z"),
    confirmedAt: null,
    lastSignInAt: null,
    ...overrides,
  };
}

function canonicalUser(overrides: Partial<AuthConsistencyCanonicalUser> = {}): AuthConsistencyCanonicalUser {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    authId: null,
    email: "canonical@example.test",
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    ...overrides,
  };
}

function identity(overrides: Partial<AuthConsistencyIdentity> = {}): AuthConsistencyIdentity {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    userId: canonicalUser().id,
    kind: "auth",
    provider: "supabase_auth",
    providerSubject: authUser().id,
    normalizedValue: "canonical@example.test",
    verifiedAt: new Date("2026-08-01T00:00:00.000Z"),
    isPrimary: true,
    ...overrides,
  };
}

function report(
  authUsers: readonly AuthConsistencyAuthUser[],
  canonicalUsers: readonly AuthConsistencyCanonicalUser[] = [],
  identities: readonly AuthConsistencyIdentity[] = [],
) {
  return buildAuthConsistencyReport({ authUsers, canonicalUsers, identities }, { now: NOW });
}

describe("Auth ↔ canonical user consistency", () => {
  it("does not alert for an unconfirmed signup inside the grace window", () => {
    const [record] = report([authUser()]);

    expect(record).toMatchObject({
      classification: "pending_signup",
      severity: "none",
      healability: "not_needed",
      repairCode: null,
      blockerCode: null,
    });
    expect(record).not.toHaveProperty("email");
  });

  it("classifies a confirmed Auth-only account as a safely repairable stale orphan", () => {
    const target = authUser({
      email: "stale@example.test",
      createdAt: new Date("2026-05-15T00:00:00.000Z"),
      confirmedAt: new Date("2026-05-15T00:05:00.000Z"),
      lastSignInAt: new Date("2026-05-15T00:10:00.000Z"),
    });
    const [record] = report([target]);

    expect(record).toMatchObject({
      classification: "stale_auth_orphan",
      severity: "warning",
      healability: "safe_self_heal",
      repairCode: "create_canonical_user",
      blockerCode: null,
      conflictCode: null,
    });
    expect(buildAuthConsistencyRepairPlan(record, target)).toMatchObject({
      authUserId: target.id,
      action: "create_canonical_user",
      canonicalUserId: null,
      verifiedAt: target.confirmedAt,
      executable: true,
    });
  });

  it("plans to bind a uniquely email-mapped canonical user instead of creating a second person", () => {
    const target = authUser({
      email: "canonical@example.test",
      createdAt: new Date("2026-05-15T00:00:00.000Z"),
      confirmedAt: new Date("2026-05-15T00:05:00.000Z"),
    });
    const owner = canonicalUser();
    const records = report([target], [owner]);
    const [record] = records.filter((entry) => entry.authUserId === target.id);

    expect(record).toMatchObject({
      classification: "consistent",
      canonicalUserId: owner.id,
      healability: "safe_self_heal",
      repairCode: "bind_existing_canonical",
    });
    expect(records.filter((entry) => entry.classification === "public_without_auth")).toHaveLength(0);
    expect(buildAuthConsistencyRepairPlan(record, target)).toMatchObject({
      action: "bind_existing_canonical",
      canonicalUserId: owner.id,
      executable: true,
    });
  });

  it("blocks stale unconfirmed accounts even after the grace window", () => {
    const target = authUser({
      createdAt: new Date("2026-05-15T00:00:00.000Z"),
      lastSignInAt: new Date("2026-05-15T00:10:00.000Z"),
    });
    const [record] = report([target]);

    expect(record).toMatchObject({
      classification: "stale_auth_orphan",
      healability: "blocked",
      repairCode: null,
      blockerCode: "auth_confirmation_missing",
    });
    expect(buildAuthConsistencyRepairPlan(record, target)).toMatchObject({
      executable: false,
      blockerCode: "auth_confirmation_missing",
    });
  });

  it("reports missing Auth ownership as high severity and never proposes automatic repair", () => {
    const owner = canonicalUser({
      authId: "44444444-4444-4444-8444-444444444444",
      email: "without-auth@example.test",
    });
    const [record] = report([], [owner]);

    expect(record).toMatchObject({
      classification: "public_without_auth",
      severity: "high",
      canonicalUserId: owner.id,
      healability: "manual_review",
      repairCode: null,
      blockerCode: "auth_id_points_to_missing_auth_user",
    });
  });

  it("reports a legacy Auth binding whose active Auth identity is missing", () => {
    const authId = "44444444-4444-4444-8444-444444444444";
    const owner = canonicalUser({ authId, email: "legacy-binding@example.test" });
    const target = authUser({
      id: authId,
      email: owner.email,
      confirmedAt: new Date("2026-05-15T00:05:00.000Z"),
    });
    const records = report([target], [owner]);

    expect(records).toContainEqual(expect.objectContaining({
      classification: "public_without_auth",
      canonicalUserId: owner.id,
      severity: "high",
      healability: "manual_review",
      repairCode: null,
      blockerCode: "primary_auth_identity_missing",
      identityOwnership: expect.objectContaining({ matchedAuthUserIds: [authId] }),
    }));
  });

  it("fails closed when Auth subject and normalized email have different owners", () => {
    const first = canonicalUser({ id: "22222222-2222-4222-8222-222222222222", email: "first@example.test" });
    const second = canonicalUser({ id: "55555555-5555-4555-8555-555555555555", email: "second@example.test" });
    const target = authUser({ email: first.email, createdAt: new Date("2026-05-15T00:00:00.000Z"), confirmedAt: new Date("2026-05-15T00:05:00.000Z") });
    const records = report([target], [first, second], [
      identity({ userId: first.id, normalizedValue: first.email }),
      identity({ id: "66666666-6666-4666-8666-666666666666", userId: second.id, kind: "email", provider: "email", providerSubject: first.email, normalizedValue: first.email, isPrimary: false }),
    ]);
    const conflict = records.find((entry) => entry.authUserId === target.id);

    expect(conflict).toMatchObject({
      classification: "identity_owner_conflict",
      severity: "critical",
      healability: "blocked",
      conflictCode: "auth_and_email_owner_mismatch",
    });
    expect(buildAuthConsistencyRepairPlan(conflict, target)).toMatchObject({
      executable: false,
      conflictCode: "auth_and_email_owner_mismatch",
    });
  });

  it("reports duplicate Auth subject ownership even when the auth identities also carry normalized emails", () => {
    const first = canonicalUser({ id: "22222222-2222-4222-8222-222222222222", email: "first@example.test" });
    const second = canonicalUser({ id: "55555555-5555-4555-8555-555555555555", email: "second@example.test" });
    const authId = "88888888-8888-4888-8888-888888888888";
    const records = report([], [first, second], [
      identity({ id: "99999999-9999-4999-8999-999999999999", userId: first.id, providerSubject: authId, normalizedValue: first.email }),
      identity({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", userId: second.id, providerSubject: authId, normalizedValue: second.email }),
    ]);

    expect(records).toContainEqual(expect.objectContaining({
      classification: "identity_owner_conflict",
      authUserId: null,
      conflictCode: "multiple_canonical_owners_for_auth_subject",
      identityOwnership: expect.objectContaining({
        identityOwnerIds: [first.id, second.id],
        authSubjectOwnerIds: [first.id, second.id],
      }),
    }));
  });

  it("does not treat a non-email identity normalized value as an email owner", () => {
    const first = canonicalUser({ id: "22222222-2222-4222-8222-222222222222", email: "first@example.test" });
    const second = canonicalUser({ id: "55555555-5555-4555-8555-555555555555", email: "second@example.test" });
    const target = authUser({
      id: "88888888-8888-4888-8888-888888888888",
      email: first.email,
      createdAt: new Date("2026-05-15T00:00:00.000Z"),
      confirmedAt: new Date("2026-05-15T00:05:00.000Z"),
    });
    const records = report([target], [first, second], [
      identity({ userId: first.id, providerSubject: target.id, normalizedValue: first.email }),
      identity({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", userId: second.id, kind: "oauth", provider: "steam", providerSubject: "steam-subject", normalizedValue: first.email, isPrimary: false }),
    ]);

    expect(records.find((entry) => entry.authUserId === target.id)).toMatchObject({
      classification: "consistent",
      canonicalUserId: first.id,
      conflictCode: null,
    });
    expect(records.filter((entry) => entry.conflictCode === "multiple_canonical_owners_for_normalized_email")).toHaveLength(0);
  });

  it("summarizes every fixed classification deterministically", () => {
    const summary = summarizeAuthConsistencyReport(report([
      authUser(),
      authUser({ id: "77777777-7777-4777-8777-777777777777", email: "confirmed@example.test", createdAt: new Date("2026-05-15T00:00:00.000Z"), confirmedAt: new Date("2026-05-15T00:05:00.000Z") }),
    ]));

    expect(summary).toEqual({
      consistent: 0,
      pending_signup: 1,
      stale_auth_orphan: 1,
      public_without_auth: 0,
      identity_owner_conflict: 0,
    });
  });
});
