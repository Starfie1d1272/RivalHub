import { io } from "next/cache";
import { getPublicSeasonCatalog } from "@/lib/data/public-seasons";
import { HeaderNavigation } from "./HeaderNavigation";

export async function HeaderPublicNavigation({ mobile = false }: { mobile?: boolean }) {
  await io();
  const seasons = await getPublicSeasonCatalog();

  return (
    <HeaderNavigation
      mobile={mobile}
      seasons={seasons.map((season) => ({
        slug: season.slug,
        name: season.name,
        status: season.status,
        registrationOpensAt: season.registrationOpensAt,
        registrationOpenedAt: season.registrationOpenedAt,
        registrationClosesAt: season.registrationClosesAt,
      }))}
    />
  );
}
