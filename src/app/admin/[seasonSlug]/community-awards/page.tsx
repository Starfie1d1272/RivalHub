import { redirect } from "next/navigation";

export default async function AdminCommunityAwardsPage({ params }: { params: Promise<{ seasonSlug: string }> }) {
  const { seasonSlug } = await params;
  redirect(`/${seasonSlug}/community-awards`);
}
