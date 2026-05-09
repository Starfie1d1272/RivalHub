import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import { getUserSession } from "@/lib/auth/session";
import { HeaderClient } from "./header-client";

export async function Header() {
  const [allSeasons, session] = await Promise.all([
    db.select().from(seasons),
    getUserSession(),
  ]);

  const publicSeasons = allSeasons.filter(
    (s) => s.status !== "archived" && s.status !== "draft"
  );

  return <HeaderClient seasons={publicSeasons} session={session} />;
}
