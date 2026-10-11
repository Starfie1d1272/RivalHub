import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { buildDependencyGraph, verifySbom } from "../../scripts/dependencies/graph";
import { createSnapshot } from "../../scripts/dependencies/snapshot";

const document = {
  lockfileVersion: "9.0",
  importers: { ".": { dependencies: { app: { version: "1.0.0(peer@2.0.0)" } }, devDependencies: { tooling: { version: "1.0.0" }, alias: { version: "@scope/real@3.0.0" } } } },
  packages: { "app@1.0.0": {}, "peer@2.0.0": {}, "tooling@1.0.0": {}, "child@4.0.0": {}, "@scope/real@3.0.0": {} },
  snapshots: { "app@1.0.0(peer@2.0.0)": { dependencies: { peer: "2.0.0", child: "4.0.0" } },
    "peer@2.0.0": {}, "tooling@1.0.0": { optionalDependencies: { child: "4.0.0" } }, "child@4.0.0": {}, "@scope/real@3.0.0": {} },
};
const bootstrap = { lockfileVersion: "9.0", importers: { ".": { packageManagerDependencies: { pnpm: { version: "12.9.1" } } } }, packages: { "pnpm@12.9.1": {} }, snapshots: { "pnpm@12.9.1": {} } };
const source = `---\n${stringify(bootstrap)}---\n${stringify(document)}`;

describe("canonical pnpm dependency graph", () => {
  it("CLI binds PR artifacts to explicit source variables despite GitHub's reserved merge identity", () => {
    const directory = mkdtempSync(join(tmpdir(), "rivalhub-graph-cli-"));
    try {
      const lock = join(directory, "lock.yaml");
      const output = join(directory, "snapshot.json");
      writeFileSync(lock, source);
      execFileSync(process.execPath, ["--import", "tsx", "scripts/dependencies/snapshot.ts", "generate", output, lock], {
        env: { ...process.env, GITHUB_SHA: "b".repeat(40), GITHUB_REF: "refs/pull/1/merge", RIVALHUB_DEPENDENCY_SHA: "a".repeat(40), RIVALHUB_DEPENDENCY_REF: "refs/pull/1/head" },
        stdio: "pipe",
      });
      expect(JSON.parse(readFileSync(output, "utf8"))).toMatchObject({ sha: "a".repeat(40), ref: "refs/pull/1/head" });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it("includes both documents, actual alias identity, resolved peers, optional edges and runtime precedence", () => {
    const graph = buildDependencyGraph(source);
    expect(graph.documentCount).toBe(2);
    expect(Object.keys(graph.resolved)).toHaveLength(6);
    expect(graph.resolved["pkg:npm/app@1.0.0"]).toEqual({ package_url: "pkg:npm/app@1.0.0", relationship: "direct", scope: "runtime", dependencies: ["pkg:npm/child@4.0.0", "pkg:npm/peer@2.0.0"] });
    expect(graph.resolved["pkg:npm/child@4.0.0"]).toMatchObject({ relationship: "indirect", scope: "runtime" });
    expect(graph.resolved["pkg:npm/tooling@1.0.0"]).toMatchObject({ scope: "development", dependencies: ["pkg:npm/child@4.0.0"] });
    expect(graph.resolved["pkg:npm/%40scope/real@3.0.0"]).toMatchObject({ relationship: "direct", scope: "development" });
    expect(graph.resolved["pkg:npm/pnpm@12.9.1"]).toMatchObject({ scope: "development" });
  });
  it("unions differing peer contexts without dropping their child versions and terminates cycles", () => {
    const extra = structuredClone(document);
    Object.assign(extra.importers, { second: { dependencies: { app: { version: "1.0.0(peer@5.0.0)" } } } });
    Object.assign(extra.packages, { "peer@5.0.0": {} });
    Object.assign(extra.snapshots, { "app@1.0.0(peer@5.0.0)": { dependencies: { peer: "5.0.0" } }, "peer@5.0.0": { dependencies: { app: "1.0.0(peer@5.0.0)" } } });
    expect(buildDependencyGraph(stringify(extra)).resolved["pkg:npm/app@1.0.0"]!.dependencies).toEqual(["pkg:npm/child@4.0.0", "pkg:npm/peer@2.0.0", "pkg:npm/peer@5.0.0"]);
  });
  it.each(["", "lockfileVersion: '10.0'", source.replace("peer: 2.0.0", "peer: 9.9.9"), "a: 1\na: 2"])("fails closed on unsupported, malformed or unresolved lockfiles", input => {
    expect(() => buildDependencyGraph(input)).toThrow();
  });
  it("checks every SBOM package and edge, accepting equivalent scoped purl encoding", () => {
    const graph = buildDependencyGraph(source);
    const packages = Object.keys(graph.resolved).map((purl, index) => ({ SPDXID: String(index), externalRefs: [{ referenceType: "purl", referenceLocator: decodeURIComponent(purl) }] }));
    const ids = new Map(packages.map(row => [row.externalRefs[0]!.referenceLocator, row.SPDXID]));
    const relationships = Object.values(graph.resolved).flatMap(row => row.dependencies.map(child => ({ spdxElementId: ids.get(decodeURIComponent(row.package_url))!, relatedSpdxElement: ids.get(decodeURIComponent(child))!, relationshipType: "DEPENDS_ON" })));
    relationships.push({ spdxElementId: "document", relatedSpdxElement: "repository", relationshipType: "DESCRIBES" });
    for (const row of Object.values(graph.resolved).filter(row => row.relationship === "direct")) {
      relationships.push({ spdxElementId: "repository", relatedSpdxElement: ids.get(decodeURIComponent(row.package_url))!, relationshipType: "DEPENDS_ON" });
    }
    expect(verifySbom(graph, { packages, relationships })).toEqual({ packages: 6, edges: 3, directRoots: 4 });
    expect(() => verifySbom(graph, { packages: packages.slice(1), relationships })).toThrow("mismatch");
    expect(() => verifySbom(graph, { packages, relationships: [] })).toThrow("edges");
    expect(() => verifySbom(graph, { packages, relationships: relationships.filter(row => row.spdxElementId !== "repository") })).toThrow("missing direct-root");
    expect(() => verifySbom(graph, { packages, relationships: [...relationships, { spdxElementId: "repository", relatedSpdxElement: ids.get("pkg:npm/child@4.0.0")!, relationshipType: "DEPENDS_ON" }] })).toThrow("indirect classified as direct-root");
  });
  it("builds the repository lock graph with production, dev, transitive and aliased packages", () => {
    const graph = buildDependencyGraph(readFileSync("pnpm-lock.yaml", "utf8"));
    expect(graph.documentCount).toBe(2);
    expect(Object.keys(graph.resolved).length).toBeGreaterThan(900);
    const rows = Object.values(graph.resolved);
    expect(rows.find(row => row.package_url.startsWith("pkg:npm/next@"))).toMatchObject({ relationship: "direct", scope: "runtime" });
    expect(rows.find(row => row.package_url.startsWith("pkg:npm/vitest@"))).toMatchObject({ relationship: "direct", scope: "development" });
    expect(rows.some(row => row.package_url.startsWith("pkg:npm/%40typescript/typescript6@"))).toBe(true);
    expect(rows.find(row => row.package_url.startsWith("pkg:npm/react-dom@"))!.dependencies.some(purl => purl.startsWith("pkg:npm/react@"))).toBe(true);
    expect(rows.some(row => row.package_url.startsWith("pkg:generic/node@"))).toBe(true);
  });
  it("binds snapshots to exact source identity and stable detector/correlator", () => {
    const snapshot = createSnapshot(source, { sha: "a".repeat(40), ref: "refs/heads/main", jobId: "42", scanned: "2026-10-11T00:00:00Z" });
    expect(snapshot.sha).toBe("a".repeat(40));
    expect(snapshot.job.correlator).toBe("rivalhub-pnpm-lockfile");
    expect(createSnapshot(source, { sha: "a".repeat(40), ref: "refs/pull/1/head", jobId: "42", scanned: "2026-10-11T00:00:00Z" }).job.correlator).toBe("rivalhub-pnpm-lockfile-refs/pull/1/head");
    expect(() => createSnapshot(source, { sha: "main", ref: "main", jobId: "42", scanned: "now" })).toThrow();
  });
});
