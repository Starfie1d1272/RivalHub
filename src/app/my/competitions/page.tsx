import { redirect } from "next/navigation";
import { MyCompetitionCard } from "@/components/my/MyCompetitionCard";
import { EmptyState, PageHeader, Section, SectionHeader } from "@/components/rivalhub";
import { groupMyCompetitionContexts, loadMyCompetitionContexts } from "@/lib/my/competitions";
import { getUserSession } from "@/lib/auth/session";
import { loadTestMatches } from "@/lib/matches/test-matches";
import { TestMatchList } from "@/components/matches/TestMatchList";

// This page is entirely viewer-specific and intentionally request-bound.
export const instant = false;

function CompetitionGroup({ title, contexts }: { title: string; contexts: Awaited<ReturnType<typeof loadMyCompetitionContexts>> }) {
  return <Section><SectionHeader title={title} />{contexts.length > 0 ? <div className={contexts.length > 1 ? "grid gap-4 xl:grid-cols-2" : "grid gap-4"}>{contexts.map((context) => <MyCompetitionCard key={context.entryId} context={context} />)}</div> : <EmptyState title="暂无赛事记录" />}</Section>;
}

export default async function MyCompetitionsPage() {
  const session = await getUserSession();
  if (!session) redirect("/login?next=/my/competitions");
  const [contexts, testMatches] = await Promise.all([
    loadMyCompetitionContexts(session.userId),
    loadTestMatches({ viewerId: session.userId }),
  ]);
  const grouped = groupMyCompetitionContexts(contexts);
  return <div className="space-y-8"><PageHeader title="我的赛事" />{testMatches.length > 0 && <Section><SectionHeader title="我的测试赛" description="双方队长和指定 BP 操作人的比赛入口。" /><TestMatchList matches={testMatches} /></Section>}<CompetitionGroup title="当前参与" contexts={grouped.current} /><CompetitionGroup title="历史赛事" contexts={grouped.history} /></div>;
}
