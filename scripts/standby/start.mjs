import { existsSync, readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { assertPreviewAuthEnvironment, assertPreviewDatabaseUrl, PREVIEW_PROJECT_REF } from "../../src/lib/runtime/preview.ts";

export function assertStandbyEnvironment(manifest, env = process.env) {
  if (manifest.environment !== "preview" || manifest.projectRef !== PREVIEW_PROJECT_REF || env.VERCEL_ENV !== "preview") {
    throw new Error("This standby package only runs against Preview.");
  }
  assertPreviewDatabaseUrl(env.DATABASE_URL ?? "", env);
  assertPreviewAuthEnvironment(env);
  if (env.NEXT_PUBLIC_APP_URL !== manifest.applicationOrigin || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY !== manifest.publicKey) {
    throw new Error("Runtime public configuration differs from the packaged Preview configuration; rebuild required.");
  }
  if (!env.SUPABASE_JWT_SECRET || env.SUPABASE_JWT_SECRET === "[SENSITIVE]") {
    throw new Error("Preview Realtime signing credential required.");
  }
  if (env.HOSTNAME !== "127.0.0.1" || env.PORT !== "3031") throw new Error("Standby must use its loopback listener.");
}

if (process.argv[1] && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const manifest = JSON.parse(readFileSync(resolve(root, "standby.json"), "utf8"));
  assertStandbyEnvironment(manifest);
  process.chdir(root);
  await import(new URL("../../server.js", import.meta.url));
}
