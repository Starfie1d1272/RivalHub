import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { getPublicSeasonCatalog } from "@/lib/data/public-seasons";
import { OFFICIAL_PRODUCTION } from "@/lib/runtime/official-deployment-profile.mjs";
import { isPreview } from "@/lib/runtime/preview";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection();
  if (isPreview()) return [];
  const seasons = await getPublicSeasonCatalog();
  const paths = ["/", "/seasons", "/teams", "/stats", "/rules", "/privacy"];
  for (const { slug } of seasons) paths.push(`/${encodeURIComponent(slug)}`);
  return paths.map((path) => ({ url: new URL(path, OFFICIAL_PRODUCTION.origin).href }));
}
