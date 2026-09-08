import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  entry: vi.fn(),
  eventRoster: vi.fn(),
  matches: vi.fn(),
  opponents: vi.fn(),
  select: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: {
    query: {
      competitionEntries: { findFirst: mocks.entry, findMany: mocks.opponents },
      eventRosters: { findFirst: mocks.eventRoster },
      matches: { findMany: mocks.matches },
    },
    select: mocks.select,
  },
}));

import { getPublicCompetitionEntryTeamContext } from "@/lib/competition-entries/public-team-context";

describe("getPublicCompetitionEntryTeamContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.entry.mockImplementation(({ where }) => {
      const query = new PgDialect().sqlToQuery(where);
      expect(query.params).toContain("approved");
      expect(query.params).toContain("entry-1");
      return Promise.resolve({
        id: "entry-1",
        name: "Frozen Event Name",
        logoUrl: "https://example.test/event.png",
        registrationStatus: "approved",
        representativeUserId: "representative-1",
        teamId: "team-1",
      });
    });
    mocks.eventRoster.mockResolvedValue({ status: "frozen" });
    mocks.matches.mockResolvedValue([{
      id: "match-1",
      seasonId: "season-1",
      entryAId: "entry-1",
      entryBId: "entry-2",
      status: "finished",
      isForfeit: false,
      scoreA: 1,
      scoreB: 0,
      scheduledAt: new Date("2026-08-10T00:00:00Z"),
      completedAt: new Date("2026-08-10T01:00:00Z"),
    }]);
    mocks.opponents.mockResolvedValue([{ id: "entry-2", name: "Opponent Snapshot" }]);
    const selectChain = {
      from: () => selectChain,
      innerJoin: () => selectChain,
      where: () => Promise.resolve([
        { userId: "representative-1", displayName: "Current Name", perfectName: null, steamName: null, isStarter: true },
      ]),
    };
    mocks.select.mockReturnValue(selectChain);
  });

  it("keeps event snapshot identity and EventRoster facts separate from mutable registration positions", async () => {
    const context = await getPublicCompetitionEntryTeamContext(
      { id: "season-1", slug: "autumn-2026", name: "2026 秋季赛", status: "playing" },
      "entry-1",
    );

    expect(context).toMatchObject({
      entry: {
        name: "Frozen Event Name",
        logoUrl: "https://example.test/event.png",
        teamId: "team-1",
      },
      rosterStatus: "frozen",
      roster: [{ userId: "representative-1", name: "Current Name", isStarter: true, isRepresentative: true }],
      record: { played: 1, wins: 1, losses: 0 },
      matches: [{ opponentName: "Opponent Snapshot", ownScore: 1, opponentScore: 0 }],
    });
    expect(JSON.stringify(context)).not.toContain("primaryPosition");
  });
});
