import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import { DraftLiveRoom } from "@/components/draft/DraftLiveRoom";
import { Panel, Marker } from "@/components/rivalhub";
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
        <Panel pad={32}>
          <h1 className="text-2xl font-bold">选秀直播间 · {season.name}</h1>
          <p className="mt-2 text-sm text-[var(--color-fg-mid)]">
            {messages[season.status] ?? "选秀当前不可用。"}
          </p>
        </Panel>
      </main>
    );
  }

  const data = await getDraftData(season.id);

  return (
    <main className="container mx-auto max-w-7xl px-4 py-10">
      <Marker sub="实时更新选秀进度，队伍阵容与选手池自动刷新。">
        选秀直播间 · {season.name}
      </Marker>

      {!data.state ? (
        <Panel pad={32} className="text-center">
          <h2 className="text-xl font-semibold text-[var(--color-fg)] mb-2">
            选秀尚未启动
          </h2>
          <p className="text-sm text-[var(--color-fg-mid)]">
            等待管理员启动选秀，页面会自动刷新。
          </p>
        </Panel>
      ) : (
        <>
          {data.state.isActive && (
            <Panel pad={0}>
              <div className="grid items-stretch" style={{ gridTemplateColumns: "1.2fr 1.4fr 1fr 1fr" }}>
                {/* LIVE indicator */}
                <div className="flex items-center gap-3.5" style={{ padding: "16px 20px", borderRight: "1px solid var(--color-border)" }}>
                  <div style={{ width: 8, height: 40, background: "var(--color-danger)", boxShadow: "0 0 12px var(--color-danger)" }} />
                  <div>
                    <div className="font-bold uppercase" style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--color-danger)", letterSpacing: "var(--tracking-eyebrow)" }}>
                      ● LIVE
                    </div>
                    <div className="font-semibold mt-1" style={{ fontFamily: "var(--font-display)", fontSize: 18, color: "var(--color-fg)" }}>
                      选秀直播间
                    </div>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--color-fg-mid)" }}>
                      观众实时观看
                    </div>
                  </div>
                </div>

                {/* Current pick */}
                <div className="flex items-center gap-3.5" style={{ padding: "16px 20px", borderRight: "1px solid var(--color-border)" }}>
                  <div style={{ width: 56, height: 56, background: "var(--color-accent)22", border: "1px solid var(--color-accent)55", borderRadius: "var(--radius-sm)", display: "grid", placeItems: "center", fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 20, color: "var(--color-accent)" }}>
                    P
                  </div>
                  <div>
                    <div className="uppercase" style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--color-fg-dim)", letterSpacing: "var(--tracking-label)" }}>
                      CURRENT PICK
                    </div>
                    <div className="font-semibold mt-1" style={{ fontFamily: "var(--font-display)", fontSize: 18, color: "var(--color-accent)" }}>
                      选秀进行中
                    </div>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--color-fg-mid)" }}>
                      实时同步
                    </div>
                  </div>
                </div>

                {/* Timer */}
                <div style={{ padding: "16px 20px", borderRight: "1px solid var(--color-border)" }}>
                  <div className="uppercase" style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--color-fg-dim)", letterSpacing: "var(--tracking-label)" }}>
                    TIMER
                  </div>
                  <div className="font-bold mt-1" style={{ fontFamily: "var(--font-mono)", fontSize: 36, color: "var(--color-accent)", letterSpacing: "-0.04em", lineHeight: 1 }}>
                    {data.state.roundDeadline ? "计时中" : "--:--"}
                  </div>
                  <div className="mt-1.5 h-1 rounded-full overflow-hidden" style={{ background: "var(--color-border)" }}>
                    <div className="h-full" style={{ width: "32%", background: "var(--color-accent)" }} />
                  </div>
                </div>

                {/* Round + Pick */}
                <div className="flex flex-col justify-center gap-1" style={{ padding: "16px 20px" }}>
                  <div className="uppercase" style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--color-fg-dim)", letterSpacing: "var(--tracking-label)" }}>
                    ROUND · PICK
                  </div>
                  <div className="font-bold" style={{ fontFamily: "var(--font-mono)", fontSize: 28, color: "var(--color-fg)", letterSpacing: "-0.02em" }}>
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
        </>
      )}
    </main>
  );
}
