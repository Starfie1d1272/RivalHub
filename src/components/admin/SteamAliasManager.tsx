"use client";

import React, { useState, useTransition } from "react";
import { Panel } from "@/components/rivalhub";
import { cn } from "@/lib/utils/cn";
import { bindSteamAlias } from "@/actions/steam-aliases";
import type { UnlinkedPlayer } from "@/actions/steam-aliases";

interface RegisteredUser {
  userId: string;
  perfectName: string;
  steam64: string | null;
}

interface SteamAliasManagerProps {
  seasonId: string;
  unlinkedPlayers: UnlinkedPlayer[];
  registeredUsers: RegisteredUser[];
}

export function SteamAliasManager({
  seasonId: _seasonId,
  unlinkedPlayers,
  registeredUsers,
}: SteamAliasManagerProps) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Record<string, "idle" | "loading" | "ok" | "error">>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();

  const visible = unlinkedPlayers.filter((p) => !dismissed.has(p.steamId64));

  if (visible.length === 0) return null;

  async function handleBind(steamId64: string) {
    const userId = selections[steamId64];
    if (!userId) return;

    setStatus((s) => ({ ...s, [steamId64]: "loading" }));
    startTransition(async () => {
      const result = await bindSteamAlias(steamId64, userId, notes[steamId64] || undefined);
      if (result.success) {
        setStatus((s) => ({ ...s, [steamId64]: "ok" }));
        setTimeout(() => setDismissed((d) => new Set([...d, steamId64])), 800);
      } else {
        setStatus((s) => ({ ...s, [steamId64]: "error" }));
        setErrors((e) => ({ ...e, [steamId64]: result.error.message }));
      }
    });
  }

  return (
    <Panel label={`未绑定选手 (${visible.length})`} className="border border-[var(--color-warn)]/40 bg-[var(--color-warn)]/5">
      <p className="text-xs text-[var(--color-fg-mid)] mb-3">
        以下 Steam ID 出现在 demo 数据中，但未匹配到任何注册选手。请绑定后数据将自动回填。
      </p>
      <div className="space-y-2">
        {visible.map((p) => {
          const st = status[p.steamId64] ?? "idle";
          return (
            <div
              key={p.steamId64}
              className={cn(
                "flex flex-col sm:flex-row sm:items-center gap-2 p-2 rounded border",
                "bg-[var(--color-bg-subtle)] border-[var(--color-border)]",
                st === "ok" && "opacity-50",
              )}
            >
              {/* 选手信息 */}
              <div className="flex-1 min-w-0">
                <span className="text-xs font-medium text-[var(--color-fg)]">{p.gameName}</span>
                <span className="ml-2 text-[10px] font-mono text-[var(--color-fg-dim)]">{p.steamId64}</span>
                <span className="ml-2 text-[10px] text-[var(--color-fg-dim)]">{p.mapCount} 图</span>
              </div>

              {/* 选择选手 */}
              <select
                value={selections[p.steamId64] ?? ""}
                onChange={(e) => setSelections((s) => ({ ...s, [p.steamId64]: e.target.value }))}
                className="text-xs px-2 py-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-fg)] min-w-[160px]"
                disabled={st === "loading" || st === "ok"}
              >
                <option value="">选择注册选手…</option>
                {registeredUsers.map((u) => (
                  <option key={u.userId} value={u.userId}>
                    {u.perfectName}{u.steam64 ? ` (${u.steam64.slice(-4)})` : ""}
                  </option>
                ))}
              </select>

              {/* 备注 */}
              <input
                type="text"
                placeholder="备注（可选）"
                value={notes[p.steamId64] ?? ""}
                onChange={(e) => setNotes((n) => ({ ...n, [p.steamId64]: e.target.value }))}
                className="text-xs px-2 py-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-fg)] w-28"
                disabled={st === "loading" || st === "ok"}
              />

              {/* 操作 */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleBind(p.steamId64)}
                  disabled={!selections[p.steamId64] || st === "loading" || st === "ok" || isPending}
                  className={cn(
                    "text-xs px-3 py-1 rounded transition-colors",
                    "bg-[var(--color-accent)] text-white hover:opacity-80 disabled:opacity-40",
                  )}
                >
                  {st === "loading" ? "绑定中…" : st === "ok" ? "已绑定" : "绑定"}
                </button>
                <button
                  type="button"
                  onClick={() => setDismissed((d) => new Set([...d, p.steamId64]))}
                  className="text-[10px] text-[var(--color-fg-dim)] hover:text-[var(--color-fg)] transition-colors"
                  title="暂时忽略"
                >
                  ✕
                </button>
              </div>

              {errors[p.steamId64] && (
                <p className="text-[10px] text-[var(--color-error)] w-full">{errors[p.steamId64]}</p>
              )}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
