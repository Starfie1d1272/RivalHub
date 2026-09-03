import { describe, it, expect } from "vitest";
import { getTeamDirectoryCta } from "@/lib/teams/presentation";
import { toLongLivedTeamDto } from "@/lib/teams/workspace";

describe("队伍目录入口", () => {
  it.each([
    [true, 3, { href: "/my/teams", label: "管理我的队伍" }],
    [false, 2, { href: "/my/teams", label: "处理队伍邀请" }],
    [false, 0, { href: "/my/teams#create-team", label: "创建队伍" }],
  ] as const)("按当前 Team 与 pending invitation 选择 CTA", (currentTeam, invitationCount, expected) => {
    expect(getTeamDirectoryCta(currentTeam, invitationCount)).toEqual(expected);
  });
});

/** /my/teams 必须只把白名单 DTO 传给 Client Component，不能透传完整 DB row。 */
describe("toLongLivedTeamDto", () => {
  it("只保留 Client 所需字段，丢弃 DB 行的内部字段", () => {
    const row = Object.assign(
      {
        id: "0b7f9d0a-0000-4000-8000-000000000001",
        slug: "test-team",
        name: "测试队伍",
        description: null,
        captainUserId: "0b7f9d0a-0000-4000-8000-000000000002",
      },
      {
        creatorUserId: "0b7f9d0a-0000-4000-8000-000000000003",
        status: "active",
        logoUrl: "https://example.com/logo.png",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-02T00:00:00Z"),
        disbandedAt: null,
        disbandedBy: null,
      },
    );

    const dto = toLongLivedTeamDto(row);

    expect(dto).toEqual({
      id: row.id,
      slug: row.slug,
      name: row.name,
      logoUrl: row.logoUrl,
      description: null,
      captainUserId: row.captainUserId,
    });
    expect(Object.keys(dto).sort()).toEqual(["captainUserId", "description", "id", "logoUrl", "name", "slug"]);
    expect("creatorUserId" in dto).toBe(false);
    expect("createdAt" in dto).toBe(false);
    expect("status" in dto).toBe(false);
    expect(dto.logoUrl).toBe(row.logoUrl);
  });

  it("保留描述等 Team identity 字段", () => {
    const dto = toLongLivedTeamDto({
      id: "0b7f9d0a-0000-4000-8000-000000000001",
      slug: "another-team",
      name: "另一支队伍",
      logoUrl: null,
      description: "招新中",
      captainUserId: "0b7f9d0a-0000-4000-8000-000000000002",
    });
    expect(dto.description).toBe("招新中");
  });
});
