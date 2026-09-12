import { describe, expect, it, vi } from "vitest";
import { deterministicUserId, PREVIEW_PERSONA_PASSWORD, PREVIEW_PERSONAS, syntheticUserId } from "../../../scripts/db/preview/personas";
import { selectPersonaCandidates } from "../../../scripts/db/preview/snapshot";

describe("preview persona selection", () => {
  const users = [{ id: "00000000-0000-4000-8000-000000000001", status: "active" }, { id: "00000000-0000-4000-8000-000000000002", status: "active" }];

  it("owns the public resettable fixture credential for all five personas", () => {
    expect(PREVIEW_PERSONAS).toEqual(["player", "invited", "captain", "season-admin", "super-admin"]);
    expect(PREVIEW_PERSONA_PASSWORD).toBe("rivalhub-preview-persona-resettable");
  });

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

  it("binds captain to a linked current-event Team and season admin to the current grant", async () => {
    const currentCaptain = users[0].id;
    const superAdmin = users[1].id;
    const query = vi.fn().mockResolvedValue({ rows: [{ user_id: "season-admin" }] });
    const candidates = await selectPersonaCandidates({ query } as never, {
      seasons: [{ id: "season", status: "playing" }],
      users: [{ id: currentCaptain, status: "active", role: "user" }, { id: superAdmin, status: "active", role: "super_admin" }],
      competition_entries: [{ id: "entry", competition_id: "season", team_id: "current-team" }],
      competition_entry_participants: [{ entry_id: "entry", user_id: currentCaptain, status: "confirmed" }],
      teams: [{ id: "current-team", status: "active", captain_user_id: currentCaptain }],
    } as never);

    expect(candidates).toMatchObject({ currentSeasonId: "season", captainUserId: currentCaptain, seasonAdminUserId: "season-admin", superAdminUserId: superAdmin });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("season_admin_grants"), ["season"]);
  });
});
