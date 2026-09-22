import { Suspense } from "react";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import { requireSeasonAdmin } from "@/lib/auth/session";
import { predictionBoard } from "@/lib/predictions/data";
import { PredictionAdmin } from "@/components/predictions/PredictionAdmin";
export default function AdminPredictionsPage(props: {
  params: Promise<{ seasonSlug: string }>;
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
}: {
  params: Promise<{ seasonSlug: string }>;
}) {
  const { seasonSlug } = await params;
  const season = await db.query.seasons.findFirst({
    where: eq(seasons.slug, seasonSlug),
  });
  if (!season || season.competitionTemplate !== "major") notFound();
  const admin = await requireSeasonAdmin(season.id);
  const data = await db.transaction((tx) =>
    predictionBoard(tx, season.id, admin.userId),
  );
  return <PredictionAdmin data={data} />;
}
