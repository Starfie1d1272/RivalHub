import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { OFFICIAL_PRODUCTION } from "@/lib/runtime/official-deployment-profile.mjs";
import { isPreview } from "@/lib/runtime/preview";

export default async function robots(): Promise<MetadataRoute.Robots> {
  await connection();
  if (isPreview()) return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/api", "/auth", "/my", "/settings", "/team-invites"],
    },
    sitemap: `${OFFICIAL_PRODUCTION.origin}/sitemap.xml`,
  };
}
