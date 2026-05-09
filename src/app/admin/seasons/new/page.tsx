import { redirect } from "next/navigation";
import { requireSuperAdmin } from "@/lib/auth/session";
import { RIVALS_REGISTRATION_CONFIG, RIVALS_STAGE_PLAN } from "@/types/season";
import { SeasonForm } from "@/components/admin/SeasonForm";

export default async function NewSeasonPage() {
  try {
    await requireSuperAdmin();
  } catch {
    redirect("/admin/login");
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl">
      <SeasonForm
        mode="create"
        initial={{
          name: "",
          slug: "",
          kind: "选秀联赛",
          status: "draft",
          themeColor: "#f97316",
          startAt: null,
          endAt: null,
          registrationMode: "solo",
          hasCaptainVoting: true,
          hasDraft: true,
          teamSize: 7,
          starterCount: 5,
          positions: ["igl", "awper", "opener", "closer", "anchor"],
          stagePlan: RIVALS_STAGE_PLAN,
          registrationConfig: RIVALS_REGISTRATION_CONFIG,
        }}
      />
    </div>
  );
}
