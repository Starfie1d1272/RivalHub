import "server-only";

import type { TxDb } from "@/db/client";
import type { matchDemoImports } from "@/db/schema";
import { readStoredEvidence } from "@/lib/demo-integration/review";
import { hasConfirmableParticipantIdentityIssue, validateCanonicalTarget, type CanonicalTarget } from "@/lib/demo-integration/validation";
import { loadGameplayIdentityReviewDetails } from "@/lib/identity/gameplay-steam";
import { getDisplayName } from "@/lib/identity/display-name";
import { loadOrFetchSteamProfiles } from "@/lib/steam-profiles";
import type { AdminDemoReviewMap, AdminDemoReviewParticipant } from "./types";

const ISSUE_TEXT: Record<string, string> = {
  SCORE_MISMATCH: "Demo 回合比分与正式比分不一致，请核对本图赛果。",
  SUMMARY_SCORE_MISMATCH: "Demo 汇总比分与正式比分不一致，请核对本图赛果。",
  DAK_QA_FAILED: "DAK QA 未通过，本问题不能通过身份确认解决。",
  TARGET_STAGE_MISMATCH: "Demo 对应的比赛阶段已变化，请核对数据来源。",
  TARGET_STAGE_RUN_MISMATCH: "Demo 对应的阶段轮次已变化，请核对数据来源。",
  TARGET_MAP_ORDER_MISMATCH: "Demo 图序与当前比赛不一致，请核对数据来源。",
  TARGET_MAP_MISMATCH: "Demo 地图与当前比赛不一致，请核对数据来源。",
  TARGET_ENTRY_MISMATCH: "Demo 参赛队与当前比赛不一致，请核对数据来源。",
  MATCH_NOT_FINISHED: "比赛尚未形成正式结果，请先核对比赛状态。",
  MAP_RESULT_MISSING: "本图缺少正式比分，请先核对本图赛果。",
  ROSTER_USER_DUPLICATE: "本场首发名单存在重复选手，请核对实际出场名单。",
  ROSTER_STEAM64_DUPLICATE: "本场首发名单存在重复 Steam64，请核对选手资料。",
  ROSTER_SIZE_MISMATCH: "Demo 选手人数与本场首发人数不一致。",
  ROSTER_NOT_COMPLETE: "本场双方各 5 名首发的名单尚未完整，请核对实际出场名单。",
  ROSTER_STEAM64_MISSING: "本场首发成员缺少可核对的 Steam64，请核对选手资料。",
  ROSTER_ENTRY_INVALID: "本场首发所属队伍无效，请核对出场名单。",
  ROSTER_PARTICIPANT_MISSING: "部分本场首发尚未在 Demo 中匹配；请先核对身份与实际出场名单。",
  STALE_EVIDENCE: "Demo 所依据的赛事、阵容或比分已变化，请核对数据来源。",
  CONTENT_CONFLICT: "本图已有另一份已确认的 Demo，请核对数据来源。",
  UNSUPPORTED_SEMANTIC_PROFILE: "这份 Demo 数据版本不支持当前确认流程。",
};

/** Presentation only: current validation determines actions; mutations recheck under locks. */
export async function loadAdminDemoReview(
  tx: TxDb,
  row: typeof matchDemoImports.$inferSelect,
  target: CanonicalTarget,
  entryNames: ReadonlyMap<string, string>,
  eventRosterUserIdsByEntry: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
): Promise<AdminDemoReviewMap> {
  const base = { importId: row.id, matchMapId: target.map.id, mapOrder: target.map.mapOrder, mapName: target.map.mapName };
  let evidence;
  try {
    evidence = readStoredEvidence(row);
  } catch {
    return { ...base, invalidPayload: true, message: "这份 Demo 数据无法重新读取，请核对或拒绝。", resolvedCount: 0, blockingIssues: [], participants: [] };
  }
  try {
    const validation = await validateCanonicalTarget(tx, evidence, target);
    const details = await loadGameplayIdentityReviewDetails(tx, validation.resolutions);
    const observedSteam64s = evidence.participants.map((participant) => participant.steamId64);
    const officialProfiles = await loadOrFetchSteamProfiles(tx, observedSteam64s);
    const participants: AdminDemoReviewParticipant[] = [];
    let resolvedCount = 0;
    for (const participant of evidence.participants) {
      const entryId = participant.observedTeamKey === "teamA" ? target.match.entryAId : target.match.entryBId;
      const starters = target.roster.filter((member) => member.entryId === entryId);
      const resolution = validation.resolutions.get(participant.steamId64);
      if (resolution && starters.some((member) => member.userId === resolution.userId)) {
        resolvedCount++;
        continue;
      }
      const detail = details.get(participant.steamId64);
      const identity = detail?.identity;
      const inCorrectEventRoster = resolution
        ? eventRosterUserIdsByEntry.get(entryId)?.has(resolution.userId) === true
        : false;
      const retirable = resolution?.source === "gameplay_alias" && identity?.status === "active"
        && identity.provenance === "admin_confirmed_alternate" && identity.sourceSeasonId === row.seasonId;
      const confirmable = !resolution && starters.length > 0
        && hasConfirmableParticipantIdentityIssue(validation.issues, participant.steamId64);
      const state = resolution
        ? inCorrectEventRoster
          ? "roster-mismatch"
          : retirable ? "conflict-retirable" : "conflict-nonretirable"
        : confirmable ? "confirmable" : "blocked";
      participants.push({
        observedSteam64: participant.steamId64, demoName: participant.nameSnapshot,
        teamName: entryNames.get(entryId) ?? "未知队伍", state,
        currentPlayer: detail ? { userId: detail.userId, name: detail.name } : null,
        retirableIdentityId: retirable ? identity.identityId : null,
        observedSteamProfile: (() => {
          const profile = officialProfiles.get(participant.steamId64);
          return profile ? {
            personaName: profile.personaName,
            profileUrl: profile.profileUrl,
            avatarUrl: profile.avatarUrl,
          } : null;
        })(),
        note: state === "confirmable" ? null : state === "roster-mismatch"
          ? "这个 Steam64 已明确属于本队赛事名单成员，但不在本场记录的首发五人中。这是实际出场名单问题，不是 Steam 身份冲突；请不要改绑或撤销 Steam 身份。"
          : state === "conflict-retirable"
            ? "请先核对当前关联和本场首发。确认关联错误后，可撤销本赛事比赛确认产生的身份，再重新选择选手。"
            : state === "conflict-nonretirable"
              ? resolution?.source === "primary"
                ? "这是选手资料中的当前 Steam64，不能在此撤销。请联系该选手核对账号设置，并由平台管理员处理身份争议。"
                : identity?.provenance === "profile_change"
                  ? "这是更换账号资料时保留的历史身份，不能在此撤销。请联系平台管理员核对历史身份。"
                  : "该身份的来源不属于当前赛事可撤销范围，请联系来源赛事管理员或平台管理员核对。"
              : "本场当前首发名单没有可确认的选手，请先核对出场名单。",
        candidates: state === "confirmable" || state.startsWith("conflict-")
          ? starters.map((member) => ({ eventRosterMemberId: member.eventRosterMemberId,
              entryId: member.entryId, name: getDisplayName(member), steam64: member.steam64 }))
          : [],
      });
    }
    // Lineage/revision checks are owned by revalidation; retain their stored blockers.
    const issues = [...validation.issues, ...row.issues.filter((issue) => issue.code === "CONTENT_CONFLICT" || issue.code === "STALE_EVIDENCE")];
    const blockingIssues = [...new Set(issues.filter((issue) => !issue.path?.startsWith("participants."))
      .map((issue) => ISSUE_TEXT[issue.code] ?? "这份 Demo 还有未能确认的数据问题，请核对数据来源或拒绝。"))];
    const conflicts = participants.filter((participant) => participant.state.startsWith("conflict-")).length;
    const rosterMismatches = participants.filter((participant) => participant.state === "roster-mismatch").length;
    const unresolved = participants.length - conflicts - rosterMismatches;
    const message = participants.length > 0
      ? `需要处理：${[
          unresolved > 0 ? `${unresolved} 名选手 Steam 身份未确认` : "",
          conflicts > 0 ? `${conflicts} 名选手 Steam64 已关联其他选手` : "",
          rosterMismatches > 0 ? `${rosterMismatches} 名选手实际出场与本场记录首发不一致` : "",
        ].filter(Boolean).join("；")}`
      : "这份 Demo 当前不是 Steam 身份确认问题。";
    return { ...base, invalidPayload: false, message, resolvedCount, blockingIssues: blockingIssues.length > 0 ? blockingIssues
      : participants.length === 0 ? ["当前身份已正常匹配，待处理记录仍需核对；本页刷新不会自动写入比赛统计。"] : [], participants };
  } catch {
    return { ...base, invalidPayload: false, message: "当前无法核对选手身份，请联系平台管理员检查赛事身份资料后重试。",
      resolvedCount: 0, blockingIssues: [], participants: [] };
  }
}
