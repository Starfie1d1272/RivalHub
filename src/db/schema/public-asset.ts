import { customType } from "drizzle-orm/pg-core";
import { displayPublicAsset } from "@/lib/assets-reference";

/** Reader compatibility for existing URLs and future public object references.
 * Writes remain unchanged until a separately gated publisher release. */
export const publicAsset = customType<{ data: string; driverData: string }>({
  dataType: () => "text",
  fromDriver: displayPublicAsset,
});
