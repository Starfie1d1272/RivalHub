"use client";

import React, { useState, useTransition } from "react";
import { toast } from "sonner";
import { saveCompetitiveRoles } from "@/actions/competitive-profile";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/rivalhub";
import { CS2_POSITION_LABELS, CS2_POSITION_VALUES, type Cs2Position } from "@/lib/config/cs2-positions";

const ROLE_LABELS: Record<Cs2Position, string> = Object.fromEntries(
  CS2_POSITION_VALUES.map((role) => [role, CS2_POSITION_LABELS[role].full]),
) as Record<Cs2Position, string>;

export function CompetitiveRolesForm({ initialRoles, initialPrimaryRole }: { initialRoles: Cs2Position[]; initialPrimaryRole: Cs2Position | null }) {
  const [roles, setRoles] = useState<Cs2Position[]>(initialRoles);
  const [primaryRole, setPrimaryRole] = useState<Cs2Position | null>(initialPrimaryRole);
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

  return <Panel label="长期位置偏好" pad={20}>
    <div className="space-y-4">
      <p className="text-sm leading-6 text-[var(--color-fg-mid)]">选择 1–3 个常用位置，并指定主位置。它用于长期队伍招募与资料展示，不构成赛事资格门禁。</p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {CS2_POSITION_VALUES.map((role) => {
          const selected = roles.includes(role);
          return <div key={role} className={`flex items-center justify-between border p-3 ${selected ? "border-[var(--color-accent)]" : "border-[var(--color-border)]"}`}>
            <button type="button" className="text-sm" onClick={() => toggle(role)}>{selected ? "✓ " : ""}{ROLE_LABELS[role]}</button>
            {selected && <button type="button" className="font-mono text-[10px] text-[var(--color-fg-mid)]" onClick={() => setPrimaryRole(role)}>{primaryRole === role ? "主位置" : "设为主位置"}</button>}
          </div>;
        })}
      </div>
      <Button disabled={pending || roles.length === 0 || !primaryRole} onClick={() => startTransition(async () => {
        const result = await saveCompetitiveRoles({ roles, primaryRole });
        if (result.success) toast.success("位置偏好已保存"); else toast.error(result.error.message);
      })}>{pending ? "保存中…" : "保存位置偏好"}</Button>
    </div>
  </Panel>;
}
