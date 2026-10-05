import { createSecureContext } from "node:tls";
import { SUPABASE_DATABASE_CA } from "./supabase-ca";

/** Node-only owner shared by runtime, protected tooling and CLI trust setup. */
export function postgresConnection(databaseUrl: string, ca = SUPABASE_DATABASE_CA) {
  const url = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error("Unsupported PostgreSQL protocol.");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  const mode = url.searchParams.get("sslmode");
  if (mode && !(local ? ["disable", "verify-full", "require"] : ["verify-full", "require"]).includes(mode)) {
    throw new Error("PostgreSQL SSL mode conflicts with the canonical TLS contract.");
  }
  for (const key of ["ssl", "sslcert", "sslkey", "sslrootcert", "sslpassword", "uselibpqcompat", "sslnegotiation"]) {
    if (url.searchParams.has(key)) throw new Error("PostgreSQL URL cannot override canonical TLS configuration.");
  }
  // node-postgres parses URL SSL parameters after explicit options; remove the
  // accepted compatibility mode so it cannot replace CA/hostname verification.
  url.searchParams.delete("sslmode");
  if (local) return { connectionString: url.toString(), ssl: false as const };
  if (!/^(?:aws-[0-9]+-[a-z0-9-]+\.pooler|db\.[a-z0-9]+)\.supabase\.(?:com|co)$/.test(url.hostname)) {
    throw new Error("Remote PostgreSQL endpoint is outside the hosted Supabase contract.");
  }
  if (!ca.trim()) throw new Error("Supabase PostgreSQL CA is required.");
  createSecureContext({ ca });
  return {
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: true as const, ca, servername: url.hostname, minVersion: "TLSv1.2" as const },
  };
}
