import { redirect } from "next/navigation";
import { MyCompetitionCard } from "@/components/my/MyCompetitionCard";
import { EmptyState, PageHeader, Section, SectionHeader } from "@/components/rivalhub";
import { groupMyCompetitionContexts, loadMyCompetitionContexts } from "@/lib/my/competitions";
import { getUserSession } from "@/lib/auth/session";

// This page is entirely viewer-specific and intentionally request-bound.
export const instant = false;

function CompetitionGroup({ title, description, contexts }: { title: string; description: string; contexts: Awaited<ReturnType<typeof loadMyCompetitionContexts>> }) {
  return <Section><SectionHeader title={title} description={description} />{contexts.length > 0 ? <div className="grid gap-4 xl:grid-cols-2">{contexts.map((context) => <MyCompetitionCard key={context.entryId} context={context} />)}</div> : <EmptyState title="暂无赛事记录" sub="报名、参赛确认和赛事名单是不同的事实；有记录后会在这里分别展示。" />}</Section>;
}

export default async function MyCompetitionsPage() {
  const session = await getUserSession();
  if (!session) redirect("/login?next=/my/competitions");
  const grouped = groupMyCompetitionContexts(await loadMyCompetitionContexts(session.userId));
  return <div className="space-y-8"><PageHeader title="我的赛事" description="按赛季查看你负责、确认参加或通过长期队伍关联的赛事；赛事身份和报名状态分别展示。" /><CompetitionGroup title="当前参与" description="未结束赛季按赛季创建时间倒序展示。" contexts={grouped.current} /><CompetitionGroup title="历史赛事" description="已结束和已归档赛季按赛季创建时间倒序展示。" contexts={grouped.history} /></div>;
}
