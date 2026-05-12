import { redirect } from "next/navigation";
import { requireSuperAdmin } from "@/lib/auth/session";
import { RIVALS_REGISTRATION_CONFIG, MAJOR_STAGE_PLAN, CS2_POSITIONS } from "@/types/season";
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
          kind: "Major",
          status: "draft",
          themeColor: "#f97316",
          startAt: null,
          registrationDeadline: null,
          endAt: null,
          registrationMode: "team",
          hasCaptainVoting: false,
          hasDraft: false,
          maxTeamSize: 9,
          minTeamSize: 5,
          starterCount: 5,
          positions: CS2_POSITIONS,
          stagePlan: MAJOR_STAGE_PLAN,
          registrationConfig: RIVALS_REGISTRATION_CONFIG,
        }}
      />
    </div>
  );
}
