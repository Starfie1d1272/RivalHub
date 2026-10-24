import { ContentReady } from "@/components/telemetry/ContentReady";
import { loadMyCompetitionContexts } from "@/lib/my/competitions";
import { redirect } from "next/navigation";
import { MyTeamWorkspace } from "@/components/my/MyTeamWorkspace";
import { getUserSession } from "@/lib/auth/session";
import { loadMyTeamWorkspace } from "@/lib/my/team-workspace";

// Viewer-specific membership and invitation state is request-bound.
export const instant = false;

export default async function MyTeamsPage() {
  const session = await getUserSession();
  if (!session) redirect("/login?next=/my/teams");
  const [model, personalCompetitions] = await Promise.all([loadMyTeamWorkspace(session.userId), loadMyCompetitionContexts(session.userId)]);
  return <><ContentReady module="account" phase="primary" /><MyTeamWorkspace model={model} personalCompetitions={personalCompetitions} /></>;
}
