import "server-only";
import { accountKey, signTicket } from "./ticket";
import type { Bootstrap, Ticket } from "./protocol";

/** Called inside the existing Header request island; no endpoint, auth query or runtime cache added. */
export async function telemetryBootstrap(viewer: { userId: string; isAdmin: boolean; isSuperAdmin: boolean } | null): Promise<Bootstrap | null> {
  try {
    if (process.env.PRODUCT_TELEMETRY_ENABLED !== "1") return null;
    const secret = process.env.PRODUCT_TELEMETRY_SIGNING_KEY ?? "";
    const identitySecret = process.env.PRODUCT_TELEMETRY_ACCOUNT_KEY ?? "";
    const endpoint = new URL(process.env.PRODUCT_TELEMETRY_ENDPOINT ?? "");
    const origin = new URL(process.env.PRODUCT_TELEMETRY_ORIGIN ?? "").origin;
    const environment = process.env.VERCEL_ENV;
    if (secret.length < 32 || identitySecret.length < 32 || endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || !["preview", "production"].includes(environment ?? "")) return null;
    const release = process.env.RIVALHUB_RELEASE_COMMIT || process.env.VERCEL_GIT_COMMIT_SHA || "unknown";
    if (!/^[A-Za-z0-9._-]{1,80}$/.test(release)) return null;
    const ticket: Ticket = {
      v: 1, id: crypto.randomUUID(), account: viewer ? await accountKey(viewer.userId, identitySecret) : null,
      role: viewer?.isSuperAdmin ? "super_admin" : viewer?.isAdmin ? "season_admin" : viewer ? "user" : "anonymous",
      release, environment: environment as Ticket["environment"], origin, exp: Date.now() + 86400000,
    };
    return { endpoint: endpoint.href, ticket: await signTicket(ticket, secret), identity: ticket.account ?? "anonymous", expiresAt: ticket.exp };
  } catch { return null; }
}
