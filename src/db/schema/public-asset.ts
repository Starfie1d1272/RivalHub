import { customType } from "drizzle-orm/pg-core";
import { displayPublicAsset, storePublicAsset } from "@/lib/assets-reference";

/** URL-shaped read adapter for public identities and opaque external URLs. */
export const publicAsset = customType<{ data: string; driverData: string }>({
  dataType: () => "text",
  fromDriver: displayPublicAsset,
  toDriver: storePublicAsset,
});
