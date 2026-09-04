import { describe, expect, it } from "vitest";
import {
  getSeasonLifecycleGroup,
  groupSeasonsByLifecycle,
  presentSeasonLifecycleSummary,
  presentSeasonParticipationState,
  presentSeasonStatus,
  presentStageMarker,
} from "@/lib/seasons/presentation";

describe("season lifecycle directory presentation", () => {
  it.each([
    ["playing", new Date("2026-08-01"), "active"],
    ["voting", null, "active"],
    ["drafting", null, "active"],
    ["registration", new Date("2026-08-01"), "active"],
    ["registration", null, "upcoming"],
    ["draft", null, "draft"],
    ["finished", null, "recent"],
    ["archived", null, "archived"],
  ] as const)("maps %s with registration fact %s to %s", (status, registrationOpenedAt, group) => {
    expect(getSeasonLifecycleGroup({ status, registrationOpenedAt })).toBe(group);
  });

  it("keeps pre-open registration visibly distinct from an operational season", () => {
    expect(presentSeasonLifecycleSummary({ status: "registration", registrationOpenedAt: null })).toBe(
      "已发布 · 报名未开放",
    );
  });

  it("groups every season exactly once in the directory order", () => {
    const seasons = [
      { id: "active", status: "playing" as const, registrationOpenedAt: new Date("2026-08-01") },
      { id: "upcoming", status: "registration" as const, registrationOpenedAt: null },
      { id: "finished", status: "finished" as const },
      { id: "archived", status: "archived" as const },
    ];

    const grouped = groupSeasonsByLifecycle(seasons);

    expect(grouped.active.map((season) => season.id)).toEqual(["active"]);
    expect(grouped.upcoming.map((season) => season.id)).toEqual(["upcoming"]);
    expect(grouped.recent.map((season) => season.id)).toEqual(["finished"]);
    expect(grouped.archived.map((season) => season.id)).toEqual(["archived"]);
    expect(Object.values(grouped).flat()).toHaveLength(seasons.length);
  });
});

describe("season status presentation", () => {
  it("keeps normal UI labels out of internal enum vocabulary", () => {
    expect(presentSeasonStatus("registration")).toEqual({ label: "已发布", tone: "success" });
    expect(presentSeasonStatus("playing")).toEqual({ label: "LIVE", tone: "danger" });
  });

  it("derives public participation labels from the canonical registration window", () => {
    expect(presentSeasonParticipationState({ status: "registration", registrationOpensAt: null, registrationOpenedAt: null, registrationClosesAt: null })).toMatchObject({ label: "报名时间待定" });
    expect(presentSeasonParticipationState({ status: "registration", registrationOpensAt: new Date("2999-01-01"), registrationOpenedAt: null, registrationClosesAt: null })).toMatchObject({ label: "即将开放" });
  });
});

describe("stage marker presentation", () => {
  it("uses the intentional Major marker instead of rendering a stage key directly", () => {
    expect(presentStageMarker({ key: "stage1", name: "阶段一" }, "major")).toBe("STAGE1");
    expect(presentStageMarker({ key: "custom-final", name: "决赛" }, "custom")).toBe("决赛");
  });
});
