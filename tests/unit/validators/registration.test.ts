import { describe, expect, it } from "vitest";
import { buildRegistrationSchema } from "@/lib/validators/registration";
import { REGISTRATION_DEFAULTS } from "@/lib/config/registration-defaults";

const positions = [...REGISTRATION_DEFAULTS.positions.values];

function validInput() {
  return {
    seasonId: "00000000-0000-0000-0000-000000000001",
    email: "test@nju.edu.cn",
    studentId: "20190001",
    playerType: "enrolled",
    qq: "1234567890",
    perfectName: "测试选手",
    steamName: "testPlayer",
    steam64: "76561198000000001",
    steamProfileUrl: "https://steamcommunity.com/id/testPlayer",
    primaryPosition: "opener",
    secondaryPosition: "awper",
    peakRank: "A+",
    peakRankSeason: "S1 2025",
    peakRating: 2.05,
    peakWe: 10.5,
    currentSeasonPeakRank: "A",
    currentRating: 1.95,
    currentWe: 8.0,
    screenshotUrls: ["https://box.nju.edu.cn/some-link"],
    mapPreferences: [
      { map: "de_mirage", level: "strong" },
      { map: "de_inferno", level: "proficient" },
      { map: "de_nuke", level: "playable" },
      { map: "de_ancient", level: "basic" },
      { map: "de_dust2", level: "basic" },
      { map: "de_anubis", level: "basic" },
      { map: "de_train", level: "none" },
    ],
    gameplayStyle: "进攻型步枪手",
    competitionHistory: "参加过校级比赛",
    willingToBeCaptain: true,
    antiCheatPledge: true as const,
  };
}

describe("buildRegistrationSchema", () => {
  const schema = buildRegistrationSchema(null, positions);

  it("接受合法报名数据", () => {
    expect(schema.safeParse(validInput()).success).toBe(true);
  });

  it("拒绝无效 email", () => {
    const r = schema.safeParse({ ...validInput(), email: "notanemail" });
    expect(r.success).toBe(false);
  });

  it("拒绝 QQ 格式错误", () => {
    const r = schema.safeParse({ ...validInput(), qq: "123" });
    expect(r.success).toBe(false);
  });

  it("拒绝非 17 位 steam64", () => {
    const r = schema.safeParse({ ...validInput(), steam64: "123" });
    expect(r.success).toBe(false);
  });

  it("拒绝非 steamcommunity.com 链接", () => {
    const r = schema.safeParse({
      ...validInput(),
      steamProfileUrl: "https://example.com/profile",
    });
    expect(r.success).toBe(false);
  });

  it("拒绝主次位置相同", () => {
    const r = schema.safeParse({
      ...validInput(),
      primaryPosition: "opener",
      secondaryPosition: "opener",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const issue = r.error.issues.find(
        (i) => i.path[0] === "secondaryPosition"
      );
      expect(issue).toBeDefined();
    }
  });

  it("拒绝段位门槛不达标（2 项都不够）", () => {
    const r = schema.safeParse({
      ...validInput(),
      currentSeasonPeakRank: "D",
      peakRank: "D",
    });
    expect(r.success).toBe(false);
  });

  it("段位门槛：仅 current 达标也通过", () => {
    const r = schema.safeParse({
      ...validInput(),
      currentSeasonPeakRank: "A",
      peakRank: "D",
    });
    expect(r.success).toBe(true);
  });

  it("段位门槛：仅 peak 达标也通过", () => {
    const r = schema.safeParse({
      ...validInput(),
      currentSeasonPeakRank: "D",
      peakRank: "A+",
    });
    expect(r.success).toBe(true);
  });

  it("接受截图链接为空", () => {
    const r = schema.safeParse({
      ...validInput(),
      screenshotUrls: [],
    });
    expect(r.success).toBe(true);
  });

  it("拒绝能打地图少于 3 张", () => {
    const r = schema.safeParse({
      ...validInput(),
      mapPreferences: [
        { map: "de_mirage", level: "strong" },
        { map: "de_inferno", level: "basic" },
        { map: "de_nuke", level: "basic" },
        { map: "de_ancient", level: "basic" },
        { map: "de_dust2", level: "basic" },
        { map: "de_anubis", level: "basic" },
        { map: "de_train", level: "none" },
      ],
    });
    expect(r.success).toBe(false);
  });

  it("拒绝强图超过 3 张", () => {
    const r = schema.safeParse({
      ...validInput(),
      mapPreferences: [
        { map: "de_mirage", level: "strong" },
        { map: "de_inferno", level: "strong" },
        { map: "de_nuke", level: "strong" },
        { map: "de_ancient", level: "strong" },
        { map: "de_dust2", level: "playable" },
        { map: "de_anubis", level: "basic" },
        { map: "de_train", level: "none" },
      ],
    });
    expect(r.success).toBe(false);
  });

  it("拒绝未勾选反作弊承诺", () => {
    const r = schema.safeParse({
      ...validInput(),
      antiCheatPledge: false,
    });
    expect(r.success).toBe(false);
  });

  it("接受可选字段为空", () => {
    const r = schema.safeParse({
      ...validInput(),
      peakWe: undefined,
      currentWe: undefined,
      competitionHistory: undefined,
      highlightVideoUrl: undefined,
      notes: undefined,
    });
    expect(r.success).toBe(true);
  });

  it("Rating 精度最多两位小数", () => {
    const r = schema.safeParse({ ...validInput(), peakRating: 2.055 });
    expect(r.success).toBe(false);
  });

  it("WE 精度最多一位小数", () => {
    const r = schema.safeParse({ ...validInput(), peakWe: 10.55 });
    expect(r.success).toBe(false);
  });

  it("Rating 范围校验 (0.01-3.00)", () => {
    expect(schema.safeParse({ ...validInput(), peakRating: 0 }).success).toBe(
      false
    );
    expect(schema.safeParse({ ...validInput(), peakRating: 4.0 }).success).toBe(
      false
    );
  });

  it("WE 范围校验 (0.0-16.0)", () => {
    expect(
      schema.safeParse({ ...validInput(), peakWe: -1 }).success
    ).toBe(false);
    expect(
      schema.safeParse({ ...validInput(), peakWe: 20 }).success
    ).toBe(false);
  });

  it("gameplayStyle 不超过 100 字", () => {
    const r = schema.safeParse({
      ...validInput(),
      gameplayStyle: "测".repeat(101),
    });
    expect(r.success).toBe(false);
  });
});

describe("buildRegistrationSchema 位置配置化", () => {
  it("允许自定义位置列表", () => {
    const custom = buildRegistrationSchema(null, ["opener", "closer"]);
    const r = custom.safeParse({
      ...validInput(),
      primaryPosition: "closer",
      secondaryPosition: "opener",
    });
    expect(r.success).toBe(true);
  });

  it("拒绝不在自定义位置列表中的值", () => {
    const custom = buildRegistrationSchema(null, ["opener", "closer"]);
    const r = custom.safeParse({
      ...validInput(),
      primaryPosition: "awper",
      secondaryPosition: "opener",
    });
    expect(r.success).toBe(false);
  });
});

describe("buildRegistrationSchema 段位门槛配置化", () => {
  it("尊重 null 门槛（无限制）", () => {
    const schema = buildRegistrationSchema(
      { rankThreshold: { currentMin: null, peakMin: null } },
      positions
    );
    const r = schema.safeParse({
      ...validInput(),
      currentSeasonPeakRank: "D",
      peakRank: "D",
    });
    expect(r.success).toBe(true);
  });

  it("自定义门槛过滤", () => {
    const schema = buildRegistrationSchema(
      { rankThreshold: { currentMin: "B++", peakMin: "A" } },
      positions
    );
    const r = schema.safeParse({
      ...validInput(),
      currentSeasonPeakRank: "B",
      peakRank: "B",
    });
    expect(r.success).toBe(false);
  });
});

describe("buildRegistrationSchema playerType 过滤", () => {
  it("只允许 enrolled", () => {
    const schema = buildRegistrationSchema(
      { allowedPlayerTypes: ["enrolled"] },
      positions
    );
    {
      const r = schema.safeParse({ ...validInput(), playerType: "enrolled" });
      expect(r.success).toBe(true);
    }
    {
      const r = schema.safeParse({ ...validInput(), playerType: "graduated" });
      expect(r.success).toBe(false);
    }
  });
});
