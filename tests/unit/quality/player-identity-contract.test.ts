import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import type { PublicPlayerIdentity } from "@/lib/identity/public-player";

type ConsumerMode = "avatar" | "delegate" | "text-first";
type Consumer = {
  path: string;
  mode: ConsumerMode;
  reason?: string;
  delegatesTo?: string;
};

// This inventory is the review surface for public player identity links. New
// direct links must make an explicit presentation choice before they land.
const PLAYER_IDENTITY_CONSUMERS: Consumer[] = [
  { path: "src/app/[seasonSlug]/players/page.tsx", mode: "delegate", delegatesTo: "src/components/players/MajorPlayerDirectoryRow.tsx" },
  { path: "src/app/admin/users/page.tsx", mode: "text-first", reason: "后台用户表是运营者密集表格，头像不是操作所需信息。" },
  { path: "src/app/players/[userId]/page.tsx", mode: "avatar" },
  { path: "src/app/teams/recruitment/page.tsx", mode: "avatar" },
  { path: "src/components/draft/CaptainDraftPanel.tsx", mode: "avatar" },
  { path: "src/components/draft/PlayerPool.tsx", mode: "avatar" },
  { path: "src/components/draft/TeamDraftGrid.tsx", mode: "avatar" },
  { path: "src/components/layout/HeaderViewerClient.tsx", mode: "avatar" },
  { path: "src/components/matches/MatchLineupsH2H.tsx", mode: "text-first", reason: "高密度双方统计对比以文字和指标可读性为优先。" },
  { path: "src/components/matches/MatchMvpVote.tsx", mode: "avatar" },
  { path: "src/components/matches/MatchRosterView.tsx", mode: "avatar" },
  { path: "src/components/matches/MatchSummaryStats.tsx", mode: "text-first", reason: "高密度赛后统计表以指标扫描为优先。" },
  { path: "src/components/matches/StatsLeaderboard.tsx", mode: "text-first", reason: "高密度排行榜以指标扫描为优先。" },
  { path: "src/components/players/EventPlayerDirectoryRow.tsx", mode: "avatar" },
  { path: "src/components/players/MajorPlayerDirectoryRow.tsx", mode: "delegate", delegatesTo: "src/components/players/EventPlayerDirectoryRow.tsx" },
  { path: "src/components/players/PlayerDirectoryRow.tsx", mode: "avatar" },
  { path: "src/components/recruitment/TeamRecruitmentSection.tsx", mode: "text-first", reason: "队长处理加入意向的运营队列以文字和操作为优先。" },
  { path: "src/components/season/SeasonResults.tsx", mode: "text-first", reason: "赛果荣誉列表以名次和荣誉事实扫描为优先。" },
  { path: "src/components/teams/TeamCard.tsx", mode: "avatar" },
  { path: "src/components/teams/TeamMapProfile.tsx", mode: "text-first", reason: "地图熟练度展开区以成员与地图事实扫描为优先。" },
  { path: "src/components/teams/TeamPublicProfile.tsx", mode: "avatar" },
];

const rootDir = process.cwd();

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return [path].filter((file) => [".ts", ".tsx"].includes(extname(file)) && !file.endsWith(".d.ts"));
  });
}

function relativePath(path: string): string {
  return relative(rootDir, path).replaceAll("\\", "/");
}

function hasDirectPlayerHref(path: string): boolean {
  const source = readFileSync(path, "utf8");
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found = false;
  const visit = (node: ts.Node): void => {
    if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && node.name.text === "href" && node.initializer?.getText(ast).includes("/players/")) {
      found = true;
    }
    if (!found) ts.forEachChild(node, visit);
  };
  visit(ast);
  return found;
}

describe("public player identity presentation contract", () => {
  it("keeps every direct public player link in an explicit inventory", () => {
    const inventory = new Map(PLAYER_IDENTITY_CONSUMERS.map((consumer) => [consumer.path, consumer]));
    const linkedFiles = sourceFiles(resolve(rootDir, "src"))
      .filter((path) => path.startsWith(resolve(rootDir, "src/app")) || path.startsWith(resolve(rootDir, "src/components")))
      .map(relativePath)
      .filter((path) => hasDirectPlayerHref(resolve(rootDir, path)));

    expect(linkedFiles.filter((path) => !inventory.has(path))).toEqual([]);
  });

  it("requires avatar usage, delegation, or a reasoned text-first exception", () => {
    for (const consumer of PLAYER_IDENTITY_CONSUMERS) {
      const absolutePath = resolve(rootDir, consumer.path);
      const source = readFileSync(absolutePath, "utf8");
      expect(source, consumer.path).toBeTruthy();

      if (consumer.mode === "avatar") {
        expect(source, consumer.path).toContain("PlayerAvatar");
      } else if (consumer.mode === "delegate") {
        expect(consumer.delegatesTo, consumer.path).toBeTruthy();
        expect(PLAYER_IDENTITY_CONSUMERS.some((candidate) => candidate.path === consumer.delegatesTo), consumer.path).toBe(true);
      } else {
        expect(consumer.reason?.trim(), consumer.path).toBeTruthy();
      }
    }
  });

  it("keeps the shared identity contract required-nullable", () => {
    const identity: PublicPlayerIdentity = {
      userId: "user-1",
      name: "公开选手",
      avatarUrl: null,
    };
    expect(identity.avatarUrl).toBeNull();
  });
});
