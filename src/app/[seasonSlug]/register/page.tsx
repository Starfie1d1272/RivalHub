import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import { getPositionCounts } from "@/actions/register";
import { RegistrationForm } from "@/components/register/RegistrationForm";
import { normalizeRegistrationConfig } from "@/types/season";

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
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-10 text-center">
          <h1 className="text-2xl font-bold text-[var(--text-primary)] mb-3">
            {season.name}
          </h1>
          <p className="text-[var(--text-secondary)]">
            {statusMessages[season.status] ?? "报名通道当前不可用。"}
          </p>
        </div>
      </div>
    );
  }

  const positionCounts = await getPositionCounts(season.id);

  return (
    <div className="container mx-auto px-4 py-10 max-w-2xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-[var(--text-primary)] mb-1">报名</h1>
        <p className="text-[var(--text-secondary)]">{season.name}</p>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-6 sm:p-8">
        <RegistrationForm
          seasonId={season.id}
          seasonName={season.name}
          positionCounts={positionCounts}
          positions={season.positions}
          registrationConfig={normalizeRegistrationConfig(season.registrationConfig)}
        />
      </div>

      <p className="text-xs text-[var(--text-muted)] text-center mt-6">
        提交即视为同意参赛规则。报名信息提交后不可自行修改，如需更改请联系管理员。
      </p>
    </div>
  );
}
