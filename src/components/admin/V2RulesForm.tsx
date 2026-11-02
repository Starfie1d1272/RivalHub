"use client";

import { useId, useState } from "react";
import { toast } from "sonner";
import { EducationInstitutionSelector, type EducationInstitutionOption } from "@/components/settings/EducationInstitutionSelector";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { resolveCompetitiveSourceSelection } from "@/lib/competitive/source-selection";
import { NO_RANK, type CompetitivePlatformOption } from "@/components/admin/SeasonSettingsFacts";

import type { InstitutionAffiliationRule, StoredTeamRegistrationConfigV2 } from "@/types/season";

type Props = {
  value: StoredTeamRegistrationConfigV2;
  onChange: (value: StoredTeamRegistrationConfigV2) => void;
  affiliationRules: InstitutionAffiliationRule[];
  onAffiliationRulesChange: (rules: InstitutionAffiliationRule[]) => void;
  currentMin: string; peakMin: string;
  onCurrentMinChange: (value: string) => void; onPeakMinChange: (value: string) => void;
  platforms: CompetitivePlatformOption[]; disabled: boolean;
  institutionOptions: EducationInstitutionOption[];
  conversionPolicies: Array<{ id: string; version: string; isCurrent: boolean }>;
  hasCaptainVoting: boolean; hasDraft: boolean; starterCount: number; maxTeamSize: number;
};

export function V2RulesForm({ value, onChange, affiliationRules, onAffiliationRulesChange, currentMin, peakMin, onCurrentMinChange, onPeakMinChange, platforms, institutionOptions, conversionPolicies, disabled, hasCaptainVoting, hasDraft, starterCount, maxTeamSize }: Props) {
  const id = useId();
  const [knownInstitutions, setKnownInstitutions] = useState(institutionOptions);
  const policy = value.qualificationPolicy;
  const selectedPlatform = platforms.find(platform => platform.key === policy.competitiveProfile?.platform);
  const ranks = selectedPlatform?.ranks ?? [];
  const setPolicy = (patch: Partial<typeof policy>) => onChange({ ...value, qualificationPolicy: { ...policy, ...patch } });
  const needsContext = policy.competitiveProfileRequired || policy.externalStrengthGap.enabled || currentMin !== NO_RANK || peakMin !== NO_RANK || value.seeding.mode === "strength_recommendation";
  const updateRule = (index: number, patch: Partial<InstitutionAffiliationRule>) => onAffiliationRulesChange(affiliationRules.map((rule, i) => i === index ? { ...rule, ...patch } : rule));
  return <div className="space-y-6">
    {(hasCaptainVoting || hasDraft) && <section className="space-y-3"><h3 className="text-sm font-medium">编队</h3><div className="grid gap-4 sm:grid-cols-2">
      {hasCaptainVoting && <div><Label htmlFor={`${id}-teams`}>投票确认的队伍数量</Label><Input id={`${id}-teams`} type="number" min={1} disabled={disabled} value={value.formation.targetTeamCount ?? ""} onChange={e => onChange({ ...value, formation: { ...value.formation, targetTeamCount: e.target.value === "" ? null : Number(e.target.value) } })} /></div>}
      {hasCaptainVoting && <><div><Label htmlFor={`${id}-votes`}>每人票数</Label><Input id={`${id}-votes`} type="number" min={1} disabled={disabled} value={value.formation.votesPerPerson} onChange={e => onChange({ ...value, formation: { ...value.formation, votesPerPerson: Number(e.target.value) } })} /></div><div><Label htmlFor={`${id}-minimum-votes`}>确认队长最低票数</Label><Input id={`${id}-minimum-votes`} type="number" min={0} disabled={disabled} value={value.formation.minimumVotesToConfirm} onChange={e => onChange({ ...value, formation: { ...value.formation, minimumVotesToConfirm: Number(e.target.value) } })} /></div></>}
      {hasDraft && <div><Label htmlFor={`${id}-draft-timeout`}>每次选人时限（秒）</Label><Input id={`${id}-draft-timeout`} type="number" min={1} disabled={disabled} value={value.formation.draftTimeoutSeconds} onChange={e => onChange({ ...value, formation: { ...value.formation, draftTimeoutSeconds: Number(e.target.value) } })} /></div>}
      {hasDraft && <div><Label htmlFor={`${id}-target-roster`}>选秀后每队目标人数</Label><Input id={`${id}-target-roster`} type="number" min={starterCount} max={maxTeamSize} disabled={disabled} value={value.formation.targetRosterSize ?? ""} onChange={e => onChange({ ...value, formation: { ...value.formation, targetRosterSize: e.target.value === "" ? null : Number(e.target.value) } })} /><p className="mt-1 text-xs text-[var(--color-fg-dim)]">范围 {starterCount}–{maxTeamSize} 人；选秀轮数按目标人数扣除已有队长计算。</p></div>}
    </div></section>}
    <section className="space-y-3">
      <h3 className="text-sm font-medium">成员资格</h3>
      <div className="grid gap-3 sm:grid-cols-2 text-sm">
        <label className="flex items-center gap-2"><Checkbox disabled={disabled} checked={policy.educationRequired} onChange={e => setPolicy({ educationRequired: e.target.checked })} />要求教育认证</label>
        <label className="flex items-center gap-2"><Checkbox disabled={disabled} checked={policy.contacts.qqRequired} onChange={e => setPolicy({ contacts: { ...policy.contacts, qqRequired: e.target.checked } })} />要求 QQ</label>
        <label className="flex items-center gap-2"><Checkbox disabled={disabled} checked={policy.contacts.emailVerifiedRequired} onChange={e => setPolicy({ contacts: { ...policy.contacts, emailVerifiedRequired: e.target.checked } })} />要求已验证邮箱</label>
        <label className="flex items-center gap-2"><Checkbox disabled={disabled} checked={policy.competitiveProfileRequired} onChange={e => setPolicy({ competitiveProfileRequired: e.target.checked })} />要求竞技资料完整</label>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">{([["当前段位门槛", "current", currentMin, onCurrentMinChange], ["历史段位门槛", "peak", peakMin, onPeakMinChange]] as const).map(([label, key, selected, set]) => <div key={key}><Label htmlFor={`${id}-${key}-rank`}>{label}</Label><Select disabled={disabled} value={selected} onValueChange={set}><SelectTrigger id={`${id}-${key}-rank`}><SelectValue placeholder="请选择门槛" /></SelectTrigger><SelectContent><SelectItem value="__select_rank__" disabled>请重新选择门槛</SelectItem><SelectItem value={NO_RANK}>无门槛</SelectItem>{selected !== NO_RANK && selected !== "__select_rank__" && !ranks.some(rank => rank.rankKey === selected) && <SelectItem value={selected} disabled>原有门槛 {selected}（不在当前目录）</SelectItem>}{ranks.map(rank => <SelectItem key={rank.rankKey} value={rank.rankKey}>{rank.label}</SelectItem>)}</SelectContent></Select>{selected === "__select_rank__" && <p className="mt-1 text-xs text-[var(--color-danger)]">平台已更改，请重新选择此门槛。</p>}</div>)}</div>
    </section>
    <section className="space-y-3"><h3 className="text-sm font-medium">名单与首发机构要求</h3>
      {affiliationRules.map((rule, index) => <div key={index} className="grid gap-3 rounded-sm border border-[var(--color-border)] p-3 sm:grid-cols-3">
        <div className="sm:col-span-3"><EducationInstitutionSelector idPrefix={`${id}-institution-${index}`} value={rule.institutionCode ? knownInstitutions.find(item => item.code === rule.institutionCode) ?? { id: rule.institutionCode, name: `机构 ${rule.institutionCode}`, code: rule.institutionCode, province: null } : null} disabled={disabled} onChange={item => { if (item && !item.code) { toast.error("该学校缺少机构代码，请先完善目录。"); return; } if (item) setKnownInstitutions(current => [...current.filter(existing => existing.code !== item.code), item]); updateRule(index, { institutionCode: item?.code ?? "" }); }} /></div>
        <div><Label htmlFor={`${id}-roster-${index}`}>名单最少人数</Label><Input id={`${id}-roster-${index}`} type="number" min={0} disabled={disabled} value={rule.minRosterMembers} onChange={e => updateRule(index, { minRosterMembers: Number(e.target.value) })} /></div>
        <div><Label htmlFor={`${id}-lineup-${index}`}>首发最少人数</Label><Input id={`${id}-lineup-${index}`} type="number" min={0} disabled={disabled} value={rule.minStartingMembers} onChange={e => updateRule(index, { minStartingMembers: Number(e.target.value) })} /></div>
        {(["enrolled", "graduated"] as const).map(status => <label key={status} className="flex items-center gap-2 text-sm"><Checkbox disabled={disabled} checked={rule.eligibleAcademicStatuses.includes(status)} onChange={e => updateRule(index, { eligibleAcademicStatuses: e.target.checked ? [...rule.eligibleAcademicStatuses, status] : rule.eligibleAcademicStatuses.filter(item => item !== status) })} />{status === "enrolled" ? "在读" : "毕业"}</label>)}
        <Button type="button" variant="ghost" disabled={disabled} onClick={() => onAffiliationRulesChange(affiliationRules.filter((_, i) => i !== index))}>移除机构</Button>
      </div>)}
      <Button type="button" variant="outline" disabled={disabled} onClick={() => onAffiliationRulesChange([...affiliationRules, { institutionCode: "", eligibleAcademicStatuses: ["enrolled", "graduated"], minRosterMembers: 0, minStartingMembers: 0 }])}>添加机构</Button>
    </section>
    <section className="space-y-3"><h3 className="text-sm font-medium">竞技用途</h3>
      <label className="flex items-center gap-2 text-sm"><Checkbox disabled={disabled} checked={policy.externalStrengthGap.enabled} onChange={e => setPolicy({ externalStrengthGap: { ...policy.externalStrengthGap, enabled: e.target.checked } })} />限制外校历史实力星差</label>
      {policy.externalStrengthGap.enabled && <div><Label htmlFor={`${id}-gap`}>最大星差</Label><Input id={`${id}-gap`} type="number" min={0} max={100} disabled={disabled} value={policy.externalStrengthGap.maxGap} onChange={e => setPolicy({ externalStrengthGap: { ...policy.externalStrengthGap, maxGap: Number(e.target.value) } })} /></div>}
      {needsContext && <div className="space-y-3"><div><Label htmlFor={`${id}-platform`}>竞技平台</Label><Select disabled={disabled} value={policy.competitiveProfile?.platform ?? ""} onValueChange={platform => { if (platform !== policy.competitiveProfile?.platform) { if (currentMin !== NO_RANK) onCurrentMinChange("__select_rank__"); if (peakMin !== NO_RANK) onPeakMinChange("__select_rank__"); setPolicy({ competitiveProfile: { platform, currentSeasonKey: "", previousSeasonKey: "", rankOrder: [], sourceSelection: resolveCompetitiveSourceSelection(policy.competitiveProfile) } }); } }}><SelectTrigger id={`${id}-platform`}><SelectValue placeholder="选择平台" /></SelectTrigger><SelectContent>{platforms.map(platform => <SelectItem key={platform.key} value={platform.key}>{platform.displayName}</SelectItem>)}</SelectContent></Select></div>
        {policy.competitiveProfile && <div><Label htmlFor={`${id}-source`}>竞技证据选择</Label><Select disabled={disabled} value={resolveCompetitiveSourceSelection(policy.competitiveProfile)} onValueChange={sourceSelection => setPolicy({ competitiveProfile: { ...policy.competitiveProfile!, sourceSelection: sourceSelection as "primary_then_fallback" | "strongest_equivalent" } })}><SelectTrigger id={`${id}-source`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="primary_then_fallback">主平台优先</SelectItem><SelectItem value="strongest_equivalent">可用等效资料取较高水平</SelectItem></SelectContent></Select></div>}
        {policy.competitiveProfile?.platform === "perfect_world" && <div><Label htmlFor={`${id}-conversion`}>5E 等效换算策略</Label><Select disabled={disabled} value={policy.competitiveProfile.conversionPolicyId ?? "__none__"} onValueChange={selected => { const profile = { ...policy.competitiveProfile! }; delete profile.conversionPolicyId; delete profile.conversionPolicyVersion; delete profile.fallbackConversion; const choice = conversionPolicies.find(item => item.id === selected); if (choice) { profile.conversionPolicyId = choice.id; profile.conversionPolicyVersion = choice.version; } setPolicy({ competitiveProfile: profile }); }}><SelectTrigger id={`${id}-conversion`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__none__">不启用</SelectItem>{policy.competitiveProfile.conversionPolicyId && !conversionPolicies.some(item => item.id === policy.competitiveProfile?.conversionPolicyId) && <SelectItem value={policy.competitiveProfile.conversionPolicyId} disabled>已选策略不可用，请重新选择</SelectItem>}{conversionPolicies.map(item => <SelectItem key={item.id} value={item.id}>{item.version}{item.isCurrent ? "（当前）" : ""}</SelectItem>)}</SelectContent></Select></div>}
      </div>}
    </section>
    <section className="space-y-3"><h3 className="text-sm font-medium">名单调整</h3><div className="grid gap-3 sm:grid-cols-2 text-sm">
      <label className="flex items-center gap-2"><Checkbox disabled={disabled} checked={value.rosterChanges.representativeCanRemove} onChange={e => onChange({ ...value, rosterChanges: { ...value.rosterChanges, representativeCanRemove: e.target.checked } })} />负责人可移除成员</label>
      <label className="flex items-center gap-2"><Checkbox disabled={disabled} checked={value.rosterChanges.representativeCanTransfer} onChange={e => onChange({ ...value, rosterChanges: { ...value.rosterChanges, representativeCanTransfer: e.target.checked } })} />负责人可转让职责</label>
      <label className="flex items-center gap-2"><Checkbox disabled={disabled} checked={value.rosterChanges.selfServiceAfterApproval} onChange={e => onChange({ ...value, rosterChanges: { ...value.rosterChanges, selfServiceAfterApproval: e.target.checked } })} />审核通过后允许自行调整名单</label>
    </div></section>
    <section className="space-y-3"><h3 className="text-sm font-medium">首发阵容</h3><div><Label htmlFor={`${id}-substitutes`}>单场替补人数上限</Label><Input id={`${id}-substitutes`} type="number" min={0} disabled={disabled} value={value.lineup.maxSubstitutes} onChange={e => onChange({ ...value, lineup: { ...value.lineup, maxSubstitutes: Number(e.target.value) } })} /></div></section>
    <section className="space-y-3"><h3 className="text-sm font-medium">比赛配置</h3><div><Label htmlFor={`${id}-seeding`}>种子安排</Label><Select disabled={disabled} value={value.seeding.mode} onValueChange={mode => onChange({ ...value, seeding: { mode: mode as typeof value.seeding.mode } })}><SelectTrigger id={`${id}-seeding`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="manual">手动安排</SelectItem><SelectItem value="strength_recommendation">按实力推荐</SelectItem></SelectContent></Select></div></section>
    <section className="space-y-3"><h3 className="text-sm font-medium">名单与队伍资料</h3><div className="grid gap-3 sm:grid-cols-2 text-sm">
      <label className="flex items-center gap-2"><Checkbox disabled={disabled} checked={value.requireUniqueTeamName} onChange={e => onChange({ ...value, requireUniqueTeamName: e.target.checked })} />队伍名称唯一</label>
      <label className="flex items-center gap-2"><Checkbox disabled={disabled} checked={value.requireTeamLogo} onChange={e => onChange({ ...value, requireTeamLogo: e.target.checked })} />要求队伍 Logo</label>
      <label className="flex items-center gap-2"><Checkbox disabled={disabled} checked={value.requirePositions} onChange={e => onChange({ ...value, requirePositions: e.target.checked })} />要求成员位置</label>
    </div>{value.requirePositions && <div><Label htmlFor={`${id}-positions`}>每位置人数上限</Label><Input id={`${id}-positions`} type="number" min={0} disabled={disabled} value={value.maxPerPositionPerTeam} onChange={e => onChange({ ...value, maxPerPositionPerTeam: Number(e.target.value) })} /></div>}</section>
  </div>;
}
