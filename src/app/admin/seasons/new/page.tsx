import { redirect } from "next/navigation";
import { requireSuperAdmin } from "@/lib/auth/session";
import { createMajorDefaultCapabilities } from "@/types/season";
import { SeasonForm } from "@/components/admin/SeasonForm";

export default async function NewSeasonPage() {
  try {
    await requireSuperAdmin();
  } catch {
    redirect("/admin/login");
  }

  const major = createMajorDefaultCapabilities();

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
          ...major,
        }}
      />
    </div>
  );
}
