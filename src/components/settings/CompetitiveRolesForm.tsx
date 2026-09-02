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

  return <Panel label="位置偏好" pad={20}>
    <div className="space-y-4">
      <p className="text-sm leading-6 text-[var(--color-fg-mid)]">选择 1–3 个常用位置，并指定主位置。它用于队伍招募与资料展示，不构成赛事资格门禁。</p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {CS2_POSITION_VALUES.map((role) => {
          const selected = roles.includes(role);
          const primary = selected && primaryRole === role;
          return <div key={role} className={`flex min-w-0 items-center justify-between gap-3 rounded-sm border p-3 transition-colors ${primary ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]" : selected ? "border-[var(--color-accent)] bg-[var(--color-panel-hi)]" : "border-[var(--color-border)] bg-[var(--color-panel)]"}`}>
            <button type="button" aria-pressed={selected} className="min-w-0 flex-1 rounded-sm px-1 py-1 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-panel)]" onClick={() => toggle(role)}>
              <span aria-hidden={!selected} className="mr-2 inline-flex min-w-4 items-center justify-center font-mono text-xs font-bold text-[var(--color-accent)]">{selected ? "✓" : ""}</span>
              <span>{ROLE_LABELS[role]}</span>
            </button>
            {primary ? <span className="shrink-0 rounded-sm border border-[var(--color-accent)] bg-[var(--color-accent)] px-2 py-1 font-mono text-[11px] font-bold text-[var(--color-accent-fg)]">主位置</span> : selected && <Button type="button" variant="ghost" size="sm" className="shrink-0 px-2 text-xs text-[var(--color-fg-mid)] hover:text-[var(--color-fg)]" onClick={() => setPrimaryRole(role)}>设为主位置</Button>}
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
