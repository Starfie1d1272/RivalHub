import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RELEASE_TAG_PATTERN } from "../../src/lib/release/identity";

interface ChangelogVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

interface ChangelogSection {
  tag: string;
  version: ChangelogVersion;
  heading: string;
  body: string;
}

export function renderProductionReleaseNotes(
  changelog: string,
  options: { previousReleaseTag: string; currentReleaseTag: string },
): string {
  const previousTag = normalizeReleaseTag(options.previousReleaseTag, "上一生产版本 tag");
  const currentTag = normalizeReleaseTag(options.currentReleaseTag, "当前版本 tag");
  const previousVersion = parseReleaseTag(previousTag);
  const currentVersion = parseReleaseTag(currentTag);

  if (compareVersions(previousVersion, currentVersion) >= 0) {
    throw new Error("上一生产版本必须早于当前版本；发布说明已中止。");
  }

  const sections = parseChangelogSections(changelog);
  const currentSection = sections.find((section) => section.tag === currentTag);
  if (!currentSection) {
    throw new Error(`CHANGELOG.md 缺少当前版本 ${currentTag}；发布说明已中止。`);
  }

  const delta = sections.filter((section) =>
    compareVersions(section.version, previousVersion) > 0 &&
    compareVersions(section.version, currentVersion) <= 0,
  );
  if (delta.length === 0) {
    throw new Error(`CHANGELOG.md 未找到 ${previousTag} → ${currentTag} 的生产版本差异；发布说明已中止。`);
  }

  return [
    `本次生产发布 ${currentTag} 相对权威上一生产版本 ${previousTag} 的变更如下。`,
    "",
    "> 以下内容按 CHANGELOG.md 汇总从上一版本到当前版本的完整差异；中间版本条目仅用于说明变更，不代表曾作为生产版本发布。",
    "",
    delta.map((section) => [section.heading, section.body.trim()].filter(Boolean).join("\n\n")).join("\n\n"),
    "",
  ].join("\n");
}

function parseChangelogSections(changelog: string): ChangelogSection[] {
  const sections: ChangelogSection[] = [];
  let current: { tag: string; version: ChangelogVersion; heading: string; bodyLines: string[] } | undefined;

  for (const line of changelog.split(/\r?\n/)) {
    const match = line.match(/^##\s+\[?(v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\]?(?:\s|$)/);
    if (match) {
      if (current) sections.push({ ...current, body: current.bodyLines.join("\n") });
      const tag = normalizeReleaseTag(match[1], "CHANGELOG 中的版本 tag");
      if (sections.some((section) => section.tag === tag)) {
        throw new Error(`CHANGELOG.md 重复版本条目 ${tag}；发布说明已中止。`);
      }
      current = {
        tag,
        version: parseReleaseTag(tag),
        heading: line.trim(),
        bodyLines: [],
      };
      continue;
    }
    if (current) current.bodyLines.push(line);
  }

  if (current) sections.push({ ...current, body: current.bodyLines.join("\n") });
  return sections;
}

function normalizeReleaseTag(raw: string, label: string): string {
  const trimmed = raw.trim();
  const tag = trimmed.startsWith("v") ? trimmed : `v${trimmed}`;
  if (!RELEASE_TAG_PATTERN.test(tag)) throw new Error(`${label} 无效：${raw}`);
  return tag;
}

function parseReleaseTag(tag: string): ChangelogVersion {
  const match = tag.match(/^v(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) throw new Error(`版本 tag 无效：${tag}`);
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4]?.split(".") ?? [],
  };
}

function compareVersions(left: ChangelogVersion, right: ChangelogVersion): number {
  for (const key of ["major", "minor", "patch"] as const) {
    if (left[key] !== right[key]) return left[key] - right[key];
  }
  if (left.prerelease.length === 0 && right.prerelease.length > 0) return 1;
  if (left.prerelease.length > 0 && right.prerelease.length === 0) return -1;
  for (let index = 0; index < Math.max(left.prerelease.length, right.prerelease.length); index += 1) {
    const leftPart = left.prerelease[index];
    const rightPart = right.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : undefined;
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : undefined;
    if (leftNumber !== undefined && rightNumber !== undefined) return leftNumber - rightNumber;
    if (leftNumber !== undefined) return -1;
    if (rightNumber !== undefined) return 1;
    return leftPart < rightPart ? -1 : 1;
  }
  return 0;
}

function cliMain(): void {
  const notes = renderProductionReleaseNotes(
    readFileSync(resolve(process.cwd(), "CHANGELOG.md"), "utf8"),
    {
      previousReleaseTag: process.env.RIVALHUB_PREVIOUS_RELEASE_TAG ?? "",
      currentReleaseTag: process.env.RELEASE_TAG ?? "",
    },
  );
  process.stdout.write(notes);
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    cliMain();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
