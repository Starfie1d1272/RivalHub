import { describe, expect, it } from "vitest";
import { describeAuditDetail } from "@/lib/audit/detail";
import { reliableEventKindV1Schema } from "@/lib/mizar/protocol";

function eventLabel(kind: unknown) {
  return describeAuditDetail("mizar.reliable.accept", { kind }, new Map()).fields.find(field => field.label === "事件")?.value;
}

describe("Mizar reliable audit detail", () => {
  it("names the player snapshot and existing match boundary events", () => {
    expect(eventLabel("map_player_snapshot")).toBe("地图选手临时数据");
    expect(eventLabel("map_started")).toBe("地图开始");
    expect(eventLabel("map_ended")).toBe("地图结束");
    expect(eventLabel("series_ended")).toBe("系列赛结束");
  });

  it("names every supported reliable event and distinguishes unknown from missing", () => {
    for (const kind of reliableEventKindV1Schema.options) {
      expect(eventLabel(kind)).not.toMatch(/^(未记录|未知事件)$/);
    }
    expect(eventLabel("future_event")).toBe("未知事件");
    expect(eventLabel(null)).toBe("未记录");
    expect(eventLabel(undefined)).toBe("未记录");
    expect(eventLabel("")).toBe("未记录");
  });
});
