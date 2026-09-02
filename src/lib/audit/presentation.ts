/**
 * Audit-log presentation is deliberately separate from the audit fact.
 * Nothing in this module reads the database or exposes the stored meta.
 */

export const AUDIT_LOG_LOAD_ERROR_MESSAGE = "操作日志加载失败，请稍后重试。";

const AUDIT_CATEGORIES = {
  admin: { label: "管理", color: "var(--color-accent)" },
  registration: { label: "报名", color: "var(--color-ok)" },
  captain: { label: "队长投票", color: "var(--color-info)" },
  draft: { label: "选秀", color: "var(--color-accent)" },
  match: { label: "赛程", color: "var(--color-accent-b)" },
  season: { label: "赛季", color: "var(--color-warn)" },
  team: { label: "队伍", color: "var(--color-info)" },
  entry: { label: "参赛队", color: "var(--color-info)" },
  user: { label: "用户", color: "var(--color-fg-mid)" },
  education: { label: "教育认证", color: "var(--color-ok)" },
  competitive: { label: "竞技资料", color: "var(--color-info)" },
  major: { label: "Major", color: "var(--color-accent-b)" },
  postevent: { label: "赛后裁定", color: "var(--color-warn)" },
  postmatch: { label: "赛后资料", color: "var(--color-accent-b)" },
  community: { label: "社区奖", color: "var(--color-warn)" },
  discipline: { label: "纪律", color: "var(--color-danger)" },
  recruitment: { label: "招募", color: "var(--color-info)" },
} as const;

type AuditCategory = keyof typeof AUDIT_CATEGORIES;

interface AuditActionDefinition {
  label: string;
  category: AuditCategory;
}

/**
 * This is the only action dictionary used by the log UI. Keep compatibility
 * entries here as well: old immutable rows must remain readable after a
 * producer has been retired.
 */
export const AUDIT_ACTION_DEFINITIONS: Readonly<Record<string, AuditActionDefinition>> = {
  "admin.create_invite": { label: "创建管理员邀请码", category: "admin" },
  "admin.deactivate_invite": { label: "停用管理员邀请码", category: "admin" },
  "admin.register": { label: "管理员注册", category: "admin" },
  "admin.change_password": { label: "修改管理员密码", category: "admin" },
  "admin.revoke_role": { label: "撤销管理员权限", category: "admin" },
  "admin.deactivate_user": { label: "停用用户", category: "admin" },
  "admin.reactivate_user": { label: "恢复用户", category: "admin" },

  "registration.submit": { label: "提交报名", category: "registration" },
  "registration.pending": { label: "报名设为待审核", category: "registration" },
  "registration.approved": { label: "通过报名", category: "registration" },
  "registration.rejected": { label: "驳回报名", category: "registration" },
  "registration.waitlisted": { label: "报名列入候补", category: "registration" },
  "registration.approve": { label: "通过报名", category: "registration" },
  "registration.reject": { label: "驳回报名", category: "registration" },
  "registration.waitlist": { label: "报名列入候补", category: "registration" },

  "captain.cast_vote": { label: "投出队长票", category: "captain" },
  "captain.retract_vote": { label: "撤回队长票", category: "captain" },
  "captain.confirm": { label: "确认队长分组", category: "captain" },

  "draft.start": { label: "开始选秀", category: "draft" },
  "draft.pick": { label: "完成选秀选人", category: "draft" },
  "draft.skip_turn": { label: "跳过选秀回合", category: "draft" },
  "draft.pause": { label: "暂停选秀", category: "draft" },
  "draft.resume": { label: "恢复选秀", category: "draft" },

  "match.generate_schedule": { label: "生成赛程", category: "match" },
  "match.initialize_stage": { label: "初始化比赛阶段", category: "match" },
  "match.create": { label: "创建比赛", category: "match" },
  "match.record_result": { label: "录入比赛比分", category: "match" },
  "match.record_map_result": { label: "录入地图比分", category: "match" },
  "match.save_player_stats": { label: "录入地图选手数据", category: "match" },
  "match.delete_player_stats": { label: "删除地图选手数据", category: "match" },
  "match.status_update": { label: "更新比赛状态", category: "match" },
  "match.start": { label: "开始比赛", category: "match" },
  "match.submit_roster": { label: "提交比赛阵容", category: "match" },
  "match.roster.submit": { label: "提交比赛阵容", category: "match" },
  "match.roster.admin_select": { label: "管理员选择首发", category: "match" },
  "match.roster.confirm": { label: "确认比赛首发", category: "match" },
  "match.roster.unlock": { label: "解锁比赛阵容", category: "match" },
  "match.unlock_roster": { label: "解锁比赛阵容", category: "match" },
  "match.save_veto": { label: "保存禁选流程", category: "match" },
  "match.propose_time": { label: "提议比赛时间", category: "match" },
  "match.respond_time_proposal": { label: "回应时间提议", category: "match" },
  "match.force_set_time": { label: "强制设定比赛时间", category: "match" },
  "match.auto_accept_proposal_timeout": { label: "超时自动接受时间提议", category: "match" },
  "match.auto_award_time": { label: "自动裁定比赛时间", category: "match" },
  "match.update_scheduled_at": { label: "更新比赛时间", category: "match" },
  "match.update_completion_deadline": { label: "更新完赛截止时间", category: "match" },
  "match.batch_set_completion_deadline": { label: "批量设置完赛截止时间", category: "match" },
  "match.correct_score": { label: "修正比赛比分", category: "match" },
  "match.correct_map_score": { label: "修正地图比分", category: "match" },
  "match.delete": { label: "删除比赛", category: "match" },
  "match.forfeit": { label: "判定比赛弃权", category: "match" },
  "update_match_completed_at": { label: "更新比赛完成时间", category: "match" },
  "match.result.corrected": { label: "修正正式赛果", category: "match" },
  "match.managed.invalidated": { label: "使后续比赛失效", category: "match" },
  "match.recovery.adjudicated": { label: "裁定比赛恢复结果", category: "match" },

  "season.create": { label: "创建赛季", category: "season" },
  "season.update": { label: "更新赛季", category: "season" },
  "season.publish": { label: "发布赛季", category: "season" },
  "season.deleted": { label: "删除赛季", category: "season" },
  "season.revert_to_draft": { label: "撤回至草稿阶段", category: "season" },
  "season.revert_to_registration": { label: "撤回至报名阶段", category: "season" },
  "season.force_finish": { label: "手动结束赛季", category: "season" },
  "season.archive": { label: "归档赛季", category: "season" },
  "season.auto_advance": { label: "自动推进赛季阶段", category: "season" },
  "season.auto_finish": { label: "自动结束赛季", category: "season" },
  "season.registration_open": { label: "开放赛季报名", category: "season" },

  "team.create": { label: "创建队伍", category: "team" },
  "team.update_profile": { label: "更新队伍资料", category: "team" },
  "team.logo.update": { label: "更新队伍标志", category: "team" },
  "team.rename": { label: "修改队伍名称", category: "team" },
  "team.upload_logo": { label: "上传队伍标志", category: "team" },
  "team.invite": { label: "邀请队员", category: "team" },
  "team.invite.accept": { label: "接受队伍邀请", category: "team" },
  "team.invite.decline": { label: "拒绝队伍邀请", category: "team" },
  "team.invite.revoke": { label: "撤销队伍邀请", category: "team" },
  "team.membership.status_change": { label: "调整队员状态", category: "team" },
  "team.membership.leave": { label: "队员退出队伍", category: "team" },
  "team.membership.kick": { label: "移出队员", category: "team" },
  "team.captain.transfer": { label: "转移队长", category: "team" },
  "team.disband": { label: "解散队伍", category: "team" },

  "competition_entry.create": { label: "创建参赛队", category: "entry" },
  "competition_entry.participant.reinvite": { label: "重新邀请参赛成员", category: "entry" },
  "competition_entry.participant.confirm": { label: "确认参赛成员", category: "entry" },
  "competition_entry.participant.withdraw": { label: "参赛成员退出", category: "entry" },
  "competition_entry.participant.decline": { label: "拒绝参赛邀请", category: "entry" },
  "competition_entry.roster.save": { label: "保存参赛队阵容", category: "entry" },
  "competition_entry.roster_change.request": { label: "申请修改参赛阵容", category: "entry" },
  "competition_entry.withdraw": { label: "撤回参赛队报名", category: "entry" },
  "competition_entry.submit": { label: "提交参赛队报名", category: "entry" },
  "competition_entry.submitted": { label: "参赛队进入待审核", category: "entry" },
  "competition_entry.changes_requested": { label: "要求修改参赛队报名", category: "entry" },
  "competition_entry.waitlisted": { label: "参赛队列入候补", category: "entry" },
  "competition_entry.approved": { label: "通过参赛队报名", category: "entry" },
  "competition_entry.rejected": { label: "驳回参赛队报名", category: "entry" },
  "competition_entry.withdrawn": { label: "参赛队退出赛事", category: "entry" },
  "competition_entry.representative.transfer": { label: "转移参赛队代表", category: "entry" },

  "user.change_password": { label: "修改密码", category: "user" },
  "user.claim_invite": { label: "使用管理员邀请码", category: "user" },
  "user.owner_bootstrap": { label: "初始化平台所有者", category: "user" },

  "education_verification.submit": { label: "提交教育认证", category: "education" },
  "education_verification.institutional_email": { label: "通过校邮箱完成认证", category: "education" },
  "education_verification.approved": { label: "通过教育认证审核", category: "education" },
  "education_verification.rejected": { label: "驳回教育认证审核", category: "education" },

  "competitive_platform.update": { label: "更新竞技平台", category: "competitive" },
  "competitive_platform_season.create": { label: "创建平台赛季目录", category: "competitive" },
  "competitive_platform_season.update": { label: "更新平台赛季目录", category: "competitive" },
  "competitive_platform_season.set_active": { label: "调整平台赛季启用状态", category: "competitive" },
  "competitive_platform_season.set_current": { label: "切换当前平台赛季", category: "competitive" },
  "competitive_platform_season.move": { label: "调整平台赛季顺序", category: "competitive" },
  "competitive_platform_season.delete": { label: "删除平台赛季目录", category: "competitive" },
  "competitive_platform_rank.create": { label: "创建平台段位", category: "competitive" },
  "competitive_platform_rank.rename": { label: "重命名平台段位", category: "competitive" },
  "competitive_platform_rank.move": { label: "调整平台段位顺序", category: "competitive" },
  "competitive_platform_rank.delete": { label: "删除平台段位", category: "competitive" },
  "competitive_profile.self_declare": { label: "更新竞技段位资料", category: "competitive" },
  "competitive_roles.self_declare": { label: "更新竞技位置资料", category: "competitive" },

  "major.start": { label: "启动 Major", category: "major" },
  "major.archive": { label: "归档 Major", category: "major" },
  "major_prestart.add_entrant": { label: "加入 Major 参赛队", category: "major" },
  "major_prestart.remove_entrant": { label: "移除 Major 参赛队", category: "major" },
  "major_prestart.save_roster": { label: "保存 Major 参赛阵容", category: "major" },
  "major_prestart.confirm_roster": { label: "确认 Major 参赛阵容", category: "major" },
  "major_prestart.reopen_roster": { label: "重新打开 Major 阵容", category: "major" },
  "major_prestart.add_issue": { label: "记录 Major 赛前问题", category: "major" },
  "major_prestart.resolve_issue": { label: "解决 Major 赛前问题", category: "major" },
  "major_prestart.lock_entrants": { label: "锁定 Major 参赛队", category: "major" },
  "major_prestart.save_tournament_seeds": { label: "保存 Major 种子", category: "major" },
  "major_prestart.confirm_tournament_seeds": { label: "确认 Major 种子", category: "major" },
  "major.swiss.finalize_round": { label: "确认 Major 瑞士轮", category: "major" },
  "major.stage.transition": { label: "推进 Major 阶段", category: "major" },
  "major.playoff.start": { label: "启动 Major 淘汰赛", category: "major" },
  "major.playoff.finalize_round": { label: "确认 Major 淘汰赛轮次", category: "major" },
  "major.result.pending_confirmation": { label: "生成待确认 Major 赛果", category: "major" },
  "major.result.confirm": { label: "确认 Major 最终赛果", category: "major" },
  "major.stage.finalized_round.revoked": { label: "撤销 Major 轮次确认", category: "major" },

  "postevent.adjudication.create": { label: "创建赛后裁定", category: "postevent" },
  "postevent.adjudication.revoke": { label: "撤销赛后裁定", category: "postevent" },
  "postevent.honor.grant": { label: "授予赛事荣誉", category: "postevent" },
  "postevent.honor.revoke": { label: "撤销赛事荣誉", category: "postevent" },

  "postmatch.commentator.add": { label: "登记比赛解说", category: "postmatch" },
  "postmatch.commentator.remove": { label: "移除比赛解说", category: "postmatch" },
  "postmatch.video.update": { label: "更新比赛录像", category: "postmatch" },
  "postmatch.report.submit": { label: "提交赛后资料", category: "postmatch" },
  "postmatch.report.revoke": { label: "撤销赛后资料", category: "postmatch" },

  "community_award.submit": { label: "提交社区奖", category: "community" },
  "community_award.revise": { label: "重新提交社区奖", category: "community" },
  "community_award.request_supplement": { label: "要求补充社区奖材料", category: "community" },
  "community_award.withdraw": { label: "撤回社区奖", category: "community" },
  "community_award.evidence.submit": { label: "提交社区奖证据", category: "community" },
  "community_award.approved": { label: "通过社区奖审核", category: "community" },
  "community_award.rejected": { label: "驳回社区奖审核", category: "community" },
  "community_award.awarded": { label: "记录社区奖获奖结果", category: "community" },
  "community_award.not_awarded": { label: "记录社区奖不颁结果", category: "community" },
  "community_award.cancelled": { label: "取消社区奖结果", category: "community" },

  "sanction.issue": { label: "发出纪律处罚", category: "discipline" },
  "sanction.revoke": { label: "撤销纪律处罚", category: "discipline" },
  "sanction.expire": { label: "使纪律处罚到期", category: "discipline" },

  "recruitment.team.upsert": { label: "更新队伍招募意向", category: "recruitment" },
  "recruitment.team.create": { label: "发布队伍招募意向", category: "recruitment" },
  "recruitment.team.close": { label: "关闭队伍招募意向", category: "recruitment" },
  "recruitment.player.upsert": { label: "更新个人求队意向", category: "recruitment" },
  "recruitment.player.create": { label: "发布个人求队意向", category: "recruitment" },
  "recruitment.player.close": { label: "关闭个人求队意向", category: "recruitment" },
  "recruitment.interest.create": { label: "提交招募意向申请", category: "recruitment" },
  "recruitment.interest.withdraw": { label: "撤回招募意向申请", category: "recruitment" },
  "recruitment.interest.dismiss": { label: "忽略招募意向申请", category: "recruitment" },

  // Historical v1/team-application keys retained for readable old rows.
  "team_application.create": { label: "创建报名队伍", category: "entry" },
  "team_application.update": { label: "更新报名队伍", category: "entry" },
  "team_application.create_join_link": { label: "生成队伍邀请链接", category: "entry" },
  "team_application.regenerate_join_link": { label: "重新生成队伍邀请链接", category: "entry" },
  "team_application.claim_join_link": { label: "通过邀请链接加入队伍", category: "entry" },
  "team_application.confirm_member": { label: "确认报名成员", category: "entry" },
  "team_application.submit": { label: "提交队伍报名", category: "entry" },
  "team_application.rejected": { label: "退回队伍报名", category: "entry" },
  "team_application.waitlisted": { label: "队伍报名列入候补", category: "entry" },
  "team_application.approved": { label: "通过队伍报名", category: "entry" },
  "team_application.materialize": { label: "生成正式参赛队", category: "entry" },
} as const;

export const AUDIT_ACTION_KEYS = Object.freeze(Object.keys(AUDIT_ACTION_DEFINITIONS));

export interface AuditActionPresentation {
  actionKey: string;
  label: string;
  categoryLabel: string;
  categoryColor: string;
  known: boolean;
}

export interface AuditActionFilterOption {
  value: string;
  label: string;
  categoryLabel: string;
}

export interface AuditLogView {
  id: string;
  createdAt: string;
  actionKey: string;
  actionLabel: string;
  categoryLabel: string;
  categoryColor: string;
  actorLabel: string;
  targetTypeLabel: string;
  targetLabel: string;
  summary: string | null;
}

export function getAuditActionPresentation(action: string | null | undefined): AuditActionPresentation {
  const actionKey = action ?? "";
  const definition = AUDIT_ACTION_DEFINITIONS[actionKey];
  if (!definition) {
    return {
      actionKey,
      label: "未知操作",
      categoryLabel: "其他",
      categoryColor: "var(--color-fg-dim)",
      known: false,
    };
  }

  const category = AUDIT_CATEGORIES[definition.category];
  return {
    actionKey,
    label: definition.label,
    categoryLabel: category.label,
    categoryColor: category.color,
    known: true,
  };
}

export function getAuditActionFilterOptions(): AuditActionFilterOption[] {
  return AUDIT_ACTION_KEYS.map((value) => {
    const presentation = getAuditActionPresentation(value);
    return { value, label: presentation.label, categoryLabel: presentation.categoryLabel };
  });
}

const TARGET_TYPE_LABELS: Readonly<Record<string, string>> = {
  user: "用户",
  admin_user: "管理员",
  season: "赛季",
  team: "队伍",
  competition_entry: "参赛队",
  team_application: "报名队伍",
  registration: "报名记录",
  captain_vote: "队长投票",
  draft_state: "选秀状态",
  draft_pick: "选秀选人",
  match: "比赛",
  match_map: "比赛地图",
  match_roster: "比赛阵容",
  match_time_proposal: "比赛时间提议",
  education_verification: "教育认证",
  competitive_platform: "竞技平台",
  competitive_platform_rank: "平台段位",
  competitive_platform_season: "平台赛季目录",
  disciplinary_case: "纪律案件",
  admin_invite: "管理员邀请码",
  community_award: "社区奖",
  community_award_evidence: "社区奖证据",
  major_prestart_state: "Major 赛前状态",
  major_prestart_entrant: "Major 赛前参赛队",
  major_prestart_issue: "Major 赛前问题",
  major_tournament_entrant: "Major 参赛队",
  major_stage_run: "Major 阶段",
  major_final_result: "Major 最终赛果",
  post_event_adjudication: "赛后裁定",
  tournament_honor: "赛事荣誉",
  recruitment_intent: "招募意向",
  recruitment_interest: "招募意向申请",
};

export function getAuditTargetTypeLabel(targetType: string | null | undefined): string {
  return (targetType && TARGET_TYPE_LABELS[targetType]) ?? "其他对象";
}

export function getAuditTargetFallbackLabel(targetId: string | null | undefined): string {
  if (!targetId) return "未指定目标";
  const shortId = targetId.trim().slice(0, 8);
  return shortId ? `记录未找到 · ${shortId}` : "记录未找到";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberValue(meta: Record<string, unknown>, key: string): number | null {
  return typeof meta[key] === "number" && Number.isFinite(meta[key]) ? meta[key] as number : null;
}

function booleanValue(meta: Record<string, unknown>, key: string): boolean | null {
  return typeof meta[key] === "boolean" ? meta[key] as boolean : null;
}

const STATE_LABELS: Readonly<Record<string, string>> = {
  draft: "草稿",
  pending: "待处理",
  pending_review: "待审核",
  submitted: "已提交",
  changes_requested: "待修改",
  approved: "已通过",
  rejected: "已驳回",
  waitlisted: "候补",
  withdrawn: "已撤回",
  open: "开放",
  closed: "已关闭",
  active: "生效",
  inactive: "停用",
  revoked: "已撤销",
  expired: "已到期",
  scheduled: "已排期",
  in_progress: "进行中",
  finished: "已结束",
  cancelled: "已取消",
  registration: "报名阶段",
  voting: "投票阶段",
  drafting: "选秀阶段",
  playing: "比赛阶段",
  archived: "已归档",
  awarded: "已颁发",
  not_awarded: "未颁发",
  vacant: "空缺",
  confirmed: "已确认",
  preparing: "准备中",
  frozen: "已冻结",
};

const EVIDENCE_TYPE_LABELS: Readonly<Record<string, string>> = {
  institutional_email: "校邮箱",
  chsi_enrollment_report: "学信网在读报告",
  chsi_education_report: "学信网学历报告",
  manual_other: "其他材料",
};

function safeState(value: unknown): string | null {
  return typeof value === "string" ? STATE_LABELS[value] ?? null : null;
}

function appendCount(parts: string[], meta: Record<string, unknown>, key: string, label: string): void {
  const value = numberValue(meta, key);
  if (value !== null && value >= 0) parts.push(`${label} ${value}`);
}

function appendBoolean(parts: string[], meta: Record<string, unknown>, key: string, yes: string, no?: string): void {
  const value = booleanValue(meta, key);
  if (value === true) parts.push(yes);
  else if (value === false && no) parts.push(no);
}

/**
 * Convert only explicitly approved, low-sensitivity fields to a short line.
 * In particular, this function never stringifies the object and never emits
 * evidence, tokens, notes, reasons, email addresses, URLs, or internal IDs.
 */
export function summarizeAuditMeta(action: string, meta: unknown): string | null {
  if (!isRecord(meta)) return null;

  const parts: string[] = [];
  const scoreA = numberValue(meta, "scoreA");
  const scoreB = numberValue(meta, "scoreB");
  if (scoreA !== null && scoreB !== null && action.startsWith("match.")) {
    parts.push(`比分 ${scoreA}:${scoreB}`);
  }

  if (action.startsWith("match.")) {
    appendCount(parts, meta, "mapOrder", "第");
    appendCount(parts, meta, "playerCount", "选手");
    appendCount(parts, meta, "stepCount", "步骤");
    appendBoolean(parts, meta, "seriesFinished", "系列赛已完成");
    appendBoolean(parts, meta, "winnerChanged", "胜者已变化");
    appendBoolean(parts, meta, "isForfeit", "弃权赛果");
    appendBoolean(parts, meta, "postMatch", "赛后修改");
  }

  appendCount(parts, meta, "matchCount", "比赛");
  appendCount(parts, meta, "rosterSize", "阵容人数");
  appendCount(parts, meta, "primaryStarterCount", "首发");
  appendCount(parts, meta, "entrantCount", "参赛队");
  appendCount(parts, meta, "seedCount", "种子");
  appendCount(parts, meta, "placementGroupCount", "名次组");
  appendCount(parts, meta, "createdNextRound", "生成下轮比赛");
  appendCount(parts, meta, "managedMatches", "托管比赛");
  appendCount(parts, meta, "approvedCount", "通过");
  appendCount(parts, meta, "revision", "修订");
  appendCount(parts, meta, "rosterRevision", "阵容修订");

  const from = safeState(meta.from);
  const to = safeState(meta.to);
  if (from && to) parts.push(`状态 ${from} → ${to}`);
  else if (to) parts.push(`状态 ${to}`);

  const evidenceType = typeof meta.evidenceType === "string" ? EVIDENCE_TYPE_LABELS[meta.evidenceType] : undefined;
  if (evidenceType && action.startsWith("education_verification.")) parts.push(`材料 ${evidenceType}`);

  appendBoolean(parts, meta, "reviewNote", "含审核备注");
  appendBoolean(parts, meta, "hasReviewNote", "含审核备注");
  appendBoolean(parts, meta, "hasPublicNote", "含公开说明");
  appendBoolean(parts, meta, "hasVideoUrl", "已关联录像", "未关联录像");
  appendBoolean(parts, meta, "prestartInvalidated", "已使赛前状态失效");
  appendBoolean(parts, meta, "active", "已启用", "已停用");
  appendBoolean(parts, meta, "isCurrent", "已设为当前");
  appendBoolean(parts, meta, "autoPicked", "自动选人");

  if (typeof meta.direction === "string") {
    const directionLabel = { up: "上移", down: "下移", left: "左移", right: "右移" }[meta.direction];
    if (directionLabel) parts.push(directionLabel);
  }

  const sourceLabel = typeof meta.source === "string"
    ? ({ linked_team: "关联队伍", event_native: "赛事原生" } as Record<string, string>)[meta.source]
    : undefined;
  if (sourceLabel) parts.push(sourceLabel);

  if (parts.length > 0) return parts.join(" · ");
  return Object.keys(meta).length > 0 ? "已记录" : null;
}
