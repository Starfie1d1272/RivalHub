import { io } from "next/cache";
import { getPublicSeasonCatalog } from "@/lib/data/public-seasons";
import { selectActiveSeason } from "@/lib/home/navigation";
import { HeaderNavigation } from "./HeaderNavigation";

export async function HeaderPublicNavigation({ mobile = false }: { mobile?: boolean }) {
  await io();
  const seasons = await getPublicSeasonCatalog();
  const activeSeason = selectActiveSeason(seasons);

  return (
    <HeaderNavigation
      mobile={mobile}
      seasons={seasons.map(({ slug }) => ({ slug }))}
      activeSeason={activeSeason ? { slug: activeSeason.slug, name: activeSeason.name } : null}
    />
  );
}
