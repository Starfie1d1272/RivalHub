"use client";

import React, { useState, useTransition } from "react";
import { toast } from "sonner";
import { saveCompetitiveRoles } from "@/actions/competitive-profile";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Panel } from "@/components/rivalhub";
import { CS2_POSITION_LABELS, CS2_POSITION_VALUES, type Cs2Position } from "@/lib/config/cs2-positions";

export function CompetitiveRolesForm({ initialRoles, initialPrimaryRole }: { initialRoles: Cs2Position[]; initialPrimaryRole: Cs2Position | null }) {
  const [roles, setRoles] = useState<Cs2Position[]>(initialRoles);
  const [primaryRole, setPrimaryRole] = useState<Cs2Position | null>(() => initialPrimaryRole && initialRoles.includes(initialPrimaryRole) ? initialPrimaryRole : initialRoles[0] ?? null);
  const [pending, startTransition] = useTransition();

  function toggle(role: Cs2Position) {
    if (roles.includes(role)) {
      const next = roles.filter((item) => item !== role);
      setRoles(next);
      if (primaryRole === role) setPrimaryRole(next[0] ?? null);
      return;
    }
    if (roles.length >= 3) return toast.error("最多选择 3 个位置");
    setRoles([...roles, role]);
    setPrimaryRole(primaryRole ?? role);
  }

  return <Panel label="位置偏好" contentClassName="p-5">
    <div className="space-y-5">
      <p className="text-sm leading-6 text-[var(--color-fg-mid)]">选择 1–3 个常用位置，并指定主位置。它用于队伍招募与资料展示，不构成赛事资格门禁。</p>
      <div className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p id="competitive-roles-label" className="text-sm font-medium">常用位置</p>
          <span className="font-mono text-[11px] text-[var(--color-fg-mid)]">最多选择 3 个</span>
        </div>
        <div role="group" aria-labelledby="competitive-roles-label" className="flex flex-wrap gap-2">
        {CS2_POSITION_VALUES.map((role) => {
          const selected = roles.includes(role);
          const label = CS2_POSITION_LABELS[role];
          return <button key={role} type="button" aria-label={`${selected ? "取消" : "选择"} ${label.full}`} aria-pressed={selected} data-selected={selected} onClick={() => toggle(role)} className={`inline-flex min-h-9 items-center gap-1.5 border px-3 py-2 font-mono text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-panel)] ${selected ? "border-[var(--color-accent-edge)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]" : "border-[var(--color-border)] bg-[var(--color-panel)] text-[var(--color-fg-mid)] hover:border-[var(--color-border-hi)]"}`}>
            <span aria-hidden="true" className="inline-flex w-3 items-center justify-center font-bold">{selected ? "✓" : ""}</span>
            <span>{label.en}</span>
            <span className="sr-only">{selected ? "已选" : "未选"}</span>
          </button>;
        })}
        </div>
      </div>
      <div className="max-w-xs space-y-1.5">
        <Label htmlFor="competitive-primary-role">主位置</Label>
        <Select value={primaryRole ?? ""} onValueChange={(value) => setPrimaryRole(value as Cs2Position)}>
          <SelectTrigger id="competitive-primary-role" disabled={roles.length === 0} aria-label="主位置">
            <SelectValue placeholder="先选择常用位置" />
          </SelectTrigger>
          <SelectContent>
            {roles.map((role) => <SelectItem key={role} value={role}>{CS2_POSITION_LABELS[role].full}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <Button type="button" disabled={pending || roles.length === 0 || !primaryRole} onClick={() => startTransition(async () => {
        const result = await saveCompetitiveRoles({ roles, primaryRole });
        if (result.success) toast.success("位置偏好已保存"); else toast.error(result.error.message);
      })}>{pending ? "保存中…" : "保存位置偏好"}</Button>
    </div>
  </Panel>;
}
