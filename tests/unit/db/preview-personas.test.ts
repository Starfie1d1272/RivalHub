import { describe, expect, it } from "vitest";
import { deterministicUserId, syntheticUserId } from "../../../scripts/db/preview/personas";

describe("preview persona selection", () => {
  const users = [{ id: "00000000-0000-4000-8000-000000000001", status: "active" }, { id: "00000000-0000-4000-8000-000000000002", status: "active" }];

  it("prefers the current-event candidate and remains stable", () => {
    const candidates = { currentSeasonId: "season", playerUserId: users[1].id, invitedUserId: null, captainUserId: null, seasonAdminUserId: null, superAdminUserId: null };
    expect(deterministicUserId(users, candidates, "player", new Set())).toBe(users[1].id);
    expect(deterministicUserId(users, candidates, "player", new Set())).toBe(users[1].id);
  });

  it("uses deterministic synthetic identity when no active source user exists", () => {
    const id = syntheticUserId("captain");
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(syntheticUserId("captain")).toBe(id);
  });
});
