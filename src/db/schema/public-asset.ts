import { customType } from "drizzle-orm/pg-core";
import { displayPublicAsset, storePublicAsset } from "@/lib/assets-reference";

/** Legacy URL-shaped API fields are materialized at the persistence adapter boundary.
 * PostgreSQL retains the object identity, including in copied entrant snapshots. */
export const publicAsset = customType<{ data: string; driverData: string }>({
  dataType: () => "text",
  fromDriver: displayPublicAsset,
  toDriver: storePublicAsset,
});
