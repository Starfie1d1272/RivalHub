import { connection } from "next/server";
import { getLatestSiteAnnouncement, getRelevantAttentionAnnouncement, getRelevantAnnouncement } from "@/lib/announcements/read-model";
import { getPublicSeasonInfo } from "@/lib/season-public-info/read-model";
import { InformationFeedbackLauncherHost } from "./InformationFeedbackLauncherHost";
import { SeasonOperationsScope } from "./SeasonOperationsScope";

export async function GlobalInformationFeedbackLauncher() {
  await connection();
  const [latestAnnouncement, attentionAnnouncement] = await Promise.all([
    getLatestSiteAnnouncement(),
    getRelevantAttentionAnnouncement(),
  ]);
  return (
    <InformationFeedbackLauncherHost
      globalAnnouncement={latestAnnouncement}
      globalAttentionAnnouncement={attentionAnnouncement}
    />
  );
}

export async function SeasonInformationFeedbackLauncher({ season }: { season: { id: string; slug: string } }) {
  await connection();
  const [latestAnnouncement, attentionAnnouncement, seasonInfo] = await Promise.all([
    getRelevantAnnouncement(season.id),
    getRelevantAttentionAnnouncement(season.id),
    getPublicSeasonInfo(season.id),
  ]);
  return (
    <SeasonOperationsScope
      season={season}
      seasonInfo={seasonInfo}
      latestAnnouncement={latestAnnouncement}
      attentionAnnouncement={attentionAnnouncement}
    />
  );
}
