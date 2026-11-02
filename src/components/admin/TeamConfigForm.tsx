"use client";

import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { TeamRegistrationConfig } from "@/types/season";

interface TeamConfigFormProps {
  value: TeamRegistrationConfig;
  maxTeamSize?: number;
  competitivePlatforms: Array<{
    key: string;
    displayName: string;
    seasons?: Array<{ seasonKey: string; label: string; active: boolean }>;
    ranks?: Array<{ rankKey: string; label: string }>;
  }>;
  fallbackOnly?: boolean;
  view?: "all" | "team" | "competitive";
  disabled?: boolean;
  onChange: (value: TeamRegistrationConfig) => void;
}

/**
 * Product-facing surface of the team registration configuration. It only
 * exposes settings with a live runtime consumer owned by this season:
 * roster/identity rules live in the season's affiliationRules, positions in
 * season.positions, member removal in the application state machine, and the
 * competitive profile context is resolved from the global platform catalog at
 * registration open; the temporary event-owned fallback can be edited only
 * before that actual transition.
 */
export function TeamConfigForm({ value, competitivePlatforms, fallbackOnly = false, view = "all", disabled = false, onChange }: TeamConfigFormProps) {
  function set<K extends keyof TeamRegistrationConfig>(key: K, val: TeamRegistrationConfig[K]) {
    onChange({ ...value, [key]: val });
  }
  const id = useId();
  const platform = value.competitiveProfile?.platform ?? competitivePlatforms[0]?.key ?? "";
  const showTeamSettings = view !== "competitive";
  const showCompetitiveSettings = view !== "team";
  const policy = value.qualificationPolicy;
  function setPolicy(next: NonNullable<TeamRegistrationConfig["qualificationPolicy"]>) {
    onChange({ ...value, qualificationPolicy: next });
  }

  return (
    <div className="space-y-6">
      {!fallbackOnly && showTeamSettings && <div>
        <h3 className="text-sm font-medium mb-3">队伍管理</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input disabled={disabled}
              type="checkbox"
              checked={value.captainCanTransfer}
              onChange={(e) => set("captainCanTransfer", e.target.checked)}
            />
            队长可转让
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input disabled={disabled}
              type="checkbox"
              checked={value.requireUniqueTeamName}
              onChange={(e) => set("requireUniqueTeamName", e.target.checked)}
            />
            队伍名必须唯一
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input disabled={disabled}
              type="checkbox"
              checked={value.requireTeamLogo}
              onChange={(e) => set("requireTeamLogo", e.target.checked)}
            />
            强制上传队伍Logo
          </label>
        </div>
      </div>}

      {!fallbackOnly && showCompetitiveSettings && policy && <div className="space-y-3">
        <h3 className="text-sm font-medium">资格政策</h3>
        <p className="text-xs text-[var(--color-fg-dim)]">资格要求在发布后锁定；竞技平台的赛季与段位目录在开放报名时冻结。</p>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={disabled} checked={policy.educationRequired} onChange={(e) => setPolicy({ ...policy, educationRequired: e.target.checked })} />要求教育认证</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={disabled} checked={policy.contacts.qqRequired} onChange={(e) => setPolicy({ ...policy, contacts: { ...policy.contacts, qqRequired: e.target.checked } })} />要求 QQ</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={disabled} checked={policy.contacts.emailVerifiedRequired} onChange={(e) => setPolicy({ ...policy, contacts: { ...policy.contacts, emailVerifiedRequired: e.target.checked } })} />要求已验证邮箱</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={disabled} checked={policy.competitiveProfileRequired} onChange={(e) => setPolicy({ ...policy, competitiveProfileRequired: e.target.checked })} />要求竞技档案</label>
        {(policy.competitiveProfileRequired || policy.externalStrengthGap.enabled) && <div>
          <Label htmlFor={`${id}-policy-platform`}>竞技平台</Label>
          <Select disabled={disabled} value={policy.competitiveProfile?.platform ?? ""} onValueChange={(next) => setPolicy({ ...policy, competitiveProfile: { ...(policy.competitiveProfile ?? { currentSeasonKey: "", previousSeasonKey: "", rankOrder: [] }), platform: next } })}>
            <SelectTrigger id={`${id}-policy-platform`}><SelectValue placeholder="请选择竞技平台" /></SelectTrigger><SelectContent>{competitivePlatforms.map((item) => <SelectItem key={item.key} value={item.key}>{item.displayName}</SelectItem>)}</SelectContent>
          </Select>
        </div>}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={disabled} checked={policy.externalStrengthGap.enabled} onChange={(e) => setPolicy({ ...policy, externalStrengthGap: { ...policy.externalStrengthGap, enabled: e.target.checked } })} />限制外校实力差</label>
        {policy.externalStrengthGap.enabled && <div><Label htmlFor={`${id}-gap`}>最大星差</Label><Input id={`${id}-gap`} disabled={disabled} type="number" min={0} max={100} value={policy.externalStrengthGap.maxGap} onChange={(e) => setPolicy({ ...policy, externalStrengthGap: { ...policy.externalStrengthGap, maxGap: Number(e.target.value) } })} /></div>}
        {policy.affiliationRules.map((rule, index) => <div key={index} className="grid gap-2 sm:grid-cols-3">
          <div><Label htmlFor={`${id}-institution-${index}`}>机构代码</Label><Input id={`${id}-institution-${index}`} disabled={disabled} value={rule.institutionCode} onChange={(e) => setPolicy({ ...policy, affiliationRules: policy.affiliationRules.map((r, i) => i === index ? { ...r, institutionCode: e.target.value } : r) })} /></div>
          <div><Label htmlFor={`${id}-roster-${index}`}>名单最少人数</Label><Input id={`${id}-roster-${index}`} disabled={disabled} type="number" min={0} value={rule.minRosterMembers} onChange={(e) => setPolicy({ ...policy, affiliationRules: policy.affiliationRules.map((r, i) => i === index ? { ...r, minRosterMembers: Number(e.target.value) } : r) })} /></div>
          <div><Label htmlFor={`${id}-starters-${index}`}>首发最少人数</Label><Input id={`${id}-starters-${index}`} disabled={disabled} type="number" min={0} value={rule.minStartingMembers} onChange={(e) => setPolicy({ ...policy, affiliationRules: policy.affiliationRules.map((r, i) => i === index ? { ...r, minStartingMembers: Number(e.target.value) } : r) })} /></div>
          {(["enrolled", "graduated"] as const).map((status) => <label key={status} className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={disabled} checked={rule.eligibleAcademicStatuses.includes(status)} onChange={(e) => setPolicy({ ...policy, affiliationRules: policy.affiliationRules.map((r, i) => i === index ? { ...r, eligibleAcademicStatuses: e.target.checked ? [...r.eligibleAcademicStatuses, status] : r.eligibleAcademicStatuses.filter((item) => item !== status) } : r) })} />{status === "enrolled" ? "在读" : "毕业"}</label>)}
          <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => setPolicy({ ...policy, affiliationRules: policy.affiliationRules.filter((_, i) => i !== index) })}>移除机构</Button>
        </div>)}
        <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => setPolicy({ ...policy, affiliationRules: [...policy.affiliationRules, { institutionCode: "", eligibleAcademicStatuses: ["enrolled", "graduated"], minRosterMembers: 0, minStartingMembers: 0 }] })}>添加机构</Button>
      </div>}
      {!fallbackOnly && showCompetitiveSettings && !policy && <div>
        <h3 className="text-sm font-medium mb-3">竞技档案规则</h3>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={disabled} checked={value.requireCompetitiveProfile ?? false} onChange={(event) => set("requireCompetitiveProfile", event.target.checked)} />报名与首发必须完成竞技档案</label>
        <p className="mt-1 text-xs text-[var(--color-fg-dim)]">实际开放报名时将从平台赛季目录冻结当前与上一赛季及段位顺序；之后的目录变更不影响已开放报名赛事。</p>
        {value.requireCompetitiveProfile && (
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label>竞技平台</Label>
              <Select disabled={disabled} value={platform} onValueChange={(next) => onChange({ ...value, competitiveProfile: { platform: next, currentSeasonKey: "", previousSeasonKey: "", rankOrder: [] } })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {competitivePlatforms.map((item) => <SelectItem key={item.key} value={item.key}>{item.displayName}</SelectItem>)}
                </SelectContent>
              </Select>
              {competitivePlatforms.length === 0 && <p className="mt-1 text-xs text-[var(--color-danger)]">暂未配置竞技平台，赛事暂时无法发布。</p>}
            </div>
            <div>
              <Label>外校实力星差上限</Label>
              <Input
                disabled={disabled}
                type="number"
                min={0}
                value={value.competitiveProfile?.externalStrengthMaxStarGap ?? 3}
                onChange={(event) => {
                  const next = event.target.value === "" ? 3 : Math.max(0, Math.trunc(Number(event.target.value)));
                  const profile = value.competitiveProfile ?? { platform, currentSeasonKey: "", previousSeasonKey: "", rankOrder: [] };
                  onChange({ ...value, competitiveProfile: { ...profile, externalStrengthMaxStarGap: Number.isFinite(next) ? next : 3 } });
                }}
              />
              <p className="mt-1 text-xs text-[var(--color-fg-dim)]">外校最强队员的历史最高总星数不得高于本校最强队员超过此星数。</p>
            </div>
          </div>
        )}
      </div>}
      {!policy && value.requireCompetitiveProfile && platform === "perfect_world" && (
        <p className="text-sm text-[var(--color-fg-mid)]">标准 Major 将在 Perfect 与 5E 等效竞技事实中按证据槽位自动择高，开放报名时冻结对应版本与赛季对应，无需手动选择平台或填写映射。</p>
      )}
    </div>
  );
}
