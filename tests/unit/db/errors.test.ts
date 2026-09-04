import { describe, expect, it } from "vitest";
import { extractPgError, isPgUniqueViolation } from "@/db/errors";

const PENDING_INVITATION_CONSTRAINT = "team_invitations_one_pending_direct_per_user";

describe("PostgreSQL error extraction", () => {
  it("extracts safe metadata from a plain PostgreSQL error", () => {
    const result = extractPgError({
      code: "23505",
      constraint: "teams_slug_unique",
      schema: "public",
      table: "teams",
      column: "slug",
      detail: "Key (slug)=(secret-team) already exists.",
      query: "insert into teams ...",
      params: ["secret-team"],
    });

    expect(result).toEqual({
      code: "23505",
      constraint: "teams_slug_unique",
      schema: "public",
      table: "teams",
      column: "slug",
    });
    expect(result).not.toHaveProperty("detail");
    expect(result).not.toHaveProperty("query");
    expect(result).not.toHaveProperty("params");
  });

  it("finds PostgreSQL metadata through bounded nested causes", () => {
    const pgError = { code: "23505", constraint: PENDING_INVITATION_CONSTRAINT };
    const wrapped = { cause: { cause: pgError } };

    expect(extractPgError(wrapped)).toEqual({
      code: "23505",
      constraint: PENDING_INVITATION_CONSTRAINT,
    });
  });

  it("accepts other SQLSTATE values but only matches an exact unique constraint", () => {
    expect(extractPgError({ code: "23503", constraint: "teams_creator_user_id_users_id_fk" })).toEqual({
      code: "23503",
      constraint: "teams_creator_user_id_users_id_fk",
    });
    expect(extractPgError({ code: "40001" })).toEqual({ code: "40001" });

    const wrapped = { cause: { code: "23505", constraint: PENDING_INVITATION_CONSTRAINT } };
    expect(isPgUniqueViolation(wrapped, PENDING_INVITATION_CONSTRAINT)).toBe(true);
    expect(isPgUniqueViolation(wrapped, [PENDING_INVITATION_CONSTRAINT, "other_constraint"])).toBe(true);
    expect(isPgUniqueViolation(wrapped, "teams_slug_unique")).toBe(false);
    expect(isPgUniqueViolation({ cause: { code: "23505" } }, PENDING_INVITATION_CONSTRAINT)).toBe(false);
    expect(isPgUniqueViolation({ cause: { code: "23503", constraint: PENDING_INVITATION_CONSTRAINT } }, PENDING_INVITATION_CONSTRAINT)).toBe(false);
  });

  it("returns null for non-PG errors and non-string metadata", () => {
    expect(extractPgError(new Error("duplicate key"))).toBeNull();
    expect(extractPgError({ code: 23505, constraint: PENDING_INVITATION_CONSTRAINT })).toBeNull();
    expect(extractPgError({ code: "23505", constraint: 123 })).toEqual({ code: "23505" });
    expect(extractPgError({ code: "APP_CODE" })).toBeNull();
  });

  it("stops on cause cycles and at the fixed traversal bound", () => {
    const left: { cause?: unknown } = {};
    const right: { cause?: unknown } = {};
    left.cause = right;
    right.cause = left;
    expect(extractPgError(left)).toBeNull();

    let deep: unknown = { code: "23505", constraint: "too_deep" };
    for (let index = 0; index < 8; index += 1) deep = { cause: deep };
    expect(extractPgError(deep)).toBeNull();
  });

  it("does not throw when a non-standard error getter throws", () => {
    const wrapper = {};
    Object.defineProperty(wrapper, "code", {
      get() {
        throw new Error("broken code getter");
      },
    });
    Object.defineProperty(wrapper, "cause", {
      get() {
        throw new Error("broken cause getter");
      },
    });

    expect(() => extractPgError(wrapper)).not.toThrow();
    expect(extractPgError(wrapper)).toBeNull();
  });
});
