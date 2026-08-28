"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { TeamRegistrationConfig } from "@/types/season";

interface TeamConfigFormProps {
  value: TeamRegistrationConfig;
  maxTeamSize?: number;
  onChange: (value: TeamRegistrationConfig) => void;
}

export function TeamConfigForm({ value, maxTeamSize = 9, onChange }: TeamConfigFormProps) {
  function set<K extends keyof TeamRegistrationConfig>(key: K, val: TeamRegistrationConfig[K]) {
    onChange({ ...value, [key]: val });
  }
  const competitive = value.competitiveProfile ?? { platform: "perfect_world", currentSeasonKey: "", previousSeasonKey: "", rankOrder: [] };
  function setCompetitive(key: keyof typeof competitive, next: string | string[]) {
    onChange({ ...value, competitiveProfile: { ...competitive, [key]: next } });
  }

  return (
    <div className="space-y-6">
      {/* 身份/学校约束 */}
      <div>
        <h3 className="text-sm font-medium mb-3">身份 / 学校约束</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={value.allowExternal}
              onChange={(e) => set("allowExternal", e.target.checked)}
            />
            允许外校选手
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={value.graduateCountsAsHome}
              onChange={(e) => set("graduateCountsAsHome", e.target.checked)}
            />
            毕业生算本校
          </label>
          <div>
            <Label>最少本校人数</Label>
            <Input
              type="number" min={0} max={maxTeamSize}
              value={value.minHomeMembers}
              onChange={(e) => set("minHomeMembers", Number(e.target.value))}
            />
          </div>
          <div>
            <Label>最少在校生人数</Label>
            <Input
              type="number" min={0}
              value={value.minEnrolledMembers}
              onChange={(e) => set("minEnrolledMembers", Number(e.target.value))}
            />
          </div>
          <div>
            <Label>最多外校人数</Label>
            <Input
              type="number" min={0}
              value={value.maxExternalMembers}
              onChange={(e) => set("maxExternalMembers", Number(e.target.value))}
            />
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium mb-3">Major 竞技档案规则</h3>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value.requireCompetitiveProfile ?? false} onChange={(event) => set("requireCompetitiveProfile", event.target.checked)} />报名与首发必须完成竞技档案</label>
        <p className="mt-1 text-xs text-[var(--color-fg-dim)]">平台赛季键和段位顺序会写入赛事配置；赛制开始后应以 StageRun 冻结快照为准。</p>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div><Label>平台标识</Label><Input value={competitive.platform} onChange={(event) => setCompetitive("platform", event.target.value)} placeholder="perfect_world" /></div>
          <div><Label>当前赛季标识</Label><Input value={competitive.currentSeasonKey} onChange={(event) => setCompetitive("currentSeasonKey", event.target.value)} placeholder="由赛委会公布" /></div>
          <div><Label>上一赛季标识</Label><Input value={competitive.previousSeasonKey} onChange={(event) => setCompetitive("previousSeasonKey", event.target.value)} placeholder="由赛委会公布" /></div>
          <div><Label>段位顺序（低→高，逗号分隔）</Label><Input value={competitive.rankOrder.join(",")} onChange={(event) => setCompetitive("rankOrder", event.target.value.split(",").map((item) => item.trim()).filter(Boolean))} placeholder="例如：C,B,A,S" /></div>
        </div>
      </div>

      {/* 位置分配 */}
      <div>
        <h3 className="text-sm font-medium mb-3">位置分配</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={value.requirePositions}
              onChange={(e) => set("requirePositions", e.target.checked)}
            />
            强制分配位置
          </label>
          <div>
            <Label>同队每位置上限</Label>
            <Input
              type="number" min={1} max={5}
              value={value.maxPerPositionPerTeam}
              onChange={(e) => set("maxPerPositionPerTeam", Number(e.target.value))}
            />
          </div>
        </div>
        <p className="text-xs text-[var(--color-fg-dim)] mt-1">
          不强制分配位置时，未分配位置的队员不参与排行榜和最佳五人组评选
        </p>
      </div>

      {/* 队伍管理 */}
      <div>
        <h3 className="text-sm font-medium mb-3">队伍管理</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={value.captainCanKick}
              onChange={(e) => set("captainCanKick", e.target.checked)}
            />
            队长可移除队员
          </label>
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
              checked={value.lockAfterRegistration}
              onChange={(e) => set("lockAfterRegistration", e.target.checked)}
            />
            报名截止后锁定队伍
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
    </div>
  );
}
