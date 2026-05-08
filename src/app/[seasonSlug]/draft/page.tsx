import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import { DraftLiveRoom } from "@/components/draft/DraftLiveRoom";
import { Card } from "@/components/ui/card";
import { getDraftData } from "@/lib/draft/data";

export const dynamic = "force-dynamic";

interface DraftPageProps {
  params: Promise<{ seasonSlug: string }>;
}

export async function generateMetadata({ params }: DraftPageProps): Promise<Metadata> {
  const { seasonSlug } = await params;
  return { title: `选秀直播间 · ${seasonSlug}` };
}

export default async function DraftPage({ params }: DraftPageProps) {
  const { seasonSlug } = await params;
  const season = await db.query.seasons.findFirst({
    where: eq(seasons.slug, seasonSlug),
  });
  if (!season) notFound();

  if (!season.hasDraft) {
    return (
      <main className="container mx-auto max-w-5xl px-4 py-10">
        <Card className="p-8">
          <h1 className="text-2xl font-bold">选秀直播间 · {season.name}</h1>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            该赛季未启用蛇形选秀。
          </p>
        </Card>
      </main>
    );
  }

  if (season.status !== "drafting") {
    const messages: Record<string, string> = {
      draft: "选秀尚未开放，赛季仍在筹备中。",
      registration: "报名阶段结束后才会开始选秀，请耐心等待。",
      voting: "队长投票进行中，投票结束后将进入选秀阶段。",
      playing: "选秀已结束，赛季正在进行中。",
      finished: "该赛季已结束。",
      archived: "该赛季已归档。",
    };
    return (
      <main className="container mx-auto max-w-5xl px-4 py-10">
        <Card className="p-8">
          <h1 className="text-2xl font-bold">选秀直播间 · {season.name}</h1>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            {messages[season.status] ?? "选秀当前不可用。"}
          </p>
        </Card>
      </main>
    );
  }

  const data = await getDraftData(season.id);

  return (
    <main className="container mx-auto max-w-7xl px-4 py-10">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">选秀直播间 · {season.name}</h1>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          实时更新选秀进度，队伍阵容与选手池自动刷新。
        </p>
      </div>

      {!data.state ? (
        <Card className="p-8 text-center">
          <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-2">
            选秀尚未启动
          </h2>
          <p className="text-sm text-[var(--text-secondary)]">
            等待管理员启动选秀，页面会自动刷新。
          </p>
        </Card>
      ) : (
        <DraftLiveRoom
          data={data}
          seasonId={season.id}
          seasonSlug={seasonSlug}
          seasonPositions={season.positions}
        />
      )}
    </main>
  );
}
