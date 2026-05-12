import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import { getPositionCounts, getApprovedCount } from "@/actions/register";
import { RegistrationForm } from "@/components/register/RegistrationForm";
import { normalizeRegistrationConfig } from "@/types/season";
import { Panel, StatusBanner, PosChip } from "@/components/rivalhub";
import { POSITION_LABELS } from "@/lib/validators/registration";
import { getRegistrationWindowState, getWindowTone } from "@/lib/registration/window";
import { formatCST } from "@/lib/utils/date";

export const dynamic = "force-dynamic";

interface RegisterPageProps {
  params: Promise<{ seasonSlug: string }>;
}

export async function generateMetadata({ params }: RegisterPageProps): Promise<Metadata> {
  const { seasonSlug } = await params;
  const season = await db.query.seasons.findFirst({
    where: eq(seasons.slug, seasonSlug),
  });
  return { title: season ? `报名 · ${season.name}` : "报名" };
}

export default async function RegisterPage({ params }: RegisterPageProps) {
  const { seasonSlug } = await params;

  const season = await db.query.seasons.findFirst({
    where: eq(seasons.slug, seasonSlug),
  });
  if (!season) notFound();

  // 报名未开放时显示状态提示
  if (season.status !== "registration") {
    const statusMessages: Record<string, string> = {
      draft:    "报名尚未开放，请关注后续公告。",
      voting:   "报名已截止，现在是队长投票阶段。",
      drafting: "报名已截止，现在是选秀阶段。",
      playing:  "报名已截止，赛季正在进行中。",
      finished: "该赛季已结束。",
      archived: "该赛季已归档。",
    };
    return (
      <div className="container mx-auto px-4 py-16 max-w-2xl">
        <Panel pad={40}>
        <div className="text-center">
          <StatusBanner
            tone="info"
            title={season.name}
            sub={statusMessages[season.status] ?? "报名通道当前不可用。"}
          />
        </div>
      </Panel>
      </div>
    );
  }

  const positionCounts = await getPositionCounts(season.id);
  const approvedCount = await getApprovedCount(season.id);
  const regConfig = normalizeRegistrationConfig(season.registrationConfig);
  const maxPerPos = regConfig.maxPerPosition;
  const registrationWindow = getRegistrationWindowState(season);

  // 位置容量数据
  const capacityEntries = season.positions.map((pos) => {
    const cur = positionCounts[pos] ?? 0;
    const label = POSITION_LABELS[pos as keyof typeof POSITION_LABELS]?.en ?? pos;
    return { pos, label, cur, max: maxPerPos };
  });

  return (
    <div className="container mx-auto px-4 py-10 max-w-2xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-[var(--color-fg)] mb-1">报名</h1>
        <p className="text-[var(--color-fg-mid)]">{season.name}</p>
      </div>

      {/* 位置实时容量 */}
      <div className="mb-6">
        <StatusBanner
          tone={getWindowTone(registrationWindow.phase, registrationWindow.canSubmit)}
          title={registrationWindow.message}
          sub={[
            season.startAt ? `报名开始：${formatCST(season.startAt)}` : "报名开始：发布后立即开放",
            season.registrationDeadline ? `报名截止：${formatCST(season.registrationDeadline)}` : "报名截止：未设置",
          ].join(" · ")}
        />
      </div>

      <div className="mb-6">
        <Panel label="实时容量">
          <div className="grid gap-2.5">
            {capacityEntries.map(({ pos, label, cur, max }) => {
              const pct = Math.min((cur / max) * 100, 100);
              const full = cur >= max;
              const warn = !full && pct > 80;
              return (
                <div key={pos} className="grid items-center gap-3" style={{ gridTemplateColumns: "72px 1fr 72px" }}>
                  <PosChip pos={label} />
                  <div className="h-1 rounded-full overflow-hidden" style={{ background: "var(--color-border)" }}>
                    <div
                      className="h-full transition-all"
                      style={{
                        width: `${pct}%`,
                        background: full ? "var(--color-danger)" : warn ? "var(--color-warn)" : "var(--color-accent)",
                      }}
                    />
                  </div>
                  <div
                    className="text-right font-bold"
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 11,
                      color: full ? "var(--color-danger)" : "var(--color-fg-mid)",
                    }}
                  >
                    {cur} / {max}
                    {full && <span className="ml-1">FULL</span>}
                  </div>
                </div>
              );
            })}
            <div className="flex justify-between items-center pt-2" style={{ borderTop: "1px solid var(--color-border)" }}>
              <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-fg-dim)", fontFamily: "var(--font-display)" }}>
                Approved
              </span>
              <span className="font-bold" style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--color-fg)" }}>
                {approvedCount} / {regConfig.maxTotal}
              </span>
            </div>
          </div>
        </Panel>
      </div>

      <Panel pad={24}>
        <RegistrationForm
          seasonId={season.id}
          seasonName={season.name}
          positionCounts={positionCounts}
          positions={season.positions}
          registrationConfig={regConfig}
          windowState={registrationWindow}
        />
      </Panel>

      <p className="text-xs text-[var(--color-fg-dim)] text-center mt-6">
        提交即视为同意参赛规则。报名信息提交后不可自行修改，如需更改请联系管理员。
      </p>
    </div>
  );
}
