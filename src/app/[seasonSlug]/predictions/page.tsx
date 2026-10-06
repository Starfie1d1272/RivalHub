import { PageLayout } from "@/components/rivalhub";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { getPublicOrAuthorizedDraftSeason } from "@/lib/data/public-seasons";
import { getUserSession } from "@/lib/auth/session";
import { predictionBoard, publicPickEmBoard } from "@/lib/predictions/data";
import { PredictionBoard } from "@/components/predictions/PredictionBoard";
export default function PredictionsPage(props: {
  params: Promise<{ seasonSlug: string }>;
}) {
  return (
    <PageLayout as="div" variant="workbench">
      <Suspense
        fallback={
          <div className="p-8" role="status">
            正在加载观赛预测…
          </div>
        }
      >
        <PredictionContent {...props} />
      </Suspense>
    </PageLayout>
  );
}
async function PredictionContent({
  params,
}: {
  params: Promise<{ seasonSlug: string }>;
}) {
  const { seasonSlug } = await params;
  const season = await getPublicOrAuthorizedDraftSeason(seasonSlug);
  if (!season || season.competitionTemplate !== "major") notFound();
  const user = await getUserSession();
  const data = await db.transaction((tx) =>
    predictionBoard(tx, season.id, user?.userId ?? null, "sim"),
    { accessMode: "read only", isolationLevel: "repeatable read" },
  );
  return <PredictionBoard initial={publicPickEmBoard(data)} slug={seasonSlug} signedIn={!!user} />;
}
