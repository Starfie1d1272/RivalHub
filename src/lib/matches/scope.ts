import "server-only";
import { isNull } from "drizzle-orm";
import { matches } from "@/db/schema";

/** Discovery, aggregate statistics and tournament policies exclude rehearsal facts. */
export function officialMatchCondition() {
  return isNull(matches.testConfig);
}
