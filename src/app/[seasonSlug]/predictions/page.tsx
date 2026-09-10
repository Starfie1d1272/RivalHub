import { Suspense } from "react";
import { z } from "zod";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { predictionScenarios } from "@/db/schema";
import { getPublicOrAuthorizedDraftSeason } from "@/lib/data/public-seasons";
import { getUserSession } from "@/lib/auth/session";
import { predictionBoard } from "@/lib/predictions/data";
import { PredictionBoard } from "@/components/predictions/PredictionBoard";
export default function PredictionsPage(props: {
  params: Promise<{ seasonSlug: string }>;
  searchParams: Promise<{ scenario?: string }>;
}) {
  return (
    <Suspense
      fallback={
        <div className="p-8" role="status">
          正在加载观赛预测…
        </div>
      }
    >
      <PredictionContent {...props} />
    </Suspense>
  );
}
async function PredictionContent({
  params,
  searchParams,
}: {
  params: Promise<{ seasonSlug: string }>;
  searchParams: Promise<{ scenario?: string }>;
}) {
  const { seasonSlug } = await params;
  const season = await getPublicOrAuthorizedDraftSeason(seasonSlug);
  if (!season || season.competitionTemplate !== "major") notFound();
  const user = await getUserSession();
  const data = await db.transaction((tx) =>
    predictionBoard(tx, season.id, user?.userId ?? null),
  );
  const { scenario } = await searchParams;
  const saved =
    scenario && z.guid().safeParse(scenario).success
      ? await db.query.predictionScenarios.findFirst({
          where: eq(predictionScenarios.id, scenario),
        })
      : null;
  if (scenario && (!saved || saved.seasonId !== season.id)) notFound();
  return (
    <PredictionBoard
      key={saved?.id ?? "current"}
      initial={data}
      slug={seasonSlug}
      signedIn={!!user}
      saved={
        saved
          ? {
              id: saved.id,
              name: saved.name,
              baseline: saved.baseline,
              choices: saved.choices,
              projection: saved.projection,
            }
          : null
      }
    />
  );
}
