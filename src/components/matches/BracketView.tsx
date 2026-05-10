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
          matchGames: [],
        },
        { selector: "#bracket-container", clear: true }
      )
      .then(() => {
        if (!containerRef.current || !matchNodeMap || !seasonSlug) return;
        containerRef.current.querySelectorAll<HTMLElement>("[data-id]").forEach((el) => {
          const bracketId = el.getAttribute("data-id");
          if (!bracketId) return;
          const matchId = matchNodeMap.get(bracketId);
          if (!matchId) return;
          el.style.cursor = "pointer";
          el.title = "点击查看比赛详情";
          el.addEventListener("click", (e) => {
            e.stopPropagation();
            router.push(`/${seasonSlug}/matches/${matchId}`);
          });
        });
      })
      .catch(console.error);
  }, [scriptReady, data, matchNodeMap, seasonSlug, router]);

  if (data.stage.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-[var(--text-secondary)]">
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
        style={themeColor ? ({ "--primary-color": themeColor } as React.CSSProperties) : undefined}
        className="overflow-x-auto"
      >
        <div id="bracket-container" ref={containerRef} />
      </div>
    </>
  );
}
