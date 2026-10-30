import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, vi } from "vitest";
import { digestDbTraffic } from "@/lib/observability/db-traffic-contract";

const slot = Symbol.for("rivalhub.db-traffic.v3");
const host = process as unknown as Record<symbol, unknown>;
export async function trafficFixture() {
  const directory = await mkdtemp(join(tmpdir(), "traffic-integration-"));
  const previous = process.env.DB_TRAFFIC_SPOOL_DIRECTORY;
  process.env.DB_TRAFFIC_SPOOL_DIRECTORY = directory; delete host[slot];
  return async () => {
    if (host[slot]) await vi.waitFor(() => expect((host[slot] as { sending: boolean }).sending).toBe(false));
    delete host[slot];
    if (previous === undefined) delete process.env.DB_TRAFFIC_SPOOL_DIRECTORY; else process.env.DB_TRAFFIC_SPOOL_DIRECTORY = previous;
    await rm(directory, { recursive: true, force: true });
  };
}
export async function trafficAck(body: string): Promise<Response> {
  const batch = JSON.parse(body) as { id: string };
  return Response.json({ protocol: 2, id: batch.id, digest: await digestDbTraffic(batch), status: "accepted" });
}
