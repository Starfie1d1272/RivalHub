import { describe, it, expect } from "vitest";
import {
  evaluateStartingLineup,
  type LineupMemberFact,
} from "@/lib/match-rosters/lineup";
import type { InstitutionAffiliationRule } from "@/types/season";

const DEFAULT_POLICY = { starterCount: 5, maxSubstitutes: 2 } as const;

const NJU_RULE: InstitutionAffiliationRule = {
  institutionCode: "4132010284",
  eligibleAcademicStatuses: ["enrolled", "graduated"],
  minRosterMembers: 3,
  minStartingMembers: 3,
};

type Verification = NonNullable<LineupMemberFact["verification"]>;
type VerificationOverride = Partial<Verification>;

interface FixtureMember {
  eventRosterMemberId: string;
  userId: string;
  verification: Verification | null;
}

interface World {
  memberFacts: Map<string, LineupMemberFact>;
  /** Select eventRosterMemberIds by index in ascending order given. */
  ids: (...indices: number[]) => string[];
  allIds: () => string[];
  rosterUserIds: (...indices: number[]) => Set<string>;
}

function makeMember(
  index: number,
  institutionCode: string | null,
  overrides?: VerificationOverride,
): FixtureMember {
  return {
    eventRosterMemberId: `member-${index}`,
    userId: `user-${index}`,
    verification: institutionCode
      ? {
          institutionCode,
          academicStatus: "enrolled",
          status: "approved",
          ...(overrides ?? {}),
        }
      : null,
  };
}

/** Unaffiliated member without any education link (never on a frozen roster). */
function plain(index: number): FixtureMember {
  return makeMember(index, null);
}

/** Verified NJU-affiliated member. */
function nju(index: number, overrides?: VerificationOverride): FixtureMember {
  return makeMember(index, "4132010284", overrides);
}

/** Verified member of another institution. */
function otherInstitution(index: number): FixtureMember {
  return makeMember(index, "4111010001");
}

function buildWorld(members: readonly FixtureMember[]): World {
  const memberFacts = new Map<string, LineupMemberFact>();
  for (const m of members) memberFacts.set(m.eventRosterMemberId, m);
  return {
    memberFacts,
    ids: (...indices: number[]) =>
      indices.map((i) => `member-${i}`),
    allIds: () => [...memberFacts.keys()],
    rosterUserIds: (...indices: number[]) =>
      new Set(indices.map((i) => `user-${i}`)),
  };
}

describe("evaluateStartingLineup — structural rules", () => {
  it("fails when fewer than 5 starters", () => {
    const world = buildWorld([plain(1), plain(2), plain(3), plain(4)]);
    const result = evaluateStartingLineup({
      starterIds: world.ids(1, 2, 3, 4), policy: DEFAULT_POLICY,
      memberFacts: world.memberFacts,
    });
    expect(result.valid).toBe(false);
    expect(result.blockers.some((b) => b.includes("必须选择 5 名首发"))).toBe(true);
  });

  it("fails with 6 starters", () => {
    const world = buildWorld(Array.from({ length: 6 }, (_, i) => plain(i + 1)));
    const result = evaluateStartingLineup({
      starterIds: world.allIds(), policy: DEFAULT_POLICY,
      memberFacts: world.memberFacts,
    });
    expect(result.valid).toBe(false);
    expect(result.blockers.some((b) => b.includes("必须选择 5 名首发"))).toBe(true);
  });

  it("fails with more than 2 substitutes", () => {
    const world = buildWorld(Array.from({ length: 9 }, (_, i) => plain(i + 1)));
    const result = evaluateStartingLineup({
      starterIds: world.ids(1, 2, 3, 4, 5), policy: DEFAULT_POLICY,
      substituteIds: world.ids(6, 7, 8),
      memberFacts: world.memberFacts,
    });
    expect(result.valid).toBe(false);
    expect(result.blockers.some((b) => b.includes("替补不能超过"))).toBe(true);
  });

  it("fails on duplicate selection across starters and substitutes", () => {
    const world = buildWorld([plain(1), plain(2), plain(3), plain(4), plain(5)]);
    const dupId = world.ids(1)[0]!;
    const result = evaluateStartingLineup({
      starterIds: [dupId, ...world.ids(2, 3, 4, 5)], policy: DEFAULT_POLICY,
      substituteIds: [dupId],
      memberFacts: world.memberFacts,
    });
    expect(result.valid).toBe(false);
    expect(result.blockers.some((b) => b.includes("重复选择"))).toBe(true);
  });

  it("fails when a selected player is not a member of the team", () => {
    const world = buildWorld([plain(1), plain(2), plain(3), plain(4), plain(5)]);
    const result = evaluateStartingLineup({
      starterIds: [...world.ids(1, 2, 3, 4), "member-alien"], policy: DEFAULT_POLICY,
      memberFacts: world.memberFacts,
    });
    expect(result.valid).toBe(false);
    expect(result.blockers.some((b) => b.includes("不属于本队"))).toBe(true);
  });
});

describe("evaluateStartingLineup — Major frozen roster & affiliation rules", () => {
  const rules = [NJU_RULE];

  it("rejects an outsider who is not on the frozen tournament roster", () => {
    // Members 1–5 are selectable for the canonical team; user-5 is missing from
    // the frozen tournament roster.
    const world = buildWorld([
      nju(1), nju(2), nju(3), otherInstitution(4), otherInstitution(5),
    ]);
    const result = evaluateStartingLineup({
      starterIds: world.ids(1, 2, 3, 4, 5), policy: DEFAULT_POLICY,
      memberFacts: world.memberFacts,
      frozenRosterUserIds: world.rosterUserIds(1, 2, 3, 4),
      affiliationRules: rules,
    });
    expect(result.valid).toBe(false);
    expect(result.blockers.some((b) => b.includes("冻结名单"))).toBe(true);
  });

  it("rejects an outside substitute too", () => {
    const world = buildWorld([nju(1), nju(2), nju(3), otherInstitution(4), otherInstitution(5), nju(9)]);
    const result = evaluateStartingLineup({
      starterIds: world.ids(1, 2, 3, 4, 5), policy: DEFAULT_POLICY,
      substituteIds: ["member-9"],
      memberFacts: world.memberFacts,
      frozenRosterUserIds: world.rosterUserIds(1, 2, 3, 4, 5),
      affiliationRules: rules,
    });
    expect(result.valid).toBe(false);
    expect(result.blockers.some((b) => b.includes("冻结名单"))).toBe(true);
  });

  it("enforces at least 3 verified NJU starters from the frozen rule snapshot", () => {
    const world = buildWorld([
      nju(1), nju(2), otherInstitution(3), otherInstitution(4), otherInstitution(5),
    ]);
    const result = evaluateStartingLineup({
      starterIds: world.allIds(), policy: DEFAULT_POLICY,
      memberFacts: world.memberFacts,
      frozenRosterUserIds: world.rosterUserIds(1, 2, 3, 4, 5),
      affiliationRules: rules,
    });
    expect(result.valid).toBe(false);
    expect(
      result.blockers.some((b) => b.includes("南京大学成员 2 人") && b.includes("还缺 1 人")),
    ).toBe(true);
  });

  it("passes with exactly 3 verified NJU starters; validator reads only the passed rules", () => {
    // The caller passes rules read from the StageRun snapshot — nothing here can
    // reach mutable season config, so passing legality depends solely on the
    // frozen values.
    const world = buildWorld([
      nju(1), nju(2), nju(3), otherInstitution(4), otherInstitution(5),
    ]);
    const result = evaluateStartingLineup({
      starterIds: world.allIds(), policy: DEFAULT_POLICY,
      memberFacts: world.memberFacts,
      frozenRosterUserIds: world.rosterUserIds(1, 2, 3, 4, 5),
      affiliationRules: rules,
    });
    expect(result.valid).toBe(true);
    expect(result.affiliatedStarterCounts.get("4132010284")).toBe(3);
  });

  it("treats rejected/pending education verifications as lost eligibility", () => {
    const world = buildWorld([
      nju(1),
      nju(2),
      nju(3),
      nju(4, { status: "rejected" }),
      nju(5, { status: "pending" }),
    ]);
    const result = evaluateStartingLineup({
      starterIds: world.allIds(), policy: DEFAULT_POLICY,
      memberFacts: world.memberFacts,
      frozenRosterUserIds: world.rosterUserIds(1, 2, 3, 4, 5),
      affiliationRules: rules,
    });
    expect(result.valid).toBe(false);
    expect(result.blockers.some((b) => b.includes("失去本届比赛资格"))).toBe(true);
    // Later-rejected members no longer count toward the affiliation minimum,
    // which independently produces its own blocker.
    expect(
      result.blockers.some(
        (b) => b.includes("南京大学成员 3 人") || b.includes("南京大学成员 2 人"),
      ),
    ).toBe(false);
  });

  it("counts graduated NJU members when the frozen rule allows graduated", () => {
    const world = buildWorld([
      nju(1),
      nju(2),
      nju(3, { academicStatus: "graduated" }),
      otherInstitution(4),
      otherInstitution(5),
    ]);
    const graduatedRule: InstitutionAffiliationRule = { ...NJU_RULE, minStartingMembers: 2 };
    const result = evaluateStartingLineup({
      starterIds: world.allIds(), policy: DEFAULT_POLICY,
      memberFacts: world.memberFacts,
      frozenRosterUserIds: world.rosterUserIds(1, 2, 3, 4, 5),
      affiliationRules: [graduatedRule],
    });
    expect(result.valid).toBe(true);
    expect(result.affiliatedStarterCounts.get("4132010284")).toBe(3);
  });

  it("does not let substitutes satisfy the starter minimum", () => {
    // Only 2 NJU starters; a 3rd NJU player sits on the bench.
    const world = buildWorld([
      nju(1), nju(2), otherInstitution(3), otherInstitution(4), otherInstitution(5), nju(6),
    ]);
    const result = evaluateStartingLineup({
      starterIds: world.ids(1, 2, 3, 4, 5), policy: DEFAULT_POLICY,
      substituteIds: world.ids(6),
      memberFacts: world.memberFacts,
      frozenRosterUserIds: world.rosterUserIds(1, 2, 3, 4, 5, 6),
      affiliationRules: rules,
    });
    expect(result.valid).toBe(false);
    expect(result.blockers.some((b) => b.includes("还缺 1 人"))).toBe(true);
  });
});

describe("evaluateStartingLineup — non-Major matches", () => {
  it("skips affiliation and frozen-roster checks without rules (manual seasons)", () => {
    const world = buildWorld([plain(1), plain(2), plain(3), plain(4), plain(5), plain(6)]);
    const all = world.allIds();
    const result = evaluateStartingLineup({
      starterIds: all.slice(0, 5), policy: DEFAULT_POLICY,
      substituteIds: all.slice(5, 6),
      memberFacts: world.memberFacts,
    });
    expect(result.valid).toBe(true);
  });
});
