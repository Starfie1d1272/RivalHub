import { redirect } from "next/navigation";
import { requireSuperAdmin } from "@/lib/auth/session";
import { createCompetitionTemplate } from "@/lib/competition/templates";
import { SeasonForm } from "@/components/admin/SeasonForm";
import { db } from "@/db/client";
import { loadCompetitivePlatformCatalog } from "@/lib/competitive/catalog";

export default async function NewSeasonPage() {
  try {
    await requireSuperAdmin();
  } catch {
    redirect("/login");
  }

  const major = createCompetitionTemplate("major");
  const catalog = await loadCompetitivePlatformCatalog(db);

  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl">
      <SeasonForm
        mode="create"
        competitivePlatforms={catalog.map((platform) => ({ key: platform.key, displayName: platform.displayName }))}
        initial={{
          name: "",
          slug: "",
          kind: "Major",
          template: "major",
          status: "draft",
          themeColor: null,
          registrationOpensAt: null,
          registrationClosesAt: null,
          rosterChangeClosesAt: null,
          endAt: null,
          ...major,
        }}
      />
    </div>
  );
}
