import { connection } from "next/server";

import { getPublicSeasonCatalog } from "@/lib/data/public-seasons";
import { HeaderNavigation } from "./HeaderNavigation";

export async function HeaderPublicNavigation({ mobile = false }: { mobile?: boolean }) {
  await connection();
  const seasons = (await getPublicSeasonCatalog()).filter(
    (season) => season.status !== "archived",
  );

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
