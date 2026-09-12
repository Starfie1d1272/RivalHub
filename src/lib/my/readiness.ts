import { countActionableRecruitmentInterests } from "@/lib/recruitment/data";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import {
  competitiveRankFacts,
  disciplinaryCases,
  seasons,
  teamMemberships,
  teams,
} from "@/db/schema";
import {
  loadCompetitivePlatformCatalog,
  type CompetitivePlatformCatalogEntry,
} from "@/lib/competitive/catalog";
import { serializeSanctionPublic, type SanctionEffect } from "@/lib/discipline/service";
import { getPublicDisplayName } from "@/lib/identity/display-name";
import { countPendingDirectTeamInvitations } from "@/lib/teams/invitations";
import { loadMyCompetitionSources, type MyCompetitionSource } from "@/lib/my/competitions";
import {
  presentCompetitionEntryParticipation,
  presentCompetitionEntryRegistration,
} from "@/lib/competition-entries/presentation";
import {
  computeParticipantReadiness,
  getParticipantIdentityBlockers,
  loadParticipantQualificationFacts,
  type ParticipantQualificationFacts,
} from "@/lib/qualification/service";
import { normalizeTeamRegistrationConfig } from "@/lib/seasons/compatibility";

export type { MyCompetitionSource };

export type MyReadinessState = "ready" | "incomplete" | "waiting" | "blocked" | "unknown" | "not_applicable";

export interface MyReadinessCta {
  href: string;
  label: string;
}

export type MyReadinessResponsibility =
  | "self"
  | "self_and_admin"
  | "representative"
  | "representative_and_admin"
  | "admin";

export interface MyReadinessItem {
  id: string;
  title: string;
  state: MyReadinessState;
  detail: string;
  responsibility?: MyReadinessResponsibility;
  cta: MyReadinessCta;
  secondaryCta?: MyReadinessCta;
}

export interface MySanctionSource {
  id: string;
  seasonId: string;
  seasonName: string;
  seasonSlug: string;
  effects: SanctionEffect[];
  explanation: string | null;
  effectiveFrom: Date;
  effectiveUntil: Date | null;
}

export interface MyCompetitiveProfileSource {
  key: string;
  displayName: string;
  state: MyReadinessState;
  blockers: string[];
  /** Optional platforms remain visible as long-lived profile maintenance. */
  required?: boolean;
}

export interface MyReadinessModel {
  displayName: string;
  profile: MyReadinessItem;
  education: MyReadinessItem;
  competitiveProfiles: MyCompetitiveProfileSource[];
  team: MyReadinessItem;
  recruitment?: MyReadinessItem;
  competitions: Array<{
    id: string;
    name: string;
    seasonName: string;
    href: string;
    entry: MyReadinessItem;
    qualification: MyReadinessItem;
    sanctions: MySanctionSource[];
  }>;
  sanctions: MySanctionSource[];
}

export interface SettingsProfileReadiness {
  profile: MyReadinessItem;
  education: MyReadinessItem;
  competitiveProfiles: MyCompetitiveProfileSource[];
  ready: boolean;
}

export function isSettingsProfileReadinessReady(
  profile: MyReadinessItem,
  education: MyReadinessItem,
  competitiveProfiles: readonly MyCompetitiveProfileSource[],
): boolean {
  return profile.state === "ready" && education.state === "ready" && competitiveProfiles.filter((item) => item.required).every((item) => item.state === "ready");
}

export function presentMyReadinessResponsibility(responsibility: MyReadinessResponsibility): string {
  switch (responsibility) {
    case "self": return "你";
    case "self_and_admin": return "你与赛事管理员";
    case "representative": return "赛事负责人";
    case "representative_and_admin": return "赛事负责人和赛事管理员";
    case "admin": return "赛事管理员";
  }
}

export function isMyReadinessActionable(item: MyReadinessItem): boolean {
  return (item.responsibility === "self" || item.responsibility === "self_and_admin")
    && (item.state === "incomplete" || item.state === "waiting" || item.state === "blocked");
}

export function selectMyPrimaryAction(items: readonly MyReadinessItem[]): MyReadinessItem | null {
  return items.find(isMyReadinessActionable) ?? null;
}

function item(
  id: string,
  title: string,
  state: MyReadinessState,
  detail: string,
  responsibility: MyReadinessResponsibility | undefined,
  cta: MyReadinessCta,
  secondaryCta?: MyReadinessCta,
): MyReadinessItem {
  return { id, title, state, detail, ...(responsibility ? { responsibility } : {}), cta, ...(secondaryCta ? { secondaryCta } : {}) };
}

function latestEducationState(fact: ParticipantQualificationFacts | null): MyReadinessItem {
  if (!fact) {
    return item("education", "教育认证", "unknown", "教育认证资料暂时无法确认。", "admin", { href: "/settings/education", label: "查看教育认证" });
  }
  if (fact.approvedEducation) {
    return item("education", "教育认证", "ready", "已存在通过的教育认证。赛事仍会按当届规则核验。", undefined, { href: "/settings/education", label: "查看教育认证" });
  }
  if (fact.educationHistory.some((entry) => entry.status === "pending")) {
    return item("education", "教育认证", "waiting", "教育材料正在等待审核。", "admin", { href: "/settings/education", label: "查看认证进度" });
  }
  if (fact.educationHistory.some((entry) => entry.status === "rejected")) {
    return item("education", "教育认证", "blocked", "最近的教育认证未通过，需要重新提交材料。", "self", { href: "/settings/education", label: "重新提交材料" });
  }
  return item("education", "教育认证", "incomplete", "尚未提交教育认证。", "self", { href: "/settings/education", label: "开始教育认证" });
}

function profileState(fact: ParticipantQualificationFacts | null): MyReadinessItem {
  if (!fact) {
    return item("profile", "长期个人资料", "unknown", "个人资料暂时无法确认。", "admin", { href: "/settings", label: "查看参赛资料" });
  }
  const blockers = getParticipantIdentityBlockers(fact);
  if (blockers.length === 0) {
    return item("profile", "长期个人资料", "ready", "展示昵称、Steam64、完美平台 ID、QQ 与邮箱验证已齐全。", undefined, { href: "/settings", label: "查看参赛资料" });
  }
  return item("profile", "长期个人资料", "incomplete", blockers.join(" "), "self", { href: "/settings", label: "完善参赛资料" });
}

function teamState(currentTeam: { id: string; name: string; role: "captain" | "member" } | null, pendingDirectInvitationCount: number): MyReadinessItem {
  if (!currentTeam) {
    if (pendingDirectInvitationCount > 0) {
      return item(
        "team",
        "当前队伍",
        "waiting",
        `你有 ${pendingDirectInvitationCount} 个待处理的队伍邀请。接受邀请即加入队伍，不需要再次申请或等待审核。`,
        "self",
        { href: "/my/teams", label: "处理队伍邀请" },
        { href: "/teams/recruitment?view=teams", label: "寻找队伍" },
      );
    }
    return item(
      "team",
      "当前队伍",
      "incomplete",
      "你还没有加入队伍。可以创建自己的队伍，或在组队大厅寻找正在招募的队伍；加入队伍不会自动参加任何赛事。",
      undefined,
      { href: "/my/teams#create-team", label: "创建队伍" },
      { href: "/teams/recruitment?view=teams", label: "寻找队伍" },
    );
  }
  return item("team", "当前队伍", "ready", `${currentTeam.name} · ${currentTeam.role === "captain" ? "队长" : "成员"}。之后的队伍成员变更不会改写已报名赛事名单。`, undefined, { href: "/my/teams", label: currentTeam.role === "captain" ? "管理我的队伍" : "查看我的队伍" });
}

function entryState(source: MyCompetitionSource, userId: string): MyReadinessItem {
  const href = `/${source.seasonSlug}/register`;
  const representative = source.representativeUserId === userId;
  const presentation = representative
    ? presentCompetitionEntryRegistration(source.registrationStatus, source.revisionOrigin)
    : presentCompetitionEntryParticipation(source.participantStatus, source.registrationStatus);
  if (!representative) {
    const awaitingConfirmation = source.participantStatus === "invited";
    if (source.participantStatus === "confirmed") {
      const registration = presentCompetitionEntryRegistration(source.registrationStatus, source.revisionOrigin);
      const responsibility: MyReadinessResponsibility | undefined = source.registrationStatus === "changes_requested"
        ? "representative_and_admin"
        : source.registrationStatus === "withdrawn"
          ? "representative"
          : source.registrationStatus === "submitted" || source.registrationStatus === "waitlisted"
            ? "admin"
            : source.registrationStatus === "draft"
              ? "representative"
              : undefined;
      return item(
        `entry-${source.id}`,
        "当前报名状态",
        registration.state,
        `${presentation.label} · ${registration.label}，${registration.detail}`,
        responsibility,
        { href, label: "查看本届报名" },
      );
    }
    return item(
      `entry-${source.id}`,
      "当前报名状态",
      presentation.state,
      `${presentation.label}：${presentation.detail}`,
      awaitingConfirmation ? "self" : undefined,
      { href, label: awaitingConfirmation ? "确认是否参赛" : "查看本届报名" },
    );
  }
  const cta = source.registrationStatus === "changes_requested"
    ? { href, label: source.revisionOrigin === "self_roster_change" ? "继续调整名单" : "处理补正" }
    : source.registrationStatus === "draft"
      ? { href, label: "继续报名" }
      : source.registrationStatus === "rejected"
        ? { href, label: "查看审核说明" }
        : { href, label: "查看报名" };
  const responsibility: MyReadinessResponsibility | undefined = source.registrationStatus === "changes_requested"
      ? "self_and_admin"
      : source.registrationStatus === "withdrawn"
        ? undefined
        : source.registrationStatus === "submitted" || source.registrationStatus === "waitlisted"
          ? "admin"
          : source.registrationStatus === "draft"
            ? "self"
            : undefined;
  return item(`entry-${source.id}`, "当前报名状态", presentation.state, `${presentation.label}：${presentation.detail}`, responsibility, cta);
}

function qualificationState(
  source: MyCompetitionSource,
  fact: ParticipantQualificationFacts | null | undefined,
): MyReadinessItem {
  const href = `/${source.seasonSlug}/register`;
  const config = normalizeTeamRegistrationConfig(source.teamRegistrationConfig);
  if (!config.requireCompetitiveProfile) {
    return item(`qualification-${source.id}`, "个人竞技资料", "not_applicable", "本届赛事不要求个人竞技资料；报名是否通过仍以赛事审核为准。", undefined, { href, label: "查看本届报名" });
  }
  if (!config.competitiveProfile || !fact) {
    return item(`qualification-${source.id}`, "个人竞技资料", "unknown", "本届赛事的竞技资料暂时无法确认。", "admin", { href, label: "查看本届报名" });
  }
  const readiness = computeParticipantReadiness(fact, config.competitiveProfile);
  if (readiness.ready) {
    return item(`qualification-${source.id}`, "个人竞技资料", "ready", "个人资料符合本届赛事要求。报名审核、正式参赛名单与纪律限制仍会分别核验。", undefined, { href, label: "查看本届报名" });
  }
  return item(`qualification-${source.id}`, "个人竞技资料", "blocked", readiness.blockers.join(" "), "self", { href, label: "查看并补齐资料" });
}

export function buildMyReadinessModel(input: {
  user: { displayName: string | null; perfectName: string | null; steamName: string | null };
  baseFact: ParticipantQualificationFacts | null;
  currentTeam: { id: string; name: string; role: "captain" | "member" } | null;
  pendingDirectInvitationCount: number;
  actionableInterestCount?: number;
  competitiveProfiles: MyCompetitiveProfileSource[];
  competitions: MyCompetitionSource[];
  qualificationFactsByPlatform: Map<string, ParticipantQualificationFacts | null>;
  sanctions: MySanctionSource[];
  userId: string;
}): MyReadinessModel {
  const sanctionsBySeason = new Map<string, MySanctionSource[]>();
  for (const sanction of input.sanctions) {
    const current = sanctionsBySeason.get(sanction.seasonId) ?? [];
    current.push(sanction);
    sanctionsBySeason.set(sanction.seasonId, current);
  }
  return {
    displayName: getPublicDisplayName(input.user),
    profile: profileState(input.baseFact),
    education: latestEducationState(input.baseFact),
    competitiveProfiles: input.competitiveProfiles,
    team: teamState(input.currentTeam, input.pendingDirectInvitationCount),
    ...(input.actionableInterestCount ? { recruitment: item("recruitment", "队伍加入意向", "waiting", `${input.actionableInterestCount} 名选手向你的队伍表达加入意向`, "self", { href: "/my/teams#recruitment-interests", label: "查看并处理" }) } : {}),
    competitions: input.competitions.map((competition) => {
      const config = normalizeTeamRegistrationConfig(competition.teamRegistrationConfig);
      const fact = config.competitiveProfile
        ? input.qualificationFactsByPlatform.get(config.competitiveProfile.platform)
        : input.baseFact;
      return {
        id: competition.id,
        name: competition.name,
        seasonName: competition.seasonName,
        href: `/${competition.seasonSlug}/register`,
        entry: entryState(competition, input.userId),
        qualification: qualificationState(competition, fact),
        sanctions: sanctionsBySeason.get(competition.seasonId) ?? [],
      };
    }),
    sanctions: input.sanctions,
  };
}

export function selectMyCompetitiveProfilePlatformKeys(
  catalog: readonly CompetitivePlatformCatalogEntry[],
  requiredPlatforms: ReadonlySet<string>,
  platformsWithFacts: ReadonlySet<string>,
): string[] {
  const selected = new Set([...requiredPlatforms, ...platformsWithFacts]);
  const catalogKeys = catalog.map((platform) => platform.key);
  return [
    // Settings is long-lived profile maintenance, not a simulated event. Show
    // both product platforms in canonical order even before the user has facts.
    ...catalogKeys,
    ...[...selected].filter((key) => !catalogKeys.includes(key)).sort(),
  ];
}

function buildCompetitiveProfileSources(
  catalog: readonly CompetitivePlatformCatalogEntry[],
  platformKeys: readonly string[],
  factsByPlatform: ReadonlyMap<string, ParticipantQualificationFacts | null>,
  requiredPlatforms: ReadonlySet<string>,
): MyCompetitiveProfileSource[] {
  const catalogByKey = new Map(catalog.map((platform) => [platform.key, platform]));
  return platformKeys.map((key) => {
    const platform = catalogByKey.get(key);
    if (!platform) {
      return { key, displayName: key, state: "unknown", blockers: ["该平台的竞技目录不可确认。"], required: requiredPlatforms.has(key) };
    }
    const current = platform.seasons.find((season) => season.isCurrent && season.active);
    if (!current || platform.ranks.length === 0) return { key: platform.key, displayName: platform.displayName, state: "unknown", blockers: ["平台目录缺少当前赛季或段位表，竞技档案不可确认。"], required: requiredPlatforms.has(platform.key) };
    const fact = factsByPlatform.get(platform.key) ?? null;
    if (!fact) {
      return { key: platform.key, displayName: platform.displayName, state: "unknown", blockers: ["竞技档案事实不可确认。"], required: requiredPlatforms.has(platform.key) };
    }
    const blockers: string[] = [];
    if (!fact.historicalPeak) blockers.push(`${platform.displayName} · 历史最高尚未录入。`);
    if (!fact.seasonPeaks?.has(current.seasonKey)) blockers.push(`${platform.displayName} · ${current.label} 尚未录入。`);
    return { key: platform.key, displayName: platform.displayName, state: blockers.length === 0 ? "ready" : "incomplete", blockers, required: requiredPlatforms.has(platform.key) };
  });
}

async function loadCompetitiveProfileSources(
  userId: string,
  catalog: readonly CompetitivePlatformCatalogEntry[],
  requiredPlatforms: ReadonlySet<string>,
  platformsWithFacts: ReadonlySet<string>,
): Promise<MyCompetitiveProfileSource[]> {
  const platformKeys = selectMyCompetitiveProfilePlatformKeys(catalog, requiredPlatforms, platformsWithFacts);
  const factsByPlatform = new Map<string, ParticipantQualificationFacts | null>();
  await Promise.all(platformKeys.map(async (platform) => {
    const facts = await loadParticipantQualificationFacts([userId], { platform });
    factsByPlatform.set(platform, facts.get(userId) ?? null);
  }));
  return buildCompetitiveProfileSources(catalog, platformKeys, factsByPlatform, requiredPlatforms);
}

/**
 * Settings maintains durable personal facts only. It deliberately does not
 * select a live event catalog or simulate a Major qualification decision.
 * Event-specific qualification remains owned by the entry/event views.
 */
export async function loadSettingsProfileReadiness(userId: string): Promise<SettingsProfileReadiness> {
  const [baseFacts, catalog, platformFactRows] = await Promise.all([
    loadParticipantQualificationFacts([userId]),
    loadCompetitivePlatformCatalog(db),
    db.selectDistinct({ platform: competitiveRankFacts.platform })
      .from(competitiveRankFacts)
      .where(eq(competitiveRankFacts.userId, userId)),
  ]);
  const baseFact = baseFacts.get(userId) ?? null;
  const competitiveProfiles = await loadCompetitiveProfileSources(
    userId,
    catalog,
    new Set(["perfect_world"]),
    new Set(platformFactRows.map((row) => row.platform)),
  );
  const profile = profileState(baseFact);
  const education = latestEducationState(baseFact);
  return {
    profile,
    education,
    competitiveProfiles,
    ready: isSettingsProfileReadinessReady(profile, education, competitiveProfiles),
  };
}

export async function loadMyReadiness(userId: string): Promise<MyReadinessModel> {
  const [baseFacts, catalog, currentTeamRows, pendingDirectInvitationCount, actionableInterestCount, competitionRows, sanctionRows, platformFactRows] = await Promise.all([
    loadParticipantQualificationFacts([userId]),
    loadCompetitivePlatformCatalog(db),
    db.select({ id: teams.id, name: teams.name, captainUserId: teams.captainUserId })
      .from(teamMemberships)
      .innerJoin(teams, eq(teams.id, teamMemberships.teamId))
      .where(and(eq(teamMemberships.userId, userId), isNull(teamMemberships.endedAt), eq(teams.status, "active")))
      .limit(1),
    countPendingDirectTeamInvitations(userId),
    countActionableRecruitmentInterests(userId),
    loadMyCompetitionSources(userId),
    db.select({ row: disciplinaryCases, seasonName: seasons.name, seasonSlug: seasons.slug })
      .from(disciplinaryCases)
      .innerJoin(seasons, eq(seasons.id, disciplinaryCases.seasonId))
      .where(and(eq(disciplinaryCases.subjectUserId, userId), eq(disciplinaryCases.status, "active"))),
    db.selectDistinct({ platform: competitiveRankFacts.platform })
      .from(competitiveRankFacts)
      .where(eq(competitiveRankFacts.userId, userId)),
  ]);

  const baseFact = baseFacts.get(userId) ?? null;
  const requiredPlatforms = new Set<string>();
  for (const row of competitionRows) {
    const config = normalizeTeamRegistrationConfig(row.teamRegistrationConfig);
    if (config.requireCompetitiveProfile && config.competitiveProfile) requiredPlatforms.add(config.competitiveProfile.platform);
  }
  const platformKeys = selectMyCompetitiveProfilePlatformKeys(catalog, requiredPlatforms, new Set(platformFactRows.map((row) => row.platform)));
  const factsByPlatform = new Map<string, ParticipantQualificationFacts | null>();
  await Promise.all(platformKeys.map(async (platform) => {
    const facts = await loadParticipantQualificationFacts([userId], { platform });
    factsByPlatform.set(platform, facts.get(userId) ?? null);
  }));

  const competitiveProfiles = buildCompetitiveProfileSources(catalog, platformKeys, factsByPlatform, requiredPlatforms);

  const now = new Date();
  const sanctions = sanctionRows
    .map(({ row, seasonName, seasonSlug }) => ({ publicRow: serializeSanctionPublic(row, now), seasonName, seasonSlug }))
    .filter(({ publicRow }) => publicRow.status === "active")
    .map(({ publicRow, seasonName, seasonSlug }) => ({
      id: publicRow.id,
      seasonId: publicRow.seasonId,
      seasonName,
      seasonSlug,
      effects: publicRow.effects,
      explanation: publicRow.explanation,
      effectiveFrom: publicRow.effectiveFrom,
      effectiveUntil: publicRow.effectiveUntil,
    }));

  return buildMyReadinessModel({
    user: baseFact ?? { displayName: null, perfectName: null, steamName: null },
    baseFact,
    currentTeam: currentTeamRows[0] ? { ...currentTeamRows[0], role: currentTeamRows[0].captainUserId === userId ? "captain" : "member" } : null,
    pendingDirectInvitationCount,
    actionableInterestCount,
    competitiveProfiles,
    competitions: competitionRows,
    qualificationFactsByPlatform: factsByPlatform,
    sanctions,
    userId,
  });
}

export const SANCTION_EFFECT_LABELS: Record<SanctionEffect, string> = {
  registration_block: "阻止报名",
  roster_block: "阻止进入赛事名单",
  match_participation_block: "阻止单场出场",
};
