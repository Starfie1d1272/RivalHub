"use client";

import { usePathname } from "next/navigation";
import { useOperations } from "./OperationsContext";
import { InformationFeedbackLauncher } from "./InformationFeedbackLauncher";
import type { PublicAnnouncement } from "@/lib/announcements/presentation";

export function InformationFeedbackLauncherHost({
  globalAnnouncement,
  globalAttentionAnnouncement,
}: {
  globalAnnouncement?: PublicAnnouncement | null;
  globalAttentionAnnouncement?: PublicAnnouncement | null;
}) {
  const pathname = usePathname();
  const { seasonScope } = useOperations();

  if (pathname.startsWith("/admin")) return null;

  if (seasonScope) {
    return (
      <InformationFeedbackLauncher
        latestAnnouncement={seasonScope.latestAnnouncement}
        attentionAnnouncement={seasonScope.attentionAnnouncement}
        season={seasonScope.season}
        seasonInfo={seasonScope.seasonInfo}
      />
    );
  }

  return (
    <InformationFeedbackLauncher
      latestAnnouncement={globalAnnouncement ?? null}
      attentionAnnouncement={globalAttentionAnnouncement ?? null}
      season={null}
      seasonInfo={null}
    />
  );
}
