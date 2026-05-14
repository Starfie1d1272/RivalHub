import { db } from "@/db/client";
import { seasons, users } from "@/db/schema";
import { getUserSession } from "@/lib/auth/session";
import { HeaderClient } from "./header-client";
import { eq } from "drizzle-orm";

export async function Header() {
  const [allSeasons, session] = await Promise.all([
    db.select().from(seasons),
    getUserSession(),
  ]);

  const publicSeasons = allSeasons.filter(
    (s) => s.status !== "archived" && s.status !== "draft"
  );

  const currentUser = session
    ? await db.query.users.findFirst({
        where: eq(users.id, session.userId),
        columns: { avatarUrl: true, steamName: true },
      })
    : null;

  return <HeaderClient seasons={publicSeasons} session={session} avatarUrl={currentUser?.avatarUrl ?? null} steamName={currentUser?.steamName ?? null} />;
}
