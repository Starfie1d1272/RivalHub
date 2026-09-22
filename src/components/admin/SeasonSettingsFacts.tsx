"use client";

import type { ReactNode } from "react";
import {
  type InstitutionAffiliationRule,
  type PlayerType,
  type SeasonStatus,
  type StagePlan,
  type TeamRegistrationConfig,
} from "@/types/season";
import type { CompetitionTemplate } from "@/lib/competition/templates";
import { type SeasonEditPhase } from "@/lib/seasons/edit";
import { PLAYER_TYPE_LABELS, presentSeasonStatus, STAGE_TYPE_LABELS } from "@/lib/seasons/presentation";
import { formatCST } from "@/lib/utils/date";
import { RANK_LABELS } from "@/lib/validators/registration";
import { Panel } from "@/components/rivalhub";
import type { ConversionPolicyProvenance } from "@/lib/competitive/conversion-policy-admin";

export const NO_RANK = "__none__";

export type CompetitivePlatformOption = {
  key: string;
  displayName: string;
  seasons?: Array<{ seasonKey: string; label: string; active: boolean }>;
  ranks?: Array<{ rankKey: string; label: string }>;
};

const EDIT_PHASE_LABELS: Record<SeasonEditPhase, string> = {
  draft: "草稿编辑",
  published_preopen: "已发布 · 报名未开放",
  registration_opened: "报名已开放",
  playing: "比赛进行中",
  terminal: "赛事已结束",
};

export function templateLabel(template: CompetitionTemplate): string {
  return template === "major" ? "Major" : template === "rivals" ? "Rivals" : "自定义赛事";
}

export function SettingsPanel({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-6">
      <Panel label={<h2 id={`${id}-title`}>{label}</h2>} contentClassName="p-5">
        {children}
      </Panel>
    </section>
  );
}

export function FrozenFact({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-sm border border-[var(--color-info-edge)] bg-[var(--color-info-soft)] px-4 py-3 text-sm" data-testid="season-frozen-fact">
      <p className="font-medium text-[var(--color-fg)]">{title}</p>
      <p className="mt-1 leading-6 text-[var(--color-fg-mid)]">{children}</p>
    </div>
  );
}

function formatDateFact(value: Date | null | undefined): string {
  return value ? formatCST(value) : "未配置";
}

function formatPlatform(platform: string | undefined, platforms: readonly CompetitivePlatformOption[]): string {
  if (!platform) return "未配置";
  return platforms.find((item) => item.key === platform)?.displayName ?? platform;
}

function formatPlatformSeason(
  platform: string | undefined,
  seasonKey: string | undefined,
  platforms: readonly CompetitivePlatformOption[],
): string {
  if (!seasonKey) return "未配置";
  const season = platforms.find((item) => item.key === platform)?.seasons?.find((item) => item.seasonKey === seasonKey);
  return season ? `${season.label}（${season.seasonKey}）` : seasonKey;
}

export function LifecycleFacts({
  status,
  phase,
  registrationOpenedAt,
}: {
  status: SeasonStatus;
  phase: SeasonEditPhase;
  registrationOpenedAt?: Date | null;
}) {
  return (
    <dl className="mb-5 grid gap-3 border-b border-[var(--color-border)] pb-5 text-sm sm:grid-cols-3">
      <div><dt className="text-[var(--color-fg-mid)]">当前状态</dt><dd className="mt-1 font-medium">{presentSeasonStatus(status).label}</dd></div>
      <div><dt className="text-[var(--color-fg-mid)]">编辑阶段</dt><dd className="mt-1 font-medium">{EDIT_PHASE_LABELS[phase]}</dd></div>
      <div><dt className="text-[var(--color-fg-mid)]">实际报名开放</dt><dd className="mt-1 font-medium">{formatDateFact(registrationOpenedAt)}</dd></div>
    </dl>
  );
}

export function TeamQualificationSummary({ config }: { config: TeamRegistrationConfig }) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium">队伍教育与归属要求</h3>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div><dt className="text-[var(--color-fg-mid)]">外校成员</dt><dd className="mt-1 font-medium">{config.allowExternal ? "允许" : "不允许"}</dd></div>
        <div><dt className="text-[var(--color-fg-mid)]">毕业生计入本校</dt><dd className="mt-1 font-medium">{config.graduateCountsAsHome ? "计入" : "不计入"}</dd></div>
        <div><dt className="text-[var(--color-fg-mid)]">本校成员下限</dt><dd className="mt-1 font-medium">{config.minHomeMembers} 人</dd></div>
        <div><dt className="text-[var(--color-fg-mid)]">在读成员下限</dt><dd className="mt-1 font-medium">{config.minEnrolledMembers} 人</dd></div>
        <div><dt className="text-[var(--color-fg-mid)]">外校成员上限</dt><dd className="mt-1 font-medium">{config.maxExternalMembers} 人</dd></div>
      </dl>
      <p className="text-xs leading-5 text-[var(--color-fg-dim)]">报名名单和每场首发均需符合本届资格要求。</p>
    </div>
  );
}

export function TeamRegistrationSummary({ config }: { config: TeamRegistrationConfig }) {
  return (
    <div className="mt-5 space-y-3 border-t border-[var(--color-border)] pt-5">
      <h3 className="text-sm font-medium">队伍报名与名单事实</h3>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div><dt className="text-[var(--color-fg-mid)]">队长可转让</dt><dd className="mt-1 font-medium">{config.captainCanTransfer ? "允许" : "不允许"}</dd></div>
        <div><dt className="text-[var(--color-fg-mid)]">队长可移除成员</dt><dd className="mt-1 font-medium">{config.captainCanKick ? "允许" : "不允许"}</dd></div>
        <div><dt className="text-[var(--color-fg-mid)]">队伍名唯一</dt><dd className="mt-1 font-medium">{config.requireUniqueTeamName ? "要求" : "不要求"}</dd></div>
        <div><dt className="text-[var(--color-fg-mid)]">队伍 Logo</dt><dd className="mt-1 font-medium">{config.requireTeamLogo ? "要求" : "不要求"}</dd></div>
        <div><dt className="text-[var(--color-fg-mid)]">报名后锁定名单</dt><dd className="mt-1 font-medium">{config.lockAfterRegistration ? "是" : "否"}</dd></div>
        <div><dt className="text-[var(--color-fg-mid)]">位置要求</dt><dd className="mt-1 font-medium">{config.requirePositions ? `每位置最多 ${config.maxPerPositionPerTeam} 人` : "无额外位置要求"}</dd></div>
      </dl>
      <p className="text-xs leading-5 text-[var(--color-fg-dim)]">内置赛事的报名和名单规则由赛事体系统一确定。</p>
    </div>
  );
}

export function SoloQualificationSummary({
  allowedPlayerTypes,
  currentMin,
  peakMin,
  maxPerPosition,
  screenshotCount,
}: {
  allowedPlayerTypes: readonly PlayerType[];
  currentMin: string;
  peakMin: string;
  maxPerPosition: number;
  screenshotCount: number;
}) {
  const formatRank = (value: string) => {
    if (value === NO_RANK) return "无门槛";
    return value in RANK_LABELS ? RANK_LABELS[value as keyof typeof RANK_LABELS] : value;
  };

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium">个人报名资格</h3>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div><dt className="text-[var(--color-fg-mid)]">允许身份</dt><dd className="mt-1 font-medium">{allowedPlayerTypes.map((type) => PLAYER_TYPE_LABELS[type]).join("、")}</dd></div>
        <div><dt className="text-[var(--color-fg-mid)]">当前段位门槛</dt><dd className="mt-1 font-medium">{formatRank(currentMin)}</dd></div>
        <div><dt className="text-[var(--color-fg-mid)]">历史段位门槛</dt><dd className="mt-1 font-medium">{formatRank(peakMin)}</dd></div>
        <div><dt className="text-[var(--color-fg-mid)]">每位置上限</dt><dd className="mt-1 font-medium">{maxPerPosition} 人</dd></div>
        <div><dt className="text-[var(--color-fg-mid)]">截图链接数量</dt><dd className="mt-1 font-medium">{screenshotCount}</dd></div>
      </dl>
      <p className="text-xs leading-5 text-[var(--color-fg-dim)]">提交报名时将按以上要求核验参赛资格。</p>
    </div>
  );
}

export function AffiliationRulesSummary({ rules }: { rules: readonly InstitutionAffiliationRule[] }) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium">学校归属规则</h3>
      {rules.length === 0 ? (
        <p className="text-sm text-[var(--color-fg-mid)]">当前没有额外的学校归属规则。</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {rules.map((rule) => (
            <li key={`${rule.institutionCode}-${rule.minRosterMembers}-${rule.minStartingMembers}`} className="rounded-sm border border-[var(--color-border)] px-3 py-2.5">
              <span className="font-medium">机构 {rule.institutionCode}</span>
              <span className="mt-1 block text-[var(--color-fg-mid)]">
                {rule.eligibleAcademicStatuses.includes("enrolled") ? "在读" : ""}
                {rule.eligibleAcademicStatuses.includes("enrolled") && rule.eligibleAcademicStatuses.includes("graduated") ? " / " : ""}
                {rule.eligibleAcademicStatuses.includes("graduated") ? "毕业" : ""}
                · 名单至少 {rule.minRosterMembers} 人 · 预定首发至少 {rule.minStartingMembers} 人
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs leading-5 text-[var(--color-fg-dim)]">报名名单和首发阵容均按以上学校归属要求核验。</p>
    </div>
  );
}

export function CompetitiveReferenceSummary({
  config,
  platforms,
  phase,
  policyProvenance,
}: {
  config: TeamRegistrationConfig;
  platforms: readonly CompetitivePlatformOption[];
  phase: SeasonEditPhase;
  policyProvenance?: ConversionPolicyProvenance | null;
}) {
  const profile = config.competitiveProfile;
  if (!config.requireCompetitiveProfile || !profile) {
    return <p className="text-sm text-[var(--color-fg-mid)]">当前赛事未启用队伍竞技档案要求；报名资格不会从这里推断竞技事实。</p>;
  }

  const frozen = phase !== "draft" && phase !== "published_preopen";
  const pendingContext = "报名开放时自动确定";
  const contextValue = (value: string) => !frozen ? pendingContext : value === "未配置" ? "本届未记录该项参考资料" : value;
  const evidencePolicy = profile.evidencePolicy;
  const sourceSelection = evidencePolicy?.sourceSelection ?? "primary_then_fallback";
  const policyVersion = profile.conversionPolicyVersion;
  const policyId = profile.conversionPolicyId;
  const sourcePlatform = profile.fallbackConversion?.sourcePlatform === "fivee" ? "5E" : null;
  const primaryPlatform = formatPlatform(profile.platform, platforms);
  const conversionLabel = sourcePlatform ? `${sourcePlatform} → ${primaryPlatform}` : primaryPlatform;
  const currentSeason = formatPlatformSeason(profile.platform, profile.currentSeasonKey, platforms);
  const previousSeason = formatPlatformSeason(profile.platform, profile.previousSeasonKey, platforms);
  const referenceSeason = formatPlatformSeason(profile.platform, evidencePolicy?.referenceSeasonKey ?? profile.previousSeasonKey, platforms);
  const recentSeasons = (evidencePolicy?.recentSeasonKeys ?? [profile.previousSeasonKey, profile.currentSeasonKey])
    .filter(Boolean)
    .map((key) => formatPlatformSeason(profile.platform, key, platforms));

  return (
    <div className="space-y-4">
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div><dt className="text-[var(--color-fg-mid)]">主平台</dt><dd className="mt-1 font-medium">{primaryPlatform}</dd></div>
        <div><dt className="text-[var(--color-fg-mid)]">当前平台赛季</dt><dd className="mt-1 font-medium">{contextValue(currentSeason)}</dd></div>
        <div><dt className="text-[var(--color-fg-mid)]">上一平台赛季</dt><dd className="mt-1 font-medium">{contextValue(previousSeason)}</dd></div>
        <div><dt className="text-[var(--color-fg-mid)]">历史参考赛季（20%）</dt><dd className="mt-1 font-medium">{contextValue(referenceSeason)}</dd></div>
        <div className="sm:col-span-2"><dt className="text-[var(--color-fg-mid)]">近期竞技事实（30%）</dt><dd className="mt-1 font-medium">{contextValue(recentSeasons.length > 0 ? recentSeasons.join("、") : "未配置")}</dd></div>
        <div className="sm:col-span-2"><dt className="text-[var(--color-fg-mid)]">竞技证据来源</dt><dd className="mt-1 font-medium">{!frozen ? pendingContext : sourceSelection === "strongest_equivalent" ? "Perfect World 与 5E 数据按赛事换算规则比较，使用较高的有效竞技水平；相同时优先 Perfect World。" : "历史兼容：主平台优先，5E 仅在主平台资料不可用时作为等效补充。"}</dd></div>
        <div><dt className="text-[var(--color-fg-mid)]">冻结段位顺序</dt><dd className="mt-1 font-medium">{contextValue(profile.rankOrder.length > 0 ? `${profile.rankOrder.length} 个段位` : "未配置")}</dd></div>
        <div><dt className="text-[var(--color-fg-mid)]">外校实力星差上限</dt><dd className="mt-1 font-medium">{profile.externalStrengthMaxStarGap ?? 3} 星</dd></div>
      </dl>

      {policyVersion || policyId || profile.fallbackConversion ? (
        <FrozenFact title={`${conversionLabel} · 换算规则 ${policyVersion ?? profile.fallbackConversion?.version ?? "历史版本未记录"}`}>
          {frozen
            ? "本届已在报名开放时锁定；全局规则后续变化不会影响本届。"
            : policyId && policyVersion ? "跨平台换算规则版本已锁定；平台参考赛季、段位顺序与换算数据将在报名开放时确定。" : "本届保留历史换算数据，未记录绑定的换算规则版本。"}
          {profile.fallbackConversion?.version && <span className="mt-1 block text-xs">本届换算数据版本：{profile.fallbackConversion.version} · 来源：{sourcePlatform ?? "赛事换算规则"}</span>}
          {policyProvenance && (policyProvenance.sourceNote || policyProvenance.rationale || policyProvenance.changeSummary) && (
            <dl className="mt-3 grid gap-2 border-t border-[var(--color-info-edge)] pt-3 text-xs sm:grid-cols-2">
              {policyProvenance.sourceNote && <div><dt className="text-[var(--color-fg-mid)]">策略来源说明</dt><dd className="mt-1 leading-5">{policyProvenance.sourceNote}</dd></div>}
              {policyProvenance.rationale && <div><dt className="text-[var(--color-fg-mid)]">采用理由</dt><dd className="mt-1 leading-5">{policyProvenance.rationale}</dd></div>}
              {policyProvenance.changeSummary && <div className="sm:col-span-2"><dt className="text-[var(--color-fg-mid)]">版本变化</dt><dd className="mt-1 leading-5">{policyProvenance.changeSummary}</dd></div>}
            </dl>
          )}
        </FrozenFact>
      ) : (
        <FrozenFact title={`${conversionLabel} · ${phase === "draft" ? "发布时自动锁定换算规则" : "历史换算规则记录"}`}>
          {phase === "draft" ? "发布时将自动选择当前启用的跨平台换算规则；平台参考赛季与段位顺序在报名开放时自动确定。" : "本届未记录绑定的换算规则版本，请按本届已保存的竞技资料与换算数据核对。"}
        </FrozenFact>
      )}
    </div>
  );
}

export function StagePlanSummary({ stagePlan }: { stagePlan: StagePlan }) {
  if (stagePlan.length === 0) return <p className="text-sm text-[var(--color-fg-mid)]">当前没有配置比赛阶段。</p>;
  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--color-fg-dim)]">以下为本届赛事的比赛阶段与赛制安排。</p>
      <ol className="space-y-2">
        {stagePlan.map((stage, index) => (
          <li key={`${stage.key}-${index}`} className="rounded-sm border border-[var(--color-border)] px-3 py-2.5 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{stage.name}</span>
              <span className="font-mono text-xs text-[var(--color-fg-mid)]">{STAGE_TYPE_LABELS[stage.type]} · {stage.teamCount} 队</span>
            </div>
            <p className="mt-1 text-[var(--color-fg-mid)]">主赛制 {stage.matchFormat?.toUpperCase() ?? "未配置"}{stage.finalFormat ? ` · 决赛 ${stage.finalFormat.toUpperCase()}` : ""}{stage.hasThirdPlaceMatch ? " · 含季军赛" : ""}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
