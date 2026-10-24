import "server-only";
import { sql } from "drizzle-orm";
import { matches } from "@/db/schema";

/** SQL counterpart of hasMatchRecording, owned with the post-match material contract. */
export function hasMatchRecordingCondition() {
  return sql`(nullif(${matches.videoUrl}, '') is not null OR jsonb_array_length(${matches.recordings}) > 0)`;
}
