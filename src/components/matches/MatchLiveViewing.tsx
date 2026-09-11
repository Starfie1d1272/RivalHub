"use client";

import React, { useState } from "react";
import { Panel } from "@/components/rivalhub";
import { Button } from "@/components/ui/button";
import { getPublicLiveCommentators } from "@/lib/matches/presentation";
import { getPublicDisplayName } from "@/lib/identity/display-name";
import type { MatchStatus } from "@/types/match";

type Commentator = {
  userId: string;
  liveStreamUrl: string | null;
  displayName: string | null;
  perfectName: string | null;
  steamName: string | null;
};

export function parseBilibiliLiveRoomId(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "live.bilibili.com" && parsed.hostname !== "www.live.bilibili.com") {
      return null;
    }
    const match = /^\/(\d+)\/?$/.exec(parsed.pathname);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export function MatchLiveViewing({
  status,
  commentators,
}: {
  status: MatchStatus;
  commentators: Commentator[];
}) {
  const resources = getPublicLiveCommentators(status, commentators);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [loadedRooms, setLoadedRooms] = useState<Record<string, boolean>>({});

  if (!resources.length) return null;

  const activeCommentator =
    resources.find((c) => c.userId === selectedUserId) ?? resources[0];
  const bilibiliRoomId = parseBilibiliLiveRoomId(activeCommentator.liveStreamUrl);
  const isLoaded = Boolean(bilibiliRoomId && loadedRooms[bilibiliRoomId]);
  const isProminent = status === "in_progress";

  return (
    <Panel label={isProminent && bilibiliRoomId ? "站内直播观看" : "直播观看"} contentClassName="p-4 space-y-4">
      {resources.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] pb-3 text-xs">
          <span className="text-[var(--color-fg-dim)]">切换解说：</span>
          {resources.map((commentator) => (
            <button
              key={commentator.userId}
              type="button"
              onClick={() => setSelectedUserId(commentator.userId)}
              className={`rounded px-2 py-1 transition-colors ${
                commentator.userId === activeCommentator.userId
                  ? "bg-[var(--color-accent)] font-semibold text-white"
                  : "bg-[var(--color-panel-lo)] text-[var(--color-fg-mid)] hover:text-[var(--color-fg)]"
              }`}
            >
              {getPublicDisplayName(commentator)}
            </button>
          ))}
        </div>
      )}

      {bilibiliRoomId && isProminent ? (
        <div className="space-y-3">
          <div className="relative aspect-video w-full overflow-hidden rounded-md border border-[var(--color-border)] bg-black">
            {isLoaded ? (
              <iframe
                src={`https://live.bilibili.com/blank?roomId=${bilibiliRoomId}`}
                title={`Bilibili 直播间 ${bilibiliRoomId}`}
                className="h-full w-full border-0"
                allow="autoplay; fullscreen"
                sandbox="allow-scripts allow-same-origin allow-popups"
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
                <p className="text-sm text-[var(--color-fg-mid)]">
                  解说 · {getPublicDisplayName(activeCommentator)}（Bilibili 房间号 {bilibiliRoomId}）
                </p>
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
            <span>官方嵌入播放器 · Click-to-load 模式</span>
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
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button asChild>
            <a
              href={activeCommentator.liveStreamUrl!}
              target="_blank"
              rel="noopener noreferrer"
            >
              进入直播间 ↗
            </a>
          </Button>
          <span className="text-sm text-[var(--color-fg-mid)]">
            解说 · {getPublicDisplayName(activeCommentator)}
          </span>
          {bilibiliRoomId && (
            <span className="text-xs text-[var(--color-fg-dim)]">
              （Bilibili 直播 · 比赛进行中可站内播放）
            </span>
          )}
        </div>
      )}
    </Panel>
  );
}
