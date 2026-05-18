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
