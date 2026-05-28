import React from "react";
import { cn } from "@/lib/utils/cn";
import type { KillFeedItem } from "@/actions/demo-detail";

interface DemoKillFeedProps {
  kills: KillFeedItem[];
  /** steamId64 → 游戏内昵称 */
  playerNameMap: Record<string, string>;
}

function groupKillsByRound(kills: KillFeedItem[]): Map<number, KillFeedItem[]> {
  const map = new Map<number, KillFeedItem[]>();
  for (const k of kills) {
    const list = map.get(k.roundNumber);
    if (list) list.push(k);
    else map.set(k.roundNumber, [k]);
  }
  return map;
}

const WEAPON_DISPLAY: Record<string, string> = {
  ak47: "AK-47",
  m4a4: "M4A4",
  m4a1_silencer: "M4A1-S",
  awp: "AWP",
  usp_silencer: "USP",
  glock: "Glock",
  deagle: "Deagle",
  desert_eagle: "Deagle",
  p2000: "P2000",
  p250: "P250",
  fiveseven: "Five-Seven",
  tec9: "Tec-9",
  cz75a: "CZ75",
  dual_berettas: "Dualies",
  mp9: "MP9",
  mp7: "MP7",
  mp5sd: "MP5-SD",
  ump45: "UMP-45",
  p90: "P90",
  mac10: "MAC-10",
  bizon: "PP-Bizon",
  famas: "FAMAS",
  galilar: "Galil AR",
  ssg08: "SSG 08",
  aug: "AUG",
  sg556: "SG 553",
  negev: "Negev",
  m249: "M249",
  xm1014: "XM1014",
  mag7: "MAG-7",
  nova: "Nova",
  sawedoff: "Sawed-Off",
  elite: "Dual Berettas",
  hkp2000: "P2000",
  weapon_glock: "Glock",
  weapon_deagle: "Deagle",
  weapon_ak47: "AK-47",
  weapon_m4a1: "M4A4",
  weapon_awp: "AWP",
};

function weaponLabel(weapon: string | null): string {
  if (!weapon) return "?";
  return WEAPON_DISPLAY[weapon] ?? weapon;
}

/**
 * Kill feed timeline grouped by round.
 * Shows "killer [weapon] → victim" with HS/Trade/Smoke/NS/FA badges.
 */
export function DemoKillFeed({ kills, playerNameMap }: DemoKillFeedProps) {
  if (kills.length === 0) {
    return (
      <p className="text-xs text-[var(--color-fg-dim)] py-2">No kill data</p>
    );
  }

  const grouped = groupKillsByRound(kills);

  return (
    <div className="space-y-3">
      {Array.from(grouped.entries()).map(([roundNumber, roundKills]) => (
        <div key={roundNumber}>
          <h4 className="text-xs font-semibold text-[var(--color-fg)] mb-1">
            Round {roundNumber}
          </h4>
          <div className="space-y-0.5">
            {roundKills.map((k, i) => {
              const killer = playerNameMap[k.killerSteamId64 ?? ""] ?? k.killerSteamId64 ?? "Unknown";
              const victim = playerNameMap[k.victimSteamId64 ?? ""] ?? k.victimSteamId64 ?? "Unknown";
              const weapon = weaponLabel(k.weapon);

              return (
                <div
                  key={`${k.roundNumber}-${k.tick}-${i}`}
                  className="flex items-center gap-1.5 text-xs text-[var(--color-fg)] py-0.5"
                >
                  <span className="font-medium truncate max-w-[80px]" title={killer}>
                    {killer}
                  </span>
                  <span className="text-[var(--color-fg-dim)] font-mono">{weapon}</span>
                  <span className="text-[var(--color-fg-mid)]">→</span>
                  <span className="truncate max-w-[80px]" title={victim}>
                    {victim}
                  </span>
                  <span className="flex gap-1 ml-1">
                    {k.headshot && (
                      <span className="text-[10px] px-1 rounded bg-amber-900/30 text-amber-400 font-bold">
                        HS
                      </span>
                    )}
                    {k.tradeKill && (
                      <span className="text-[10px] px-1 rounded bg-blue-900/30 text-blue-400">
                        Trade
                      </span>
                    )}
                    {k.throughSmoke && (
                      <span className="text-[10px] px-1 rounded bg-gray-700/50 text-gray-300">
                        Smoke
                      </span>
                    )}
                    {k.noScope && (
                      <span className="text-[10px] px-1 rounded bg-purple-900/30 text-purple-400">
                        NS
                      </span>
                    )}
                    {k.flashAssist && (
                      <span className="text-[10px] px-1 rounded bg-green-900/30 text-green-400">
                        FA
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
