import { parseAllDocuments } from "yaml";

interface LockedDependency { version: string }
interface Importer {
  dependencies?: Record<string, LockedDependency>;
  optionalDependencies?: Record<string, LockedDependency>;
  devDependencies?: Record<string, LockedDependency>;
  packageManagerDependencies?: Record<string, LockedDependency>;
  configDependencies?: Record<string, LockedDependency>;
}
interface LockDocument {
  lockfileVersion: string;
  importers: Record<string, Importer>;
  packages: Record<string, unknown>;
  snapshots: Record<string, { dependencies?: Record<string, string>; optionalDependencies?: Record<string, string> }>;
}
export interface ResolvedDependency {
  package_url: string;
  relationship: "direct" | "indirect";
  scope: "runtime" | "development";
  dependencies: string[];
}
export interface DependencyGraph {
  resolved: Record<string, ResolvedDependency>;
  documentCount: number;
  snapshotCount: number;
}

/** Strip peer/patch context only for package identity, never when resolving edges. */
function packageIdentity(key: string): { base: string; purl: string } {
  const base = key.split("(")[0]!;
  const separator = base.lastIndexOf("@");
  const name = base.slice(0, separator);
  const reference = base.slice(separator + 1);
  const runtime = reference.startsWith("runtime:");
  const version = runtime ? reference.slice("runtime:".length) : reference;
  if (separator <= 0 || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version)) {
    throw new Error(`Unsupported npm lock identity: ${key}`);
  }
  return { base, purl: `pkg:${runtime ? "generic" : "npm"}/${name.split("/").map(encodeURIComponent).join("/")}@${encodeURIComponent(version)}` };
}

export function buildDependencyGraph(source: string): DependencyGraph {
  const parsed = parseAllDocuments(source);
  const resolved: DependencyGraph["resolved"] = {};
  let snapshotCount = 0;
  if (!parsed.length) throw new Error("Empty lockfile");
  for (const parsedDocument of parsed) {
    if (parsedDocument.errors.length) throw new Error(parsedDocument.errors.map(error => error.message).join("; "));
    const value = parsedDocument.toJS() as LockDocument | null;
    if (!value || value.lockfileVersion !== "9.0" || !value.importers || !value.packages || !value.snapshots) {
      throw new Error("Unsupported or incomplete pnpm lock document");
    }
    const document = value;
    snapshotCount += Object.keys(document.snapshots).length;
    function resolveKey(name: string, reference: string): string {
      // Aliases carry the actual npm name; normal references carry only a version.
      const key = Object.hasOwn(document.snapshots, `${name}@${reference}`) ? `${name}@${reference}` : reference.replace(/^npm:/, "");
      if (!Object.hasOwn(document.snapshots, key)) throw new Error(`Unresolved locked dependency: ${name}@${reference}`);
      return key;
    }
    const visited = new Set<string>();
    function visit(key: string, scope: ResolvedDependency["scope"], direct: boolean): string {
      const { base, purl } = packageIdentity(key);
      if (!Object.hasOwn(document.packages, base)) throw new Error(`Missing locked package metadata: ${base}`);
      const row = resolved[purl] ??= { package_url: purl, relationship: "indirect", scope, dependencies: [] };
      if (direct) row.relationship = "direct";
      if (scope === "runtime") row.scope = "runtime";
      const visitKey = `${scope}:${key}`;
      if (visited.has(visitKey)) return purl;
      visited.add(visitKey);
      const snapshot = document!.snapshots[key]!;
      for (const [name, reference] of Object.entries({ ...snapshot.dependencies, ...snapshot.optionalDependencies })) {
        const child = visit(resolveKey(name, reference), scope, false);
        if (!row.dependencies.includes(child)) row.dependencies.push(child);
      }
      return purl;
    }
    for (const importer of Object.values(document.importers)) {
      for (const category of ["dependencies", "optionalDependencies", "devDependencies", "packageManagerDependencies", "configDependencies"] as const) {
        const scope = category === "dependencies" || category === "optionalDependencies" ? "runtime" : "development";
        for (const [name, dependency] of Object.entries(importer[category] ?? {})) {
          visit(resolveKey(name, dependency.version), scope, true);
        }
      }
    }
  }
  if (!Object.keys(resolved).length) throw new Error("Lockfile resolved no dependencies");
  const sorted = Object.fromEntries(Object.entries(resolved).sort(([left], [right]) => left.localeCompare(right)));
  for (const dependency of Object.values(sorted)) dependency.dependencies.sort();
  return { resolved: sorted, documentCount: parsed.length, snapshotCount };
}

interface Sbom {
  packages: { SPDXID: string; externalRefs?: { referenceType: string; referenceLocator: string }[] }[];
  relationships: { spdxElementId: string; relatedSpdxElement: string; relationshipType: string }[];
}

/** SBOM must contain all identities and all submitted package edges, not merely return HTTP 200. */
export function verifySbom(graph: DependencyGraph, sbom: Sbom): { packages: number; edges: number; directRoots: number } {
  const identity = (value: string) => decodeURIComponent(value).replace(/^pkg:\/npm\//, "pkg:npm/");
  const ids = new Map<string, string>();
  for (const entry of sbom.packages) {
    const purl = entry.externalRefs?.find(ref => ref.referenceType === "purl")?.referenceLocator;
    if (purl) ids.set(entry.SPDXID, identity(purl));
  }
  const available = new Set(ids.values());
  const edges = new Set(sbom.relationships.filter(row => row.relationshipType === "DEPENDS_ON")
    .map(row => `${ids.get(row.spdxElementId)}\n${ids.get(row.relatedSpdxElement)}`));
  const roots = new Set(sbom.relationships.filter(row => row.relationshipType === "DESCRIBES").map(row => row.relatedSpdxElement));
  const direct = new Set(sbom.relationships.filter(row => row.relationshipType === "DEPENDS_ON" && roots.has(row.spdxElementId))
    .map(row => ids.get(row.relatedSpdxElement)).filter((purl): purl is string => purl !== undefined));
  const missing: string[] = [];
  let edgeCount = 0;
  let directRoots = 0;
  for (const row of Object.values(graph.resolved)) {
    if (!available.has(identity(row.package_url))) missing.push(row.package_url);
    if (row.relationship === "direct") {
      directRoots++;
      if (!direct.has(identity(row.package_url))) missing.push(`missing direct-root: ${row.package_url}`);
    } else if (direct.has(identity(row.package_url))) {
      missing.push(`indirect classified as direct-root: ${row.package_url}`);
    }
    for (const child of row.dependencies) {
      edgeCount++;
      if (!edges.has(`${identity(row.package_url)}\n${identity(child)}`)) missing.push(`${row.package_url} -> ${child}`);
    }
  }
  if (missing.length) throw new Error(`SBOM read-back mismatch in ${missing.length} identities/edges/roots; examples: ${missing.slice(0, 8).join(", ")}`);
  return { packages: Object.keys(graph.resolved).length, edges: edgeCount, directRoots };
}
