import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { competitiveRankFacts } from "@/db/schema";
import { CompetitiveProfileForm } from "@/components/settings/CompetitiveProfileForm";
import { getUserSession } from "@/lib/auth/session";
import { normalizeTeamRegistrationConfig } from "@/types/season";

export default async function CompetitiveProfileSettingsPage() {
  const session = await getUserSession();
  if (!session) redirect("/login?next=/settings/competitive");
  const seasonRows = await db.query.seasons.findMany({ orderBy: (table, { desc }) => [desc(table.updatedAt)] });
  const config = seasonRows.map((season) => normalizeTeamRegistrationConfig(season.teamRegistrationConfig)).find((item) => item.requireCompetitiveProfile)?.competitiveProfile ?? null;
  const facts = config ? await db.select().from(competitiveRankFacts).where(and(eq(competitiveRankFacts.userId, session.userId), eq(competitiveRankFacts.platform, config.platform))) : [];
  const fact = (kind: "historical_peak" | "season_peak", seasonKey: string | null) => facts.find((item) => item.kind === kind && item.platformSeasonKey === seasonKey);
  const toInput = (item: typeof facts[number] | undefined) => item ? { rank: item.rank, rating: String(item.rating) } : { rank: "", rating: "" };
  return <main className="container mx-auto max-w-2xl space-y-5 px-4 py-10"><div><p className="font-mono text-[11px] tracking-[0.18em] text-[var(--color-accent)]">PARTICIPANT PROFILE</p><h1 className="mt-1 text-3xl font-semibold">竞技档案</h1></div><CompetitiveProfileForm config={config} initial={{ historical: toInput(fact("historical_peak", null)), previous: toInput(config ? fact("season_peak", config.previousSeasonKey) : undefined), current: toInput(config ? fact("season_peak", config.currentSeasonKey) : undefined) }} /></main>;
}
