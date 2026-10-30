"use client";
import { PlayerProfileLink } from "@/components/players/PlayerProfileLink";

import React, { useState } from "react";
import { Panel } from "@/components/rivalhub";
import { Button } from "@/components/ui/button";
import { getPublicLiveCommentators } from "@/lib/matches/presentation";
import { getPublicDisplayName } from "@/lib/identity/display-name";
import type { MatchStatus } from "@/types/match";

type Commentator = {
  userId: string;
  playerUserId?: string | null;
  liveStreamUrl: string | null;
  bilibiliRoomId: string | null;
  displayName: string | null;
  perfectName: string | null;
  personaName: string | null;
  broadcastStatus: "live" | "offline" | "unknown";
};

/** The documented Bilibili activity player is the only iframe endpoint we embed. */
export function getBilibiliEmbedUrl(roomId: string): string {
  const url = new URL("https://www.bilibili.com/blackboard/live/live-activity-player.html");
  url.search = new URLSearchParams({
    cid: roomId,
    danmaku: "1",
    fullscreen: "1",
    entrance: "1",
    recommend: "0",
  }).toString();
  return url.toString();
}

export function MatchLiveViewing({
  status,
  commentators,
  showEmpty = false,
}: {
  status: MatchStatus;
  commentators: Commentator[];
  showEmpty?: boolean;
}) {
  const resources = getPublicLiveCommentators(status, commentators);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [loadedRooms, setLoadedRooms] = useState<Record<string, boolean>>({});

  const liveResources = resources.filter((c) => c.broadcastStatus === "live" && c.bilibiliRoomId);
  const activeCommentator = liveResources.find((c) => c.userId === selectedUserId) ?? liveResources[0];
  const activeUserId = activeCommentator?.userId ?? null;
  if (selectedUserId !== activeUserId) setSelectedUserId(activeUserId);

  if (!resources.length) return showEmpty ? <section aria-label="直播观看" className="border-y border-[var(--color-border)] py-4"><h2 className="text-sm font-semibold">直播观看</h2><p className="mt-1 text-sm text-[var(--color-fg-dim)]">暂无直播</p></section> : null;

  const bilibiliRoomId = activeCommentator?.bilibiliRoomId ?? null;
  const isLoaded = Boolean(bilibiliRoomId && loadedRooms[bilibiliRoomId]);
  const isProminent = Boolean(bilibiliRoomId);

  return (
    <Panel label={isProminent && bilibiliRoomId ? "站内直播观看" : "直播观看"} contentClassName="p-4 space-y-4">
      {liveResources.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] pb-3 text-xs">
          <span className="text-[var(--color-fg-dim)]">切换解说：</span>
          {liveResources.map((commentator) => (
            <div key={commentator.userId} className="flex items-center"><button
              type="button"
              onClick={() => setSelectedUserId(commentator.userId)}
              className={`rounded px-2 py-1 transition-colors ${
                commentator.userId === activeCommentator?.userId
                  ? "bg-[var(--color-accent)] font-semibold text-white"
                  : "bg-[var(--color-panel-lo)] text-[var(--color-fg-mid)] hover:text-[var(--color-fg)]"
              }`}
            >
              {getPublicDisplayName(commentator)}
            </button>{commentator.playerUserId && <PlayerProfileLink userId={commentator.playerUserId} variant="dense" aria-label={`查看 ${getPublicDisplayName(commentator)} 选手资料`}>↗</PlayerProfileLink>}</div>
          ))}
        </div>
      )}

      {bilibiliRoomId && activeCommentator ? (
        <div className="space-y-3">
          <div className="relative aspect-video w-full overflow-hidden rounded-md border border-[var(--color-border)] bg-black">
            {isLoaded ? (
              <iframe
                src={getBilibiliEmbedUrl(bilibiliRoomId)}
                title="Bilibili 直播播放器"
                className="h-full w-full border-0"
                allow="autoplay; fullscreen"
                sandbox="allow-scripts allow-same-origin allow-popups"
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
                <p className="text-sm text-[var(--color-fg-mid)]">解说 · {activeCommentator.playerUserId ? <PlayerProfileLink userId={activeCommentator.playerUserId}>{getPublicDisplayName(activeCommentator)}</PlayerProfileLink> : getPublicDisplayName(activeCommentator)}</p>
                <div className="flex flex-wrap items-center justify-center gap-3">
                  <Button
                    onClick={() =>
                      setLoadedRooms((prev) => ({ ...prev, [bilibiliRoomId]: true }))
                    }
                  >
                    加载站内播放器
                  </Button>
                  <Button variant="outline" asChild>
                    <a
                      href={activeCommentator.liveStreamUrl!}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      在 Bilibili 打开 ↗
                    </a>
                  </Button>
                </div>
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--color-fg-dim)]">
            <span>加载后可在页面内观看</span>
            <a
              href={activeCommentator.liveStreamUrl!}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-[var(--color-accent)] hover:underline"
            >
              进入直播间 ↗
            </a>
          </div>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        {resources.map((commentator) => (
          <a key={commentator.userId} href={commentator.liveStreamUrl!} target="_blank" rel="noopener noreferrer" className="text-sm text-[var(--color-fg-mid)] hover:underline">
            {getPublicDisplayName(commentator)} · 进入直播间 ↗
          </a>
        ))}
      </div>
    </Panel>
  );
}
