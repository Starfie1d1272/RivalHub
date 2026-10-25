// Separate application process used only against a disposable loopback worker DB.
import { assertLocalDatabaseUrl } from "../../../../scripts/db/local-environment";
import { ingestMizarReliable } from "@/lib/mizar/reliable";

assertLocalDatabaseUrl(process.env.DATABASE_URL, "DATABASE_URL");
process.once("message", async (input: { installationId: string; seasonId: string; event: unknown; revision: number }) => {
  try {
    const receipt = await ingestMizarReliable(input.installationId, input.seasonId, input.event, input.revision);
    // Test control channel, not an HTTP response. Parent kills before delivery to the producer.
    process.send?.({ receipt });
  } catch (error) {
    process.send?.({ failed: error instanceof Error ? error.name : "UnknownError" });
  }
});
