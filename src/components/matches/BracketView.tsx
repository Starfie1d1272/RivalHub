"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Script from "next/script";
import type { BracketData } from "@/lib/bracket";

declare global {
  interface Window {
    bracketsViewer?: {
      render(data: {
        stages: unknown[];
        matches: unknown[];
        participants: unknown[];
        matchGames: unknown[];
      }, config?: { selector?: string; clear?: boolean }): Promise<void>;
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
    "--border-hover-color": "var(--color-accent)",
    "--border-selected-color": themeColor ?? "var(--color-accent)",
    "--win-color": "var(--color-success)",
    "--loss-color": "var(--color-danger)",
  } as React.CSSProperties;
}

export function BracketView({ data, themeColor, matchNodeMap, seasonSlug }: BracketViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scriptReady, setScriptReady] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (!scriptReady || !window.bracketsViewer || data.stage.length === 0) return;
    if (data.match.length === 0) return;

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

        // 将 brackets-viewer 默认的 "BYE" 文本替换为 "TBD"
        const walker = document.createTreeWalker(
          containerRef.current,
          NodeFilter.SHOW_TEXT,
          null,
        );
        let node: Text | null;
        while ((node = walker.nextNode() as Text | null)) {
          if (node.textContent === "BYE") {
            node.textContent = "TBD";
          }
        }

        if (matchNodeMap && seasonSlug) {
          containerRef.current.querySelectorAll<HTMLElement>("[data-match-id]").forEach((el) => {
            const bracketId = el.getAttribute("data-match-id");
            if (!bracketId) return;
            if (!matchNodeMap.has(bracketId)) return;
            el.style.cursor = "pointer";
            el.title = "点击查看比赛详情";
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
      <div
        className="overflow-x-auto"
      >
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
