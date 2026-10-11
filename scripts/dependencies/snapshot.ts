import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildDependencyGraph, verifySbom } from "./graph";

export function createSnapshot(lockfile: string, options: { sha: string; ref: string; jobId: string; scanned: string; runUrl?: string }) {
  if (!/^[a-f0-9]{40}$/.test(options.sha) || !options.ref.startsWith("refs/")) throw new Error("Snapshot requires exact commit SHA and full ref");
  const graph = buildDependencyGraph(lockfile);
  return {
    version: 0,
    sha: options.sha,
    ref: options.ref,
    job: { id: options.jobId, correlator: options.ref === "refs/heads/main" ? "rivalhub-pnpm-lockfile" : `rivalhub-pnpm-lockfile-${options.ref}`, ...(options.runUrl ? { html_url: options.runUrl } : {}) },
    detector: { name: "rivalhub-pnpm-lockfile", version: "1.0.0", url: "https://github.com/Starfie1d1272/RivalHub/tree/main/scripts/dependencies" },
    scanned: options.scanned,
    metadata: { lockfile_documents: graph.documentCount, lockfile_snapshots: graph.snapshotCount },
    manifests: { "pnpm-lock.yaml": { name: "pnpm-lock.yaml", file: { source_location: "pnpm-lock.yaml" }, resolved: graph.resolved } },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [command, outputPath, lockPath = "pnpm-lock.yaml"] = process.argv.slice(2);
  if (!outputPath) throw new Error("Usage: snapshot.ts generate <snapshot.json> [lockfile] | verify-sbom <sbom.json> [lockfile]");
  const source = readFileSync(lockPath, "utf8");
  if (command === "generate") {
    const sha = process.env.GITHUB_SHA ?? execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const ref = process.env.GITHUB_REF ?? `refs/heads/${execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim()}`;
    const snapshot = createSnapshot(source, { sha, ref, jobId: process.env.GITHUB_RUN_ID ?? "local", scanned: new Date().toISOString(),
      runUrl: process.env.GITHUB_RUN_ID ? `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : undefined });
    writeFileSync(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`);
    const rows = Object.values(snapshot.manifests["pnpm-lock.yaml"].resolved);
    console.log(JSON.stringify({ sha, ref, documents: snapshot.metadata.lockfile_documents, packages: rows.length,
      edges: rows.reduce((sum, row) => sum + row.dependencies.length, 0), direct: rows.filter(row => row.relationship === "direct").length,
      runtime: rows.filter(row => row.scope === "runtime").length }));
  } else if (command === "verify-sbom") {
    const { sbom } = JSON.parse(readFileSync(outputPath, "utf8"));
    console.log(JSON.stringify(verifySbom(buildDependencyGraph(source), sbom)));
  } else throw new Error(`Unknown command: ${command}`);
}
