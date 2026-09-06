import { describe, expect, it } from "vitest";
import { normalizeTeamDirectoryQuery } from "@/lib/teams/directory-contract";

describe("队伍目录查询参数", () => {
  it("对非法状态、排序和招募标记使用确定性默认值", () => {
    expect(normalizeTeamDirectoryQuery(new URLSearchParams({
      q: "  Alpha  ",
      status: "unknown",
      recruiting: "yes",
      sort: "recent",
    }))).toEqual({
      q: "Alpha",
      status: "active",
      recruiting: false,
      sort: "default",
    });
  });

  it("保留有效的历史、招募和成员排序条件", () => {
    expect(normalizeTeamDirectoryQuery(new URLSearchParams({
      status: "history",
      recruiting: "true",
      sort: "members_desc",
    }))).toEqual({
      q: undefined,
      status: "history",
      recruiting: true,
      sort: "members_desc",
    });
  });
});
