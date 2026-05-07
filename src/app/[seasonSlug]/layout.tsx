// TODO: inject season theme_color as CSS variable, validate seasonSlug exists
import type { Metadata } from "next";

interface SeasonLayoutProps {
  children: React.ReactNode;
  params: Promise<{ seasonSlug: string }>;
}

export async function generateMetadata({ params }: SeasonLayoutProps): Promise<Metadata> {
  const { seasonSlug } = await params;
  return {
    title: seasonSlug.toUpperCase(),
  };
}

export default async function SeasonLayout({ children, params }: SeasonLayoutProps) {
  const { seasonSlug } = await params;
  // TODO: fetch season from DB, apply theme_color CSS variable
  return (
    <div data-season={seasonSlug}>
      {children}
    </div>
  );
}
