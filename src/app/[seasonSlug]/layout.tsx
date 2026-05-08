import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import { Breadcrumb } from "@/components/layout/breadcrumb";
import { hexToRgbString } from "@/lib/utils/color";

interface SeasonLayoutProps {
  children: React.ReactNode;
  params: Promise<{ seasonSlug: string }>;
}

export async function generateMetadata({ params }: SeasonLayoutProps): Promise<Metadata> {
  const { seasonSlug } = await params;
  const season = await db.query.seasons.findFirst({
    where: eq(seasons.slug, seasonSlug),
  });
  return {
    title: season?.name ?? seasonSlug,
  };
}

export default async function SeasonLayout({ children, params }: SeasonLayoutProps) {
  const { seasonSlug } = await params;

  const season = await db.query.seasons.findFirst({
    where: eq(seasons.slug, seasonSlug),
  });

  if (!season) notFound();

  const themeColor = season.themeColor ?? "#f97316";

  return (
    <div
      data-season={seasonSlug}
      style={{
        "--season-primary": themeColor,
        "--season-primary-rgb": hexToRgbString(themeColor),
      } as React.CSSProperties}
    >
      <div className="container mx-auto px-4 pt-6">
        <Breadcrumb
          items={[
            { label: "首页", href: "/" },
            { label: season.name },
          ]}
        />
      </div>
      {children}
    </div>
  );
}
