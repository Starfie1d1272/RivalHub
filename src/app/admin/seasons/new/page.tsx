import { requireSuperAdmin } from "@/lib/auth/session";
import { resolveAdminPageAccess } from "@/lib/auth/admin-access";
import { createCompetitionTemplate } from "@/lib/competition/templates";
import { SeasonForm } from "@/components/admin/SeasonForm";
import { AdminAccessDenied } from "@/components/admin/AdminAccessDenied";
import { db } from "@/db/client";
import { loadCompetitivePlatformCatalog } from "@/lib/competitive/catalog";

export default async function NewSeasonPage() {
  if (!(await resolveAdminPageAccess(requireSuperAdmin))) return <AdminAccessDenied />;

  const major = createCompetitionTemplate("major");
  const catalog = await loadCompetitivePlatformCatalog(db);

  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl">
      <SeasonForm
        mode="create"
        competitivePlatforms={catalog.map((platform) => ({ key: platform.key, displayName: platform.displayName, seasons: platform.seasons.map((season) => ({ seasonKey: season.seasonKey, label: season.label, active: season.active })), ranks: platform.ranks.map((rank) => ({ rankKey: rank.rankKey, label: rank.label })) }))}
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
