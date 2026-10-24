import "server-only";
import { requireSuperAdmin } from "@/lib/auth/session";
import { DashboardData } from "./dashboard-contract";
import { parseDashboardFilters, type DashboardFilters } from "./dashboard-query";

export type DashboardResult = { status: "ready"; data: DashboardData } | { status: "unconfigured" | "unavailable" };
const cache = new Map<string, { expires: number; data: DashboardData }>();

export async function getTelemetryDashboard(input: DashboardFilters): Promise<DashboardResult> {
  await requireSuperAdmin();
  const filters = parseDashboardFilters(input);
  if (!filters) throw new Error("Invalid telemetry filters");
  const key = JSON.stringify(filters);
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return { status: "ready", data: hit.data };
  const secret = process.env.PRODUCT_TELEMETRY_ADMIN_KEY;
  if (!secret || secret.length < 32 || !process.env.PRODUCT_TELEMETRY_ENDPOINT) return { status: "unconfigured" };
  try {
    const endpoint = new URL(process.env.PRODUCT_TELEMETRY_ENDPOINT);
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== "/v1/batches") return { status: "unconfigured" };
    endpoint.pathname = "/admin/dashboard";
    endpoint.search = new URLSearchParams({ ...filters }).toString();
    const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${secret}` }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5000) });
    if (!response.ok) return { status: "unavailable" };
    const reader = response.body?.getReader();
    if (!reader) return { status: "unavailable" };
    const chunks: Uint8Array[] = []; let bytes = 0;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 1024 * 1024) { await reader.cancel(); return { status: "unavailable" }; }
      chunks.push(chunk.value);
    }
    const data = DashboardData.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    if (cache.size >= 12) cache.delete(cache.keys().next().value!);
    cache.set(key, { expires: Math.min(Date.now() + 60000, data.validUntil), data });
    return { status: "ready", data };
  } catch { return { status: "unavailable" }; }
}
