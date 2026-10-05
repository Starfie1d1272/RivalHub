import { io } from "next/cache";
import { getPublicSeasonCatalog } from "@/lib/data/public-seasons";
import { HeaderNavigation } from "./HeaderNavigation";

export async function HeaderPublicNavigation({ mobile = false }: { mobile?: boolean }) {
  await io();
  const seasons = await getPublicSeasonCatalog();

  return (
    <HeaderNavigation
      mobile={mobile}
      seasons={seasons.map(({ slug }) => ({ slug }))}
    />
  );
}
