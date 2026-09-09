import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ season: vi.fn(), entries: vi.fn(), entry: vi.fn(), eventRoster: vi.fn(), matches: vi.fn(), session: vi.fn(), select: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("@/lib/data/public-seasons", () => ({ getPublicOrAuthorizedDraftSeason: mocks.season }));
vi.mock("@/lib/auth/session", () => ({ getUserSession: mocks.session }));
vi.mock("@/components/layout/AdminShortcutSlot", () => ({ AdminShortcutSlot: () => null }));
vi.mock("@/db/client", () => ({ db: { query: { competitionEntries: { findMany: mocks.entries, findFirst: mocks.entry }, eventRosters: { findFirst: mocks.eventRoster }, matches: { findMany: mocks.matches } }, select: mocks.select } }));
import ListPage from "@/app/[seasonSlug]/teams/page";
import DetailPage from "@/app/[seasonSlug]/teams/[entryId]/page";
function emptyChain() {
  const chain = { from: () => chain, innerJoin: () => chain, leftJoin: () => chain, where: () => Promise.resolve([]) };
  return chain;
}
describe("public entry routes", () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.stubGlobal("React", React);
    mocks.season.mockResolvedValue({ id: "season", name: "Major", registrationMode: "team", status: "registration" });
    mocks.select.mockImplementation(emptyChain); mocks.matches.mockResolvedValue([]); mocks.eventRoster.mockResolvedValue(null); mocks.session.mockResolvedValue(null);
  });
  it.each(["draft", "submitted", "changes_requested", "waitlisted", "rejected", "withdrawn"])("filters %s even for a known detail id", async (status) => {
    mocks.entry.mockImplementation(({ where }) => {
      const query = new PgDialect().sqlToQuery(where);
      expect(query.params).toContain("approved");
      expect(query.params).toContain("known-id");
      return query.params.includes(status) ? { id: "known-id", name: "PRIVATE ROSTER" } : undefined;
    });
    await expect(DetailPage({ params: Promise.resolve({ seasonSlug: "major", entryId: "known-id" }) })).rejects.toThrow("NOT_FOUND");
    expect(mocks.select).not.toHaveBeenCalled();
  });
  it("uses the approved predicate and candidate wording even above 32 teams", async () => {
    mocks.entries.mockImplementation(({ where }) => {
      expect(new PgDialect().sqlToQuery(where).params).toContain("approved");
      return Array.from({ length: 33 }, (_, i) => ({ id: `team-${i}`, name: `Approved ${i}`, registrationStatus: "approved", formationOrder: null, logoUrl: null, representativeUserId: "user" }));
    });
    const html = renderToStaticMarkup(await ListPage({ params: Promise.resolve({ seasonSlug: "major" }) }));
    expect(html).toContain("已通过报名审核的队伍");
    expect(html).toContain("正赛候选池"); expect(html).toContain("Approved 32");
  });

  it("presents Rivals formation order at the page caller", async () => {
    mocks.season.mockResolvedValue({ id: "season", name: "Rivals", competitionTemplate: "rivals", registrationMode: "solo", status: "draft" });
    mocks.entries.mockResolvedValue([{
      id: "team-2",
      name: "Drafted Team",
      registrationStatus: "approved",
      formationOrder: 2,
      logoUrl: null,
      representativeUserId: "user",
    }]);

    const html = renderToStaticMarkup(await ListPage({ params: Promise.resolve({ seasonSlug: "rivals" }) }));

    expect(html).toContain("选秀第 2 顺位");
    expect(html).not.toContain("Draft #2");
  });
});
