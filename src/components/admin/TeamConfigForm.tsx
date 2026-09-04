"use client";

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
export function TeamConfigForm({ value, competitivePlatforms, fallbackOnly = false, disabled = false, onChange }: TeamConfigFormProps) {
  function set<K extends keyof TeamRegistrationConfig>(key: K, val: TeamRegistrationConfig[K]) {
    onChange({ ...value, [key]: val });
  }
  const platform = value.competitiveProfile?.platform ?? competitivePlatforms[0]?.key ?? "";
  const selectedPlatform = competitivePlatforms.find((item) => item.key === platform);

  return (
    <div className="space-y-6">
      {!fallbackOnly && <div>
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

      {!fallbackOnly && <div>
        <h3 className="text-sm font-medium mb-3">Major 竞技档案规则</h3>
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
              {competitivePlatforms.length === 0 && <p className="mt-1 text-xs text-[var(--color-danger)]">尚未建立竞技平台目录；赛事发布会 fail closed。</p>}
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
      {value.requireCompetitiveProfile && platform === "perfect_world" && (
        <p className="text-sm text-[var(--color-fg-mid)]">标准 Major 将使用当前已批准的 5E → Perfect 换算策略，开放报名时自动冻结对应版本与赛季对应，无需手动填写映射。</p>
      )}
    </div>
  );
}
