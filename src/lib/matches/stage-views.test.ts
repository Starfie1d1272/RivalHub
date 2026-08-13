import { describe, expect, it } from "vitest";
import type { BracketData } from "@/lib/bracket";
import { MAJOR_STAGE_PLAN, RIVALS_STAGE_PLAN } from "@/types/season";
import {
  buildStageViews,
  filterLegacyBracketByStageName,
  getTeamsReferencedByMatches,
  hasAdjacentLegacyQualifierPlayoff,
  resolveDefaultStageKey,
} from "./stage-views";

const match = (stage: string, status = "scheduled", teamAId = `${stage}-a`, teamBId = `${stage}-b`) => ({
  stage,
  status,
  teamAId,
  teamBId,
});

describe("stage views", () => {
  it("为 Major 的每个配置阶段建立独立视图", () => {
    const matches = [
      match("stage1", "finished"),
      match("stage2", "scheduled"),
      match("stage3", "cancelled"),
      match("playoff", "finished"),
      match("unknown", "finished"),
    ];

    const { views, unconfiguredMatches } = buildStageViews(MAJOR_STAGE_PLAN, matches);

    expect(views.map(({ stage }) => stage.key)).toEqual(["stage1", "stage2", "stage3", "playoff"]);
    expect(views.map(({ matches: stageMatches }) => stageMatches.map((item) => item.stage))).toEqual([
      ["stage1"],
      ["stage2"],
      ["stage3"],
      ["playoff"],
    ]);
    expect(views.every((view) => !("isComplete" in view))).toBe(true);
    expect(unconfiguredMatches).toEqual([matches[4]]);

    const onlyFirstStage = buildStageViews(MAJOR_STAGE_PLAN, [match("stage1")]);
    expect(onlyFirstStage.views.find((view) => view.stage.key === "stage2")?.matches).toEqual([]);
  });

  it("默认阶段始终来自 stagePlan，并允许选择一个有效阶段", () => {
    const matches = [match("stage1"), match("stage3"), match("unknown")];

    expect(resolveDefaultStageKey(MAJOR_STAGE_PLAN, matches)).toBe("stage3");
    expect(resolveDefaultStageKey(MAJOR_STAGE_PLAN, matches, "stage2")).toBe("stage2");
    expect(resolveDefaultStageKey(MAJOR_STAGE_PLAN, matches, "unknown")).toBe("stage3");
    expect(resolveDefaultStageKey(MAJOR_STAGE_PLAN, [match("unknown")])).toBe("stage1");
    expect(resolveDefaultStageKey(MAJOR_STAGE_PLAN, [])).toBe("stage1");
    expect(resolveDefaultStageKey([], matches)).toBeNull();
  });

  it("保留 Rivals 的排位赛和正赛两阶段合同", () => {
    const { views } = buildStageViews(RIVALS_STAGE_PLAN, [match("qualifier"), match("playoff")]);

    expect(views.map(({ stage }) => stage.key)).toEqual(["qualifier", "playoff"]);
    expect(resolveDefaultStageKey(RIVALS_STAGE_PLAN, views.flatMap((view) => view.matches))).toBe("playoff");
    expect(hasAdjacentLegacyQualifierPlayoff(RIVALS_STAGE_PLAN)).toBe(true);
    expect(hasAdjacentLegacyQualifierPlayoff(MAJOR_STAGE_PLAN)).toBe(false);
  });

  it("积分榜参赛队只取当前阶段比赛涉及的队伍", () => {
    const teams = [{ id: "a" }, { id: "b" }, { id: "other" }];

    expect(getTeamsReferencedByMatches(teams, [
      match("stage1", "finished", "b", "a"),
      match("stage1", "finished", "a", "b"),
    ])).toEqual([
      { id: "a" },
      { id: "b" },
    ]);
  });

  it("淘汰赛视图只保留对应 bracket stage 的节点", () => {
    const data = {
      stage: [
        { id: 1, name: "Playoff A", type: "single_elimination" },
        { id: 2, name: "Playoff B", type: "single_elimination" },
      ],
      match: [
        { id: 11, stage_id: 1, group_id: 101, round_id: 201 },
        { id: 12, stage_id: 2, group_id: 102, round_id: 202 },
      ],
      match_game: [{ id: 21, parent_id: 11 }, { id: 22, parent_id: 12 }],
      participant: [{ id: 1, name: "A" }],
      group: [{ id: 101, stage_id: 1, number: 1 }, { id: 102, stage_id: 2, number: 1 }],
      round: [
        { id: 201, stage_id: 1, group_id: 101, number: 1 },
        { id: 202, stage_id: 2, group_id: 102, number: 1 },
      ],
    } as BracketData;

    const filtered = filterLegacyBracketByStageName(data, "Playoff B");

    expect(filtered.stage.map(({ id }) => id)).toEqual([2]);
    expect(filtered.match.map(({ id }) => id)).toEqual([12]);
    expect(filtered.match_game.map(({ id }) => id)).toEqual([22]);
    expect(filtered.group.map(({ id }) => id)).toEqual([102]);
    expect(filtered.round.map(({ id }) => id)).toEqual([202]);
    expect(filtered.participant).toEqual(data.participant);
  });

  it("legacy bracket adapter 按同名 stage 保留所有匹配记录，名称缺失时返回空投影", () => {
    const data = {
      stage: [
        { id: 1, name: "同名", type: "single_elimination" },
        { id: 2, name: "同名", type: "single_elimination" },
      ],
      match: [], match_game: [], participant: [], group: [], round: [],
    } as BracketData;

    expect(filterLegacyBracketByStageName(data, "同名").stage.map(({ id }) => id)).toEqual([1, 2]);
    expect(filterLegacyBracketByStageName(data, "不存在").stage).toEqual([]);
  });
});
