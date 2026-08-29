"use client";

import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { TeamRegistrationConfig } from "@/types/season";

interface TeamConfigFormProps {
  value: TeamRegistrationConfig;
  maxTeamSize?: number;
  onChange: (value: TeamRegistrationConfig) => void;
}

/**
 * Product-facing surface of the team registration configuration. It only
 * exposes settings with a live runtime consumer owned by this season:
 * roster/identity rules live in the season's affiliationRules, positions in
 * season.positions, member removal in the application state machine, and the
 * competitive profile context is resolved from the global platform catalog at
 * publish time.
 */
export function TeamConfigForm({ value, onChange }: TeamConfigFormProps) {
  function set<K extends keyof TeamRegistrationConfig>(key: K, val: TeamRegistrationConfig[K]) {
    onChange({ ...value, [key]: val });
  }
  const platform = value.competitiveProfile?.platform ?? "perfect_world";

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium mb-3">队伍管理</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={value.captainCanTransfer}
              onChange={(e) => set("captainCanTransfer", e.target.checked)}
            />
            队长可转让
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={value.requireUniqueTeamName}
              onChange={(e) => set("requireUniqueTeamName", e.target.checked)}
            />
            队伍名必须唯一
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={value.requireTeamLogo}
              onChange={(e) => set("requireTeamLogo", e.target.checked)}
            />
            强制上传队伍Logo
          </label>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium mb-3">Major 竞技档案规则</h3>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value.requireCompetitiveProfile ?? false} onChange={(event) => set("requireCompetitiveProfile", event.target.checked)} />报名与首发必须完成竞技档案</label>
        <p className="mt-1 text-xs text-[var(--color-fg-dim)]">发布时将从平台赛季目录冻结当前与上一赛季及段位顺序；之后的目录变更不影响已发布赛事。</p>
        {value.requireCompetitiveProfile && (
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label>竞技平台</Label>
              <Select value={platform} onValueChange={(next) => onChange({ ...value, competitiveProfile: { platform: next, currentSeasonKey: "", previousSeasonKey: "", rankOrder: [] } })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="perfect_world">完美世界竞技平台</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
