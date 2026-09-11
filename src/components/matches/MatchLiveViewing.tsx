import React from "react";
import { Panel } from "@/components/rivalhub";
import { Button } from "@/components/ui/button";
import { getPublicLiveCommentators } from "@/lib/postmatch/service";
import { getPublicDisplayName } from "@/lib/identity/display-name";
import type { MatchStatus } from "@/types/match";

type Commentator = { userId: string; liveStreamUrl: string | null; displayName: string | null; perfectName: string | null; steamName: string | null };

export function MatchLiveViewing({ status, commentators }: { status: MatchStatus; commentators: Commentator[] }) {
  const resources = getPublicLiveCommentators(status, commentators);
  if (!resources.length) return null;
  return <Panel label="直播观看" contentClassName="flex flex-wrap items-center gap-4 p-4">
    {resources.map((commentator) => <div key={commentator.userId} className="flex flex-wrap items-center gap-3">
      <Button asChild><a href={commentator.liveStreamUrl!} target="_blank" rel="noopener noreferrer">进入直播间 ↗</a></Button>
      <span className="text-sm text-[var(--color-fg-mid)]">解说 · {getPublicDisplayName(commentator)}</span>
    </div>)}
  </Panel>;
}
