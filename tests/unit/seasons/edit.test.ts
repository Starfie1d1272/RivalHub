import { describe, expect, it } from "vitest";
import { getSeasonEditCapabilities, planSeasonCreate, planSeasonUpdate } from "@/lib/seasons/edit";
import { unfreezeBuiltInCompetitiveContext } from "@/lib/seasons/lifecycle";
import { seasonFormSchema } from "@/lib/seasons/edit";
import { createMajorTemplate, createRivalsTemplate } from "@/lib/competition/templates";
import type { SeasonRow } from "@/lib/seasons/edit";

const MAJOR_TEMPLATE = createMajorTemplate();
const RIVALS_TEMPLATE = createRivalsTemplate();

function input(overrides?: Record<string, unknown>) {
  return {
    name: "NJU Major 2026",
    slug: "nju-major-2026",
    kind: "Major",
    template: "major" as const,
    themeColor: "#f97316",
    registrationOpensAt: null,
    registrationOpenedAt: null,
    registrationClosesAt: null,
    rosterChangeClosesAt: null,
    endAt: null,
    registrationMode: "team" as const,
    hasCaptainVoting: false,
    hasDraft: false,
    hasCommunityAwards: true,
    minTeamSize: 5,
    maxTeamSize: 9,
    starterCount: 5,
    positions: ["igl", "awper", "opener", "closer", "anchor"],
    stagePlan: MAJOR_TEMPLATE.stagePlan,
    registrationConfig: MAJOR_TEMPLATE.registrationConfig,
    teamRegistrationConfig: MAJOR_TEAM_CONFIG_FROZEN,
    affiliationRules: MAJOR_TEMPLATE.affiliationRules,
    ...overrides,
  };
}

const MAJOR_TEAM_CONFIG_FROZEN = {
  ...MAJOR_TEMPLATE.teamRegistrationConfig,
  competitiveProfile: {
    platform: "perfect_world",
    currentSeasonKey: "S20",
    previousSeasonKey: "S21",
    rankOrder: ["D", "C", "B", "A", "S"],
  },
};

function seasonRow(overrides?: Partial<SeasonRow>): SeasonRow {
  const parsed = seasonFormSchema.parse(input()) as Record<string, unknown>;
  return {
    id: "00000000-0000-0000-0000-0000000000aa",
    slug: parsed.slug as string,
    createdAt: new Date(),
    ...parsed,
    status: "draft",
    competitionTemplate: "major",
    registrationOpenedAt: null,
    ...overrides,
  } as SeasonRow;
}

function parseInput(overrides?: Record<string, unknown>) {
  return seasonFormSchema.parse(input(overrides));
}

describe("planSeasonUpdate template identity", () => {
  it("derives one explicit capability matrix from persisted lifecycle facts", () => {
    expect(getSeasonEditCapabilities({ status: "draft", registrationOpenedAt: null, competitionTemplate: "custom" })).toMatchObject({
      phase: "draft",
      canEditSlug: true,
      canEditTemplate: true,
      canEditPublicRules: true,
      canEditRegistrationOpenSchedule: true,
      canEditRegistrationDeadlines: true,
      canEditFallbackConversion: true,
      canEditMetadata: true,
    });
    expect(getSeasonEditCapabilities({ status: "registration", registrationOpenedAt: null, competitionTemplate: "major" })).toMatchObject({
      phase: "published_preopen",
      canEditSlug: false,
      canEditTemplate: false,
      canEditPublicRules: false,
      canEditRegistrationOpenSchedule: true,
      canEditRegistrationDeadlines: true,
      canEditFallbackConversion: true,
    });
    expect(getSeasonEditCapabilities({ status: "registration", registrationOpenedAt: new Date(), competitionTemplate: "major" })).toMatchObject({
      phase: "registration_opened",
      canEditSlug: false,
      canEditTemplate: false,
      canEditPublicRules: false,
      canEditRegistrationOpenSchedule: false,
      canEditRegistrationDeadlines: true,
      canEditFallbackConversion: false,
    });
    expect(getSeasonEditCapabilities({ status: "playing", registrationOpenedAt: new Date(), competitionTemplate: "major" })).toMatchObject({
      phase: "playing",
      canEditRegistrationDeadlines: false,
      canEditMetadata: true,
    });
    expect(getSeasonEditCapabilities({ status: "archived", registrationOpenedAt: new Date(), competitionTemplate: "major" })).toMatchObject({
      phase: "terminal",
      canEditRegistrationDeadlines: false,
      canEditMetadata: true,
    });
  });

  it("allows a draft slug change but rejects it after publish", () => {
    expect(planSeasonUpdate(seasonRow(), parseInput({ slug: "draft-renamed" })).set.slug).toBe("draft-renamed");
    expect(() => planSeasonUpdate(
      seasonRow({ status: "registration" }),
      parseInput({ slug: "published-renamed" }),
    )).toThrowError(/不能修改 slug/);
  });

  it("allows a draft template switch and canonicalizes the selected template", () => {
    const row = seasonRow({ competitionTemplate: "custom", status: "draft" });
    const parsed = parseInput({
      template: "rivals",
      registrationMode: "team",
      hasCaptainVoting: false,
      hasDraft: false,
    });
    const { template, set } = planSeasonUpdate(row, parsed);
    expect(template).toBe("rivals");
    expect(set.competitionTemplate).toBe("rivals");
    expect(set.registrationMode).toBe("solo");
  });

  it("re-canonicalizes a draft Major even when the client replays the persisted template", () => {
    const tampered = parseInput({
      stagePlan: [{ ...MAJOR_TEMPLATE.stagePlan[0]!, teamCount: 4 }],
      hasDraft: true,
      registrationMode: "solo",
    });
    const { template, set } = planSeasonUpdate(seasonRow(), tampered);
    expect(template).toBe("major");
    expect(set.stagePlan).toEqual(MAJOR_TEMPLATE.stagePlan);
    expect(set.registrationMode).toBe("team");
    expect(set.hasDraft).toBe(false);
  });

  it("a draft Major save canonicalizes tampered team size back to the fixed 5/9/5", () => {
    const parsed = parseInput({ minTeamSize: 6, maxTeamSize: 10, starterCount: 6 });
    const { set } = planSeasonUpdate(seasonRow(), parsed);
    expect(set.minTeamSize).toBe(5);
    expect(set.maxTeamSize).toBe(9);
    expect(set.starterCount).toBe(5);
  });

  it("allows a draft operator to disable community awards and preserves the choice through built-in canonicalization", () => {
    const { set } = planSeasonUpdate(seasonRow(), parseInput({ hasCommunityAwards: false }));
    expect(set.hasCommunityAwards).toBe(false);
  });

  it("rejects a community-awards capability change after publish", () => {
    expect(() => planSeasonUpdate(
      seasonRow({ status: "registration", hasCommunityAwards: true }),
      parseInput({ hasCommunityAwards: false }),
    )).toThrowError(/只有 draft 状态可修改核心赛季配置/);
  });

  it("preserves only a Major's reviewed 5E fallback overlay on create and draft update", () => {
    const fallbackConversion = {
      sourcePlatform: "fivee" as const,
      version: "major-2026-v1",
      seasonKeyMap: { s19: "5e-s19", s20: "5e-s20", s21: "5e-s21" },
      mapping: { belowSRankMap: { S: "A" }, starSegments: [{minStar:0,maxStar:null,targetRank:"A",targetStarFloor:null,slopeNum:0,slopeDen:1}], relativeSeasonAlignment: true },
    };
    const parsed = parseInput({
      teamRegistrationConfig: {
        ...MAJOR_TEAM_CONFIG_FROZEN,
        allowExternal: false,
        competitiveProfile: { ...MAJOR_TEAM_CONFIG_FROZEN.competitiveProfile, platform: "fivee", fallbackConversion },
      },
    });

    for (const set of [planSeasonCreate(parsed).set, planSeasonUpdate(seasonRow(), parsed).set]) {
      expect(set.teamRegistrationConfig).toMatchObject({
        ...MAJOR_TEMPLATE.teamRegistrationConfig,
        competitiveProfile: { ...MAJOR_TEMPLATE.teamRegistrationConfig.competitiveProfile, fallbackConversion },
      });
      expect(set.teamRegistrationConfig?.allowExternal).toBe(MAJOR_TEMPLATE.teamRegistrationConfig.allowExternal);
      expect(set.teamRegistrationConfig?.competitiveProfile?.platform).toBe("perfect_world");
    }
  });

  it("accepts an incomplete draft fallback map and defers completeness to registration freeze", () => {
    expect(() => parseInput({
      teamRegistrationConfig: {
        ...MAJOR_TEAM_CONFIG_FROZEN,
        competitiveProfile: {
          ...MAJOR_TEAM_CONFIG_FROZEN.competitiveProfile,
          fallbackConversion: { sourcePlatform: "fivee", version: "", seasonKeyMap: {}, mapping: { belowSRankMap: {}, starSegments: [{minStar:0,maxStar:null,targetRank:"A",targetStarFloor:null,slopeNum:0,slopeDen:1}], relativeSeasonAlignment: true } },
        },
      },
    })).not.toThrow();
  });

  it("a draft Rivals save canonicalizes tampered team size back to the fixed 7/7/5", () => {
    const row = seasonRow({ competitionTemplate: "rivals", status: "draft" });
    const parsed = seasonFormSchema.parse({
      ...input({
        template: "rivals",
        kind: "Rivals",
        registrationMode: "solo",
        hasCaptainVoting: true,
        hasDraft: true,
        minTeamSize: 5,
        maxTeamSize: 9,
        starterCount: 6,
        stagePlan: RIVALS_TEMPLATE.stagePlan,
      }),
    });
    const { set } = planSeasonUpdate(row, parsed);
    expect(set.minTeamSize).toBe(7);
    expect(set.maxTeamSize).toBe(7);
    expect(set.starterCount).toBe(5);
  });

  it("a draft custom season shaped exactly like Rivals stays custom with its own input", () => {
    const row = seasonRow({ competitionTemplate: "custom", status: "draft" });
    const parsed = seasonFormSchema.parse({
      ...input({
        template: "custom",
        kind: "Rivals",
        registrationMode: "solo",
        hasCaptainVoting: true,
        hasDraft: true,
        stagePlan: RIVALS_TEMPLATE.stagePlan,
        minTeamSize: 7,
        maxTeamSize: 7,
      }),
    });
    const { template, set } = planSeasonUpdate(row, parsed);
    expect(template).toBe("custom");
    expect(set.stagePlan).toEqual(RIVALS_TEMPLATE.stagePlan);
    expect(set.registrationMode).toBe("solo");
    expect(set.hasDraft).toBe(true);
  });

  it("a non-draft metadata edit only writes metadata and never touches the frozen competitive context", () => {
    const row = seasonRow({ status: "registration" });
    const parsed = parseInput({ name: "Renamed Major", themeColor: "#112233" });
    const { template, set } = planSeasonUpdate(row, parsed);
    expect(template).toBe("major");
    expect(set.name).toBe("Renamed Major");
    expect(set).not.toHaveProperty("stagePlan");
    expect(set).not.toHaveProperty("teamRegistrationConfig");
    expect(set).not.toHaveProperty("registrationConfig");
  });

  it("a non-draft core change is refused", () => {
    const row = seasonRow({ status: "registration" });
    const parsed = parseInput({ maxTeamSize: 12 });
    expect(() => planSeasonUpdate(row, parsed)).toThrowError(/只有 draft 状态可修改核心赛季配置/);
  });

  it("refuses every published registrationConfig delta instead of silently ignoring it", () => {
    const row = seasonRow({ status: "registration" });
    const parsed = parseInput({
      registrationConfig: {
        ...MAJOR_TEMPLATE.registrationConfig,
        screenshotCount: MAJOR_TEMPLATE.registrationConfig.screenshotCount + 1,
      },
    });
    expect(() => planSeasonUpdate(row, parsed)).toThrowError(/只有 draft 状态可修改核心赛季配置/);
  });

  it("allows a published pre-open schedule edit but freezes the schedule after actual opening", () => {
    const openedAt = new Date("2026-05-01T02:00:00.000Z");
    const row = seasonRow({
      status: "registration",
      registrationOpenedAt: null,
      registrationOpensAt: null,
    });
    const preOpen = planSeasonUpdate(row, parseInput({ registrationOpensAt: "2026-05-01T10:00" }));
    expect(preOpen.set.registrationOpensAt).toEqual(openedAt);

    const openedRow = seasonRow({
      status: "registration",
      registrationOpenedAt: openedAt,
      registrationOpensAt: openedAt,
    });
    expect(() => planSeasonUpdate(openedRow, parseInput({ registrationOpensAt: "2026-05-02T10:00" }))).toThrowError(/不能修改报名开放时间/);
  });

  it("allows only a Major fallback delta before open and freezes it at actual open", () => {
    const fallbackConversion = {
      sourcePlatform: "fivee" as const,
      version: "major-2026-v1",
      seasonKeyMap: { S21: "5e-s21" },
      mapping: { belowSRankMap: { S: "A" }, starSegments: [{minStar:0,maxStar:null,targetRank:"A",targetStarFloor:null,slopeNum:0,slopeDen:1}], relativeSeasonAlignment: true },
    };
    const withFallback = parseInput({
      teamRegistrationConfig: {
        ...MAJOR_TEAM_CONFIG_FROZEN,
        competitiveProfile: { ...MAJOR_TEAM_CONFIG_FROZEN.competitiveProfile, fallbackConversion },
      },
    });
    const preOpen = planSeasonUpdate(seasonRow({ status: "registration" }), withFallback);
    expect(preOpen.set.teamRegistrationConfig?.competitiveProfile?.fallbackConversion).toEqual(fallbackConversion);
    expect(preOpen.set.teamRegistrationConfig?.allowExternal).toBe(MAJOR_TEAM_CONFIG_FROZEN.allowExternal);
    expect(preOpen.set).not.toHaveProperty("registrationConfig");

    expect(() => planSeasonUpdate(seasonRow({ status: "registration", registrationOpenedAt: new Date() }), withFallback)).toThrowError(/只有 draft 状态可修改核心赛季配置/);
    expect(() => planSeasonUpdate(seasonRow({ status: "registration" }), parseInput({
      teamRegistrationConfig: {
        ...MAJOR_TEAM_CONFIG_FROZEN,
        allowExternal: false,
        competitiveProfile: { ...MAJOR_TEAM_CONFIG_FROZEN.competitiveProfile, fallbackConversion },
      },
    }))).toThrowError(/只有 draft 状态可修改核心赛季配置/);
  });

  it("keeps registration deadlines operational through pre-playing phases and locks them at playing", () => {
    const openedAt = new Date("2026-05-01T02:00:00.000Z");
    const currentClose = new Date("2026-05-02T02:00:00.000Z");
    const currentRoster = new Date("2026-05-03T02:00:00.000Z");
    const row = seasonRow({
      status: "voting",
      registrationOpenedAt: openedAt,
      registrationOpensAt: openedAt,
      registrationClosesAt: currentClose,
      rosterChangeClosesAt: currentRoster,
    });
    const updated = planSeasonUpdate(row, parseInput({
      registrationOpensAt: "2026-05-01T10:00",
      registrationClosesAt: "2026-05-04T10:00",
      rosterChangeClosesAt: "2026-05-05T10:00",
    }));
    expect(updated.set.registrationClosesAt).toEqual(new Date("2026-05-04T02:00:00.000Z"));
    expect(updated.set.rosterChangeClosesAt).toEqual(new Date("2026-05-05T02:00:00.000Z"));

    const playingRow = seasonRow({ ...row, status: "playing" });
    expect(() => planSeasonUpdate(playingRow, parseInput({
      registrationOpensAt: "2026-05-01T10:00",
      registrationClosesAt: "2026-05-04T10:00",
      rosterChangeClosesAt: "2026-05-05T10:00",
    }))).toThrowError(/不能修改报名运营截止时间/);
  });

  it("keeps name, theme and endAt as editable metadata after publish", () => {
    const openedAt = new Date("2026-05-01T02:00:00.000Z");
    const result = planSeasonUpdate(seasonRow({
      status: "playing",
      registrationOpenedAt: openedAt,
      registrationOpensAt: openedAt,
    }), parseInput({
      name: "Renamed Major",
      themeColor: "#112233",
      registrationOpensAt: "2026-05-01T10:00",
      endAt: "2026-06-01T10:00",
    }));
    expect(result.set.name).toBe("Renamed Major");
    expect(result.set.themeColor).toBe("#112233");
    expect(result.set.endAt).toEqual(new Date("2026-06-01T02:00:00.000Z"));
    expect(result.set).not.toHaveProperty("stagePlan");
  });

  it("a non-draft template switch is refused", () => {
    const row = seasonRow({ status: "registration" });
    const parsed = parseInput({ template: "rivals" });
    expect(() => planSeasonUpdate(row, parsed)).toThrowError(/只有 draft 状态可切换赛事体系/);
  });
});

describe("unfreezeBuiltInCompetitiveContext", () => {
  it("resets a published Major's frozen catalog context back to the draft template context", () => {
    const result = unfreezeBuiltInCompetitiveContext({
      competitionTemplate: "major",
      teamRegistrationConfig: MAJOR_TEAM_CONFIG_FROZEN,
    });
    expect(result?.requireCompetitiveProfile).toBe(true);
    expect(result?.competitiveProfile).toEqual({
      platform: "perfect_world",
      currentSeasonKey: "",
      previousSeasonKey: "",
      rankOrder: [],
      externalStrengthMaxStarGap: 3,
    });
  });

  it("leaves custom seasons untouched", () => {
    const result = unfreezeBuiltInCompetitiveContext({
      competitionTemplate: "custom",
      teamRegistrationConfig: MAJOR_TEAM_CONFIG_FROZEN,
    });
    expect(result).toBeNull();
  });

  it("does not change seasons without a competitive profile requirement", () => {
    const config = { ...createMajorTemplate().teamRegistrationConfig, requireCompetitiveProfile: false };
    expect(unfreezeBuiltInCompetitiveContext({ competitionTemplate: "major", teamRegistrationConfig: config })).toBeNull();
  });
});
