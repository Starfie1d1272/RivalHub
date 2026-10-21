import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertPreviewAuthEnvironment, PREVIEW_PROJECT_REF } from "../../src/lib/runtime/preview.ts";

// Build output contains only public Preview configuration. Runtime credentials
// are provisioned separately on the host and never enter the CI artifact.
const root = process.cwd();
const manifest = JSON.parse(readFileSync("package.json", "utf8"));
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const applicationOrigin = process.env.NEXT_PUBLIC_APP_URL;
const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (process.platform !== "linux" || process.arch !== "x64") throw new Error("Standby package requires Linux x64.");
if (!/^[a-f0-9]{40}$/.test(sourceCommit)) throw new Error("Exact source commit required.");
if (new URL(applicationOrigin).origin !== applicationOrigin || !applicationOrigin.startsWith("https://")) {
  throw new Error("An exact HTTPS Preview application origin is required.");
}
assertPreviewAuthEnvironment({
  VERCEL_ENV: "preview", NEXT_PUBLIC_SUPABASE_URL: `https://${PREVIEW_PROJECT_REF}.supabase.co`,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publicKey,
  SUPABASE_SECRET_KEY: "sb_secret_build_validation_only", ADMIN_SESSION_SECRET: "build-validation-only-not-a-runtime-secret",
});
const releaseTag = `v${manifest.version}-standby.${sourceCommit.slice(0, 12)}`;
// A small allowlist prevents .env files or inherited provider credentials from
// becoming build inputs. Next's loader must not reload a local environment file.
const env = Object.fromEntries(["PATH", "HOME", "TMPDIR", "CI"].filter(key => process.env[key]).map(key => [key, process.env[key]]));
Object.assign(env, {
  NODE_ENV: "production", __NEXT_PROCESSED_ENV: "true", NEXT_TELEMETRY_DISABLED: "1",
  RIVALHUB_STANDALONE: "1", VERCEL_ENV: "preview",
  NEXT_PUBLIC_APP_URL: applicationOrigin,
  NEXT_PUBLIC_SUPABASE_URL: `https://${PREVIEW_PROJECT_REF}.supabase.co`,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publicKey,
  RIVALHUB_RELEASE_TAG: releaseTag, RIVALHUB_RELEASE_COMMIT: sourceCommit,
});
execFileSync("pnpm", ["exec", "next", "build"], { env, stdio: "inherit" });
const bundle = resolve(root, ".next/standalone");
cpSync("public", `${bundle}/public`, { recursive: true });
cpSync(".next/static", `${bundle}/.next/static`, { recursive: true });
for (const path of ["scripts/standby/start.mjs", "src/lib/runtime/preview.ts"]) {
  mkdirSync(resolve(bundle, path, ".."), { recursive: true });
  cpSync(path, resolve(bundle, path));
}
mkdirSync(`${bundle}/runtime`, { recursive: true });
cpSync(process.execPath, `${bundle}/runtime/node`);
// The Node runtime comes from the manifest/lockfile-managed pnpm runtime.
writeFileSync(`${bundle}/standby.json`, JSON.stringify({
  environment: "preview", projectRef: PREVIEW_PROJECT_REF, applicationOrigin,
  publicKey, sourceCommit, releaseTag, nodeVersion: process.version,
}, null, 2) + "\n");
for (const name of [".env", ".env.local", ".env.production", ".env.production.local"]) rmSync(`${bundle}/${name}`, { force: true });
mkdirSync(".agent-tmp/standby-package", { recursive: true });
const archive = `.agent-tmp/standby-package/rivalhub-standby-${sourceCommit}.tar.gz`;
execFileSync("tar", ["-czf", archive, "-C", bundle, "."], { stdio: "inherit" });
const sum = execFileSync("sha256sum", [archive], { encoding: "utf8" }).split(/\s+/)[0];
writeFileSync(`${archive}.sha256`, `${sum}  ${archive.split("/").at(-1)}\n`);
console.log(JSON.stringify({ sourceCommit, releaseTag, environment: "preview", archive, sha256: sum }));
