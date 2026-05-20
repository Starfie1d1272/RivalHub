import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import { DraftLiveRoom } from "@/components/draft/DraftLiveRoom";
import { Panel, Marker } from "@/components/rivalhub";
import { getDraftData } from "@/lib/draft/data";
import { SEASON_STATUS_LABELS } from "@/types/season";
import { checkAdminSession } from "@/lib/auth/session";
import { AdminShortcut } from "@/components/layout/AdminShortcut";

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
  const [season, adminSession] = await Promise.all([
    db.query.seasons.findFirst({ where: eq(seasons.slug, seasonSlug) }),
    checkAdminSession(),
  ]);
  if (!season) notFound();

  if (!season.hasDraft) {
    return (
      <main className="container mx-auto max-w-5xl px-4 py-10 space-y-8">
        <Panel pad={32}>
          <h1 className="text-2xl font-bold">选秀直播间 · {season.name}</h1>
          <p className="mt-2 text-sm text-[var(--color-fg-mid)]">
            该赛季未启用蛇形选秀。
          </p>
        </Panel>
      </main>
    );
  }

  if (season.status !== "drafting") {
    const stageLabel = SEASON_STATUS_LABELS[season.status] ?? season.status;
    const draftFinished = season.status === "playing" || season.status === "finished";

    if (!draftFinished) {
      return (
        <main className="container mx-auto max-w-5xl px-4 py-10 space-y-8">
          <Panel pad={32}>
            <h1 className="text-2xl font-bold">选秀直播间 · {season.name}</h1>
            <p className="mt-2 text-sm text-[var(--color-fg-mid)]">
              选秀尚未开放 · 当前阶段：{stageLabel}
            </p>
          </Panel>
        </main>
      );
    }

    const data = await getDraftData(season.id);
    return (
      <main className="container mx-auto max-w-7xl px-4 py-10 space-y-8">
        <Marker sub="选秀已结束，以下为完整选人记录。">
          选秀回顾 · {season.name}
        </Marker>
        <DraftLiveRoom
          data={data}
          seasonId={season.id}
          seasonSlug={seasonSlug}
          seasonPositions={season.positions}
          readonly
        />
      </main>
    );
  }

  const data = await getDraftData(season.id);

  if (!data.state) {
    return (
      <main className="container mx-auto max-w-7xl px-4 py-10 space-y-8">
        <Marker sub="队伍已组建，选秀尚未启动。队长可提前查看选手池研究阵容。">
          选秀预览 · {season.name}
        </Marker>

        <div className="mb-6 rounded-lg border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/5 px-4 py-3">
          <p className="text-sm text-[var(--color-fg-mid)]">
            等待管理员启动选秀，页面会自动刷新。
          </p>
          <p className="mt-1 text-xs text-[var(--color-fg-dim)]">
            以下为只读预览，包含已报名选手与队伍信息。选秀开始后页面会自动切换为直播模式。
          </p>
        </div>
        <div className="mb-4">
          <a
            href={`/${seasonSlug}/draft/captain`}
            className="inline-flex items-center gap-2 rounded-md border border-[var(--color-accent)] bg-[var(--color-accent)]/10 px-4 py-2 text-sm font-medium text-[var(--color-accent)] hover:bg-[var(--color-accent)]/20 transition-colors"
          >
            进入队长选人面板 →
          </a>
        </div>

        <DraftLiveRoom
          data={data}
          seasonId={season.id}
          seasonSlug={seasonSlug}
          seasonPositions={season.positions}
          readonly
        />
      </main>
    );
  }

  return (
    <main className="container mx-auto max-w-7xl px-4 py-10 space-y-8">
      <div className="flex items-center justify-between">
        <Marker sub="实时更新选秀进度，队伍阵容与选手池自动刷新。">
          选秀直播间 · {season.name}
        </Marker>
        {adminSession && (
          <AdminShortcut href={`/admin/${seasonSlug}/draft`} />
        )}
      </div>

      {data.state.isActive && (
        <div>
          <a
            href={`/${seasonSlug}/draft/captain`}
            className="inline-flex items-center gap-2 rounded-md border border-[var(--color-accent)] bg-[var(--color-accent)]/10 px-4 py-2 text-sm font-medium text-[var(--color-accent)] hover:bg-[var(--color-accent)]/20 transition-colors"
          >
            进入队长选人面板 →
          </a>
        </div>
      )}

      {data.state.isActive && (
        <Panel pad={0}>
          <div className="grid grid-cols-2 md:grid-cols-4 items-stretch">
            {/* LIVE indicator */}
            <div className="flex items-center gap-3.5 min-w-0 md:border-r border-[var(--color-border)]" style={{ padding: "16px 20px" }}>
              <div className="shrink-0" style={{ width: 8, height: 40, background: "var(--color-danger)", boxShadow: "0 0 12px var(--color-danger)" }} />
              <div className="min-w-0">
                <div className="font-bold uppercase truncate" style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--color-danger)", letterSpacing: "var(--tracking-eyebrow)" }}>
                  ● LIVE
                </div>
                <div className="font-semibold mt-1 truncate" style={{ fontFamily: "var(--font-display)", fontSize: 18, color: "var(--color-fg)" }}>
                  选秀直播间
                </div>
                <div className="truncate" style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--color-fg-mid)" }}>
                  观众实时观看
                </div>
              </div>
            </div>

            {/* Current pick */}
            <div className="flex items-center gap-3.5 min-w-0 md:border-r border-[var(--color-border)]" style={{ padding: "16px 20px" }}>
              <div className="shrink-0" style={{ width: 56, height: 56, background: "var(--color-accent)22", border: "1px solid var(--color-accent)55", borderRadius: "var(--radius-sm)", display: "grid", placeItems: "center", fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 20, color: "var(--color-accent)" }}>
                P
              </div>
              <div className="min-w-0">
                <div className="uppercase truncate" style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--color-fg-dim)", letterSpacing: "var(--tracking-label)" }}>
                  CURRENT PICK
                </div>
                <div className="font-semibold mt-1 truncate" style={{ fontFamily: "var(--font-display)", fontSize: 18, color: "var(--color-accent)" }}>
                  选秀进行中
                </div>
                <div className="truncate" style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--color-fg-mid)" }}>
                  实时同步
                </div>
              </div>
            </div>

            {/* Timer */}
            <div className="min-w-0 md:border-r border-[var(--color-border)]" style={{ padding: "16px 20px" }}>
              <div className="uppercase truncate" style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--color-fg-dim)", letterSpacing: "var(--tracking-label)" }}>
                TIMER
              </div>
              <div className="font-bold mt-1 truncate" style={{ fontFamily: "var(--font-mono)", fontSize: 36, color: "var(--color-accent)", letterSpacing: "-0.04em", lineHeight: 1 }}>
                {data.state.roundDeadline ? "计时中" : "--:--"}
              </div>
              <div className="mt-1.5 h-1 rounded-full overflow-hidden" style={{ background: "var(--color-border)" }}>
                <div className="h-full" style={{ width: "32%", background: "var(--color-accent)" }} />
              </div>
            </div>

            {/* Round + Pick */}
            <div className="flex flex-col justify-center gap-1 min-w-0" style={{ padding: "16px 20px" }}>
              <div className="uppercase truncate" style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--color-fg-dim)", letterSpacing: "var(--tracking-label)" }}>
                ROUND · PICK
              </div>
              <div className="font-bold truncate" style={{ fontFamily: "var(--font-mono)", fontSize: 28, color: "var(--color-fg)", letterSpacing: "-0.02em" }}>
                {data.state.currentRound ?? 1} · <span style={{ color: "var(--color-fg-dim)" }}>—/—</span>
              </div>
            </div>
              </div>
            </Panel>
          )}
        <DraftLiveRoom
          data={data}
          seasonId={season.id}
          seasonSlug={seasonSlug}
          seasonPositions={season.positions}
        />
    </main>
  );
}
