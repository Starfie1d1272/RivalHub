"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Script from "next/script";
import type { BracketData, BracketMatch } from "@/lib/bracket";

declare global {
  interface Window {
    bracketsViewer?: {
      render(data: {
        stages: unknown[];
        matches: unknown[];
        participants: unknown[];
        matchGames: unknown[];
      }, config?: { selector?: string; clear?: boolean }): Promise<void>;
      addLocale?(lang: string, bundle: Record<string, unknown>): Promise<void>;
    };
  }
}

interface BracketViewProps {
  data: BracketData;
  themeColor?: string | null;
  matchNodeMap?: Map<string, string>;
  seasonSlug?: string;
}

function bracketThemeStyle(themeColor?: string | null): React.CSSProperties {
  return {
    "--primary-background": "var(--color-bg)",
    "--secondary-background": "var(--color-panel)",
    "--match-background": "var(--color-panel-hi)",
    "--font-color": "var(--color-fg)",
    "--label-color": "var(--color-fg-mid)",
    "--hint-color": "var(--color-fg-dim)",
    "--connector-color": "var(--color-border-hi)",
    "--border-color": "var(--color-border)",
    // 默认禁用 hover 描边；可点击比赛由 JS 直接写 inline style 触发橙色
    "--border-hover-color": "var(--color-border)",
    "--border-selected-color": themeColor ?? "var(--color-accent)",
    "--win-color": "var(--color-success)",
    "--loss-color": "var(--color-danger)",
    // 队伍名 + "vs" + 队伍名 + 胜者/败者 标签较长，加宽对阵卡片
    "--match-width": "280px",
  } as React.CSSProperties;
}

/**
 * 根据 bracket 结构推断某场比赛某个空槽位的来源。
 * 返回展示文案；若两支来源队伍均已知，会写明「队伍A vs 队伍B 胜者/败者」，否则 TBD。
 */
function computeSlotLabel(
  match: BracketMatch,
  slotIdx: 0 | 1,
  data: BracketData,
  participantById: Map<number, string>,
): string {
  const group = data.group.find((g) => g.id === match.group_id);
  const round = data.round.find((r) => r.id === match.round_id);
  if (!group || !round) return "TBD";

  const matchesInRound = (groupId: number, roundNumber: number): BracketMatch[] => {
    const r = data.round.find(
      (rr) => rr.group_id === groupId && rr.number === roundNumber,
    );
    if (!r) return [];
    return data.match
      .filter((m) => m.round_id === r.id)
      .sort((a, b) => a.number - b.number);
  };

  const teamsOf = (m: BracketMatch): [string | null, string | null] => [
    m.opponent1?.id != null ? participantById.get(m.opponent1.id) ?? null : null,
    m.opponent2?.id != null ? participantById.get(m.opponent2.id) ?? null : null,
  ];

  const winnerLabel = (m: BracketMatch | undefined): string => {
    if (!m) return "TBD";
    const [a, b] = teamsOf(m);
    return a && b ? `${a} vs ${b} 胜者` : "TBD";
  };

  const loserLabel = (m: BracketMatch | undefined): string => {
    if (!m) return "TBD";
    const [a, b] = teamsOf(m);
    return a && b ? `${a} vs ${b} 败者` : "TBD";
  };

  const groupNum = group.number; // 1=UB, 2=LB, 3=GF
  const roundNum = round.number;
  const matchNum = match.number;

  // UB (winner_bracket)
  if (groupNum === 1) {
    if (roundNum === 1) return "TBD";
    const prev = matchesInRound(group.id, roundNum - 1);
    const source = prev[2 * matchNum - 2 + slotIdx];
    return winnerLabel(source);
  }

  // LB (loser_bracket)
  if (groupNum === 2) {
    const ubGroup = data.group.find(
      (g) => g.stage_id === group.stage_id && g.number === 1,
    );
    const ubGroupId = ubGroup?.id ?? -1;

    if (roundNum === 1) {
      // 来自 UB R1 的败者
      const ubR1 = matchesInRound(ubGroupId, 1);
      const source = ubR1[2 * matchNum - 2 + slotIdx];
      return loserLabel(source);
    }

    // r >= 2: 偶数轮 minor / 奇数轮 major
    const isMinor = roundNum % 2 === 0;
    if (isMinor) {
      // op1: 上一 LB 轮胜者（反向配对）
      // op2: 本 minor 对应的 UB 轮败者，UB 轮号 = roundNum/2 + 1
      const prevLb = matchesInRound(group.id, roundNum - 1);
      const ubRoundIdx = roundNum / 2 + 1;
      const ubRound = matchesInRound(ubGroupId, ubRoundIdx);
      if (slotIdx === 0) {
        const source = prevLb[prevLb.length - matchNum];
        return winnerLabel(source);
      }
      const source = ubRound[matchNum - 1];
      return loserLabel(source);
    }

    // major: 两侧均来自上一 LB 轮的胜者，顺序配对
    const prevLb = matchesInRound(group.id, roundNum - 1);
    const source = prevLb[2 * matchNum - 2 + slotIdx];
    return winnerLabel(source);
  }

  // GF (grand_final)
  if (groupNum === 3) {
    const ubGroup = data.group.find(
      (g) => g.stage_id === group.stage_id && g.number === 1,
    );
    const lbGroup = data.group.find(
      (g) => g.stage_id === group.stage_id && g.number === 2,
    );
    if (matchNum === 1) {
      // 第一场 GF: UB 总冠军 vs LB 总冠军
      if (slotIdx === 0 && ubGroup) {
        const ubRounds = data.round
          .filter((r) => r.group_id === ubGroup.id)
          .sort((a, b) => b.number - a.number);
        const last = ubRounds[0];
        if (last) {
          const ubFinal = data.match.find((m) => m.round_id === last.id);
          return winnerLabel(ubFinal);
        }
      }
      if (slotIdx === 1 && lbGroup) {
        const lbRounds = data.round
          .filter((r) => r.group_id === lbGroup.id)
          .sort((a, b) => b.number - a.number);
        const last = lbRounds[0];
        if (last) {
          const lbFinal = data.match.find((m) => m.round_id === last.id);
          return winnerLabel(lbFinal);
        }
      }
    }
    // bracket reset 第二场：双方为第一场 GF 胜负者
    if (matchNum === 2) {
      const gfRound = data.round.find(
        (r) => r.group_id === group.id && r.number === 1,
      );
      if (gfRound) {
        const gf1 = data.match.find(
          (m) => m.round_id === gfRound.id && m.number === 1,
        );
        return slotIdx === 0 ? winnerLabel(gf1) : loserLabel(gf1);
      }
    }
    return "TBD";
  }

  return "TBD";
}

export function BracketView({ data, themeColor, matchNodeMap, seasonSlug }: BracketViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scriptReady, setScriptReady] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (!scriptReady || !window.bracketsViewer || data.stage.length === 0) return;
    if (data.match.length === 0) return;

    // 注入中文 locale：把 BYE 翻译为 TBD，并将 origin hint 翻译为中文
    if (window.bracketsViewer.addLocale) {
      window.bracketsViewer
        .addLocale("en", {
          common: { bye: "TBD" },
          "origin-hint": {
            seed: "种子 {{position}}",
            "winner-bracket": "胜者组 R{{round}}.{{position}}",
            "winner-bracket-semi-final": "胜者组半决赛.{{position}}",
            "winner-bracket-final": "胜者组决赛",
            "grand-final": "胜者组决赛胜者",
          },
        })
        .catch(() => {});
    }

    window.bracketsViewer
      .render(
        {
          stages: data.stage,
          matches: data.match,
          participants: data.participant,
          matchGames: data.match_game,
        },
        { selector: "#bracket-container", clear: true }
      )
      .then(() => {
        if (!containerRef.current) return;

        // 兜底：如果上面 addLocale 在 render 之前未生效，把残留的 BYE 字面量替换为 TBD
        const walker = document.createTreeWalker(
          containerRef.current,
          NodeFilter.SHOW_TEXT,
          null,
        );
        let node: Text | null;
        while ((node = walker.nextNode() as Text | null)) {
          if (node.textContent === "BYE") node.textContent = "TBD";
        }

        // ── 为每场比赛的空槽位注入 feeder 标签 ─────────────────────────
        const participantById = new Map<number, string>(
          data.participant.map((p) => [p.id, p.name]),
        );
        const matchById = new Map<number, BracketMatch>(
          data.match.map((m) => [m.id, m]),
        );

        containerRef.current.querySelectorAll<HTMLElement>("[data-match-id]").forEach((el) => {
          const bracketId = el.getAttribute("data-match-id");
          if (!bracketId) return;
          const match = matchById.get(parseInt(bracketId, 10));
          if (!match) return;

          const participants = el.querySelectorAll<HTMLElement>(".participant");
          [0, 1].forEach((idx) => {
            const slot = participants[idx];
            if (!slot) return;
            const nameEl = slot.querySelector<HTMLElement>(".name");
            if (!nameEl) return;
            const opponent = idx === 0 ? match.opponent1 : match.opponent2;
            if (opponent && opponent.id != null) return;
            const label = computeSlotLabel(match, idx as 0 | 1, data, participantById);
            nameEl.innerText = label;
            nameEl.title = label;
            nameEl.classList.add("hint");
          });
        });

        // ── 点击跳转 & hover 视觉 ──────────────────────────────────────
        if (matchNodeMap && seasonSlug) {
          const accentColor = getComputedStyle(containerRef.current)
            .getPropertyValue("--color-accent")
            .trim() || "#ff6a00";

          containerRef.current.querySelectorAll<HTMLElement>("[data-match-id]").forEach((el) => {
            const bracketId = el.getAttribute("data-match-id");
            if (!bracketId) return;
            if (!matchNodeMap.has(bracketId)) {
              // 不可点击的比赛：去除 cursor，避免误导
              el.style.cursor = "default";
              return;
            }
            el.style.cursor = "pointer";
            el.title = "点击查看比赛详情";
            // 用 inline style 在 mouseenter/leave 上覆盖 brackets-viewer 自带样式
            const onEnter = () => {
              el.style.borderColor = accentColor;
            };
            const onLeave = () => {
              el.style.borderColor = "";
            };
            el.addEventListener("mouseenter", onEnter);
            el.addEventListener("mouseleave", onLeave);
          });

          const handleClick = (e: MouseEvent) => {
            const target = (e.target as HTMLElement).closest<HTMLElement>("[data-match-id]");
            if (!target) return;
            const bracketId = target.getAttribute("data-match-id");
            if (!bracketId) return;
            const matchId = matchNodeMap.get(bracketId);
            if (!matchId) return;
            e.stopPropagation();
            router.push(`/${seasonSlug}/matches/${matchId}`);
          };
          containerRef.current.addEventListener("click", handleClick);
          return () => {
            containerRef.current?.removeEventListener("click", handleClick);
          };
        }
      })
      .catch(console.error);
  }, [scriptReady, data, matchNodeMap, seasonSlug, router]);

  if (data.stage.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-[var(--color-fg-mid)]">
        赛程尚未生成
      </div>
    );
  }

  return (
    <>
      <link rel="stylesheet" href="/brackets-viewer.min.css" />
      <Script
        src="/brackets-viewer.min.js"
        strategy="afterInteractive"
        onReady={() => setScriptReady(true)}
      />
      <div className="overflow-x-auto">
        <div
          id="bracket-container"
          className="brackets-viewer"
          ref={containerRef}
          style={bracketThemeStyle(themeColor)}
        />
      </div>
    </>
  );
}
