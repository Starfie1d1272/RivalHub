"use client";

import { useEffect, useRef, useState } from "react";
import Script from "next/script";
import type { BracketData } from "@/lib/bracket";

// brackets-viewer 通过 UMD bundle 暴露在 window.bracketsViewer
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
}

export function BracketView({ data, themeColor }: BracketViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scriptReady, setScriptReady] = useState(false);

  useEffect(() => {
    if (!scriptReady || !window.bracketsViewer || data.stage.length === 0) return;

    window.bracketsViewer.render(
      {
        stages: data.stage,
        matches: data.match,
        participants: data.participant,
        matchGames: [],
      },
      { selector: "#bracket-container", clear: true }
    );
  }, [scriptReady, data]);

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
