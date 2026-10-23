import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { publicConfiguration, configurationHash } from "./production-config.mjs";
import { verifyExactShaCiPrerequisite } from "../release/ci-prerequisite.ts";
import { RELEASE_TAG_PATTERN } from "../../src/lib/release/identity.ts";
import { PRODUCTION_PROJECT_REF } from "../db/production-environment.ts";

// Operator tooling and immutable application source have separate identities.
const tooling = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const root = resolve(process.argv[2] ?? "");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const releaseTag = process.env.RELEASE_TAG;
if (process.platform !== "linux" || process.arch !== "x64") throw new Error("Linux x64 builder required.");
if (!RELEASE_TAG_PATTERN.test(releaseTag ?? "")) throw new Error("Immutable release tag required.");
const sourceCommit = git("rev-parse", "HEAD");
if (git("rev-parse", `${releaseTag}^{commit}`) !== sourceCommit || git("status", "--porcelain")) throw new Error("Clean exact-release checkout required.");
git("merge-base", "--is-ancestor", sourceCommit, "origin/main");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
if (`v${pkg.version}` !== releaseTag) throw new Error("Package version differs from release tag.");
const config = publicConfiguration(JSON.parse(process.env.RIVALHUB_PRODUCTION_PUBLIC_CONFIGURATION ?? "{}"));
const evidence = await verifyExactShaCiPrerequisite({
  repository: process.env.GITHUB_REPOSITORY, releaseSha: sourceCommit, releaseTag,
  githubToken: process.env.GITHUB_TOKEN, pollIntervalMs: 60_000, pollTimeoutMs: 120_000,
});
const operatorCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: tooling, encoding: "utf8" }).trim();
if (execFileSync("git", ["status", "--porcelain"], { cwd: tooling, encoding: "utf8" }).trim()) throw new Error("Clean committed operator tooling required.");
const env = Object.fromEntries(["PATH", "HOME", "TMPDIR", "CI"].filter(key => process.env[key]).map(key => [key, process.env[key]]));
Object.assign(env, config, {
  NODE_ENV: "production", __NEXT_PROCESSED_ENV: "true", NEXT_TELEMETRY_DISABLED: "1",
  RIVALHUB_STANDALONE: "1", VERCEL_ENV: "production",
  RIVALHUB_RELEASE_TAG: releaseTag, RIVALHUB_RELEASE_COMMIT: sourceCommit,
});
execFileSync("pnpm", ["exec", "tsx", "scripts/vercel-build.ts"], { cwd: root, env, stdio: "inherit" });
const bundle = resolve(root, ".next/standalone");
cpSync(resolve(root, "public"), `${bundle}/public`, { recursive: true });
cpSync(resolve(root, ".next/static"), `${bundle}/.next/static`, { recursive: true });
for (const path of ["scripts/standby/start-production.mjs", "scripts/standby/production-config.mjs",
  "scripts/db/production-environment.ts", "scripts/db/remote-environment.ts", "src/lib/release/identity.ts"]) {
  const destination = resolve(bundle, path);
  mkdirSync(dirname(destination), { recursive: true });
  // Node's native TS loader requires explicit extensions; retain canonical guard logic.
  const source = readFileSync(resolve(tooling, path), "utf8").replace('from "./remote-environment"', 'from "./remote-environment.ts"');
  writeFileSync(destination, source);
}
mkdirSync(`${bundle}/runtime`, { recursive: true });
cpSync(process.execPath, `${bundle}/runtime/node`);
const manifest = {
  environment: "production", projectRef: PRODUCTION_PROJECT_REF, sourceCommit, releaseTag,
  operatorCommit, publicConfiguration: config, configurationSha256: configurationHash(config),
  nodeVersion: process.version, platform: process.platform, architecture: process.arch,
  ciRunId: evidence.runId,
};
writeFileSync(`${bundle}/standby.json`, JSON.stringify(manifest, null, 2) + "\n");
for (const name of [".env", ".env.local", ".env.production", ".env.production.local"]) rmSync(`${bundle}/${name}`, { force: true });
const out = resolve(tooling, ".agent-tmp/standby-production-package");
mkdirSync(out, { recursive: true });
const name = `rivalhub-production-${sourceCommit}-${manifest.configurationSha256.slice(0, 12)}`;
const archive = `${out}/${name}.tar.gz`;
execFileSync("tar", ["-czf", archive, "-C", bundle, "."], { stdio: "inherit" });
const sha256 = createHash("sha256").update(readFileSync(archive)).digest("hex");
writeFileSync(`${archive}.sha256`, `${sha256}  ${name}.tar.gz\n`);
writeFileSync(`${out}/${name}.json`, JSON.stringify({ ...manifest, sha256 }, null, 2) + "\n");
console.log(JSON.stringify({ sourceCommit, releaseTag, operatorCommit, sha256, configurationSha256: manifest.configurationSha256 }));
