import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminMatchWorkbench } from "@/components/matches/AdminMatchWorkbench";
import { loadAdminMatchWorkbench } from "@/lib/admin/matches/workbench";

interface AdminMatchWorkbenchPageProps {
  params: Promise<{ seasonSlug: string; matchId: string }>;
}

export default async function AdminMatchWorkbenchPage({ params }: AdminMatchWorkbenchPageProps) {
  const { seasonSlug, matchId } = await params;
  const data = await loadAdminMatchWorkbench({ seasonSlug, matchId });
  if (!data) notFound();

  return (
    <div className="min-w-0 space-y-5">
      <header>
        <p className="font-mono text-[11px] tracking-[0.12em] text-[var(--color-fg-mid)]">{data.season.name}</p>
        <h1 className="mt-1 text-2xl font-bold text-[var(--color-fg)]">单场比赛工作台</h1>
        <p className="mt-1 text-sm text-[var(--color-fg-mid)]">
          仅在本页处理实际首发、BP、地图、赛果、赛后资料和恢复操作。
        </p>
        <Link
          href={`/admin/${seasonSlug}/matches`}
          className="mt-3 inline-flex text-sm text-[var(--color-accent)] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
        >
          ← 回到赛事比赛总览
        </Link>
      </header>
      <AdminMatchWorkbench {...data} />
    </div>
  );
}
