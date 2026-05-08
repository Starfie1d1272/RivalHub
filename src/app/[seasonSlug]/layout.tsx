import type { Metadata } from "next";
import { Breadcrumb } from "@/components/layout/breadcrumb";
import { hexToRgbString } from "@/lib/utils/color";

// Mock season data — replaced with DB query in Phase 4+
const MOCK_SEASONS: Record<string, { name: string; themeColor: string }> = {
  "2026-nju-rivals": { name: "2026 NJU Rivals", themeColor: "#f97316" },
};

interface SeasonLayoutProps {
  children: React.ReactNode;
  params: Promise<{ seasonSlug: string }>;
}

export async function generateMetadata({ params }: SeasonLayoutProps): Promise<Metadata> {
  const { seasonSlug } = await params;
  const season = MOCK_SEASONS[seasonSlug];
  return {
    title: season?.name ?? seasonSlug,
  };
}

export default async function SeasonLayout({ children, params }: SeasonLayoutProps) {
  const { seasonSlug } = await params;
  const season = MOCK_SEASONS[seasonSlug];
  const themeColor = season?.themeColor ?? "#f97316";

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
            { label: season?.name ?? seasonSlug },
          ]}
        />
      </div>
      {children}
    </div>
  );
}
