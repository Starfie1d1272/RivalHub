import { readFileSync } from "node:fs";
import type { ArchitectureViolation } from "./check";

// These are implementation owners, not a universal ordering. Workflows can
// compose commands across owners under their documented transaction contract.
const ownerDirectories = {
  identity: "identity auth competitive discipline education",
  definition: "seasons competition",
  participation: "captains competition-entries draft event-rosters participants qualification registration registrations teams",
  tournament: "bracket competition-qualification formats major swiss",
  match: "match-rosters matches",
  statistics: "demo-evidence demo-integration stats",
  mizar: "mizar",
  spectator: "bet free-predictions predictions",
  workflow: "admin match-corrections postevent postmatch",
  support: "announcements audit cache community-awards config data db feedback home integrations my observability ocr players presence preview production recruitment release runtime scheduler season-public-info service-health telemetry utils validators",
};

type Owner = keyof typeof ownerDirectories;

const ownersByDirectory = new Map(
  (Object.keys(ownerDirectories) as Owner[]).flatMap(owner =>
    ownerDirectories[owner].split(" ").map(directory => [directory, owner] as const),
  ),
);

const allowedDependencies: Readonly<Record<Owner, readonly Owner[]>> = {
  identity: [],
  definition: ["identity"],
  participation: ["identity", "definition"],
  tournament: ["identity", "definition", "participation", "match"],
  match: ["identity", "definition", "participation", "tournament"],
  statistics: ["identity", "definition", "participation", "tournament", "match"],
  mizar: ["identity", "definition", "participation", "tournament", "match", "statistics", "spectator"],
  spectator: ["identity", "definition", "participation", "tournament", "match"],
  workflow: ["identity", "definition", "participation", "tournament", "match", "statistics", "mizar", "spectator"],
  // Support includes product read models and infrastructure adapters. Concrete
  // module cycles through them are still checked.
  support: ["identity", "definition", "participation", "tournament", "match", "statistics", "mizar", "spectator", "workflow"],
};

const workflowModules = new Set([
  "src/lib/identity/merge.ts",
  "src/lib/competitive/conversion-policy-admin.ts",
  "src/lib/registration/review-entry.ts",
]);

const valueContracts = new Set([
  "src/lib/assets-reference.ts",
  "src/lib/bracket/storage-contract.ts",
  "src/lib/competition-qualification/eligibility-contract.ts",
  "src/lib/config/cs2-positions.ts",
  "src/lib/formats/supported.ts",
  "src/lib/mizar/lineup-display.ts",
  "src/lib/seasons/compatibility.ts",
]);

const schemaValueContracts = new Set([
  "src/lib/assets-reference.ts",
  "src/lib/config/cs2-positions.ts",
]);

type GovernedRule = "ARCH_DOMAIN_DEPENDENCY" | "ARCH_RUNTIME_CYCLE";

interface Exception {
  rule: GovernedRule;
  owner: string;
  reason: string;
  exit: string;
  edges: [string, string][];
}

export interface DomainModule {
  serverOnly: boolean;
  edges: { target: string; kind: "runtime" | "type" | "proxy" }[];
  externalRuntime: string[];
}

export interface DomainReport {
  typeOnlyEdges: number;
  serverEdges: number;
  sharedRuntimeEdges: number;
  actionProxyEdges: number;
  schemaValueEdges: number;
  crossDomainEdges: Record<string, number>;
  domainComponents: string[][];
  moduleComponents: string[][];
  exceptions: number;
}

function ownerOf(path: string): Owner | undefined {
  if (workflowModules.has(path)) return "workflow";
  const [directory, file] = path.slice("src/lib/".length).split("/");
  if (!path.startsWith("src/lib/")) return;
  if (!file) return "support";
  return ownersByDirectory.get(directory!);
}

/** Tarjan's strongly connected components over resolved runtime edges. */
function cyclicComponents(graph: ReadonlyMap<string, ReadonlySet<string>>): string[][] {
  const stack: string[] = [];
  const onStack = new Set<string>();
  const indices = new Map<string, number>();
  const low = new Map<string, number>();
  const components: string[][] = [];
  const visit = (node: string): void => {
    const index = indices.size;
    indices.set(node, index);
    low.set(node, index);
    stack.push(node);
    onStack.add(node);
    for (const target of graph.get(node) ?? []) {
      if (!indices.has(target)) {
        visit(target);
        low.set(node, Math.min(low.get(node)!, low.get(target)!));
      } else if (onStack.has(target)) {
        low.set(node, Math.min(low.get(node)!, indices.get(target)!));
      }
    }
    if (low.get(node) !== index) return;
    const component: string[] = [];
    let member: string;
    do {
      member = stack.pop()!;
      onStack.delete(member);
      component.push(member);
    } while (member !== node);
    if (component.length > 1 || graph.get(node)?.has(node)) components.push(component.sort());
  };
  for (const node of graph.keys()) if (!indices.has(node)) visit(node);
  return components.sort((a, b) => a[0]!.localeCompare(b[0]!));
}

function exceptionKey(rule: string, file: string, target: string) {
  return JSON.stringify([rule, file, target]);
}

export function checkDomainDependencies(
  modules: ReadonlyMap<string, DomainModule>,
  report: (violation: ArchitectureViolation) => void,
  useExceptions: boolean,
): DomainReport {
  const exceptions = new Map<string, ArchitectureViolation>();
  if (useExceptions) {
    const groups: Exception[] = JSON.parse(readFileSync(new URL("./domain-exceptions.json", import.meta.url), "utf8"));
    for (const { rule, owner, reason, exit, edges } of groups) {
      if (!["ARCH_DOMAIN_DEPENDENCY", "ARCH_RUNTIME_CYCLE"].includes(rule)
        || !owner.trim() || !reason.trim() || !exit.trim() || edges.length === 0) {
        throw new Error("Each domain exception group needs a supported rule, owner, reason, exit and exact edges.");
      }
      for (const [file, target] of edges) {
        const key = exceptionKey(rule, file, target);
        if (exceptions.has(key)) throw new Error(`Duplicate architecture exception: ${key}`);
        exceptions.set(key, {
          ruleId: "ARCH_STALE_EXCEPTION", file, target, message: `移除已失效的 ${rule} 例外（${owner}）。`,
        });
      }
    }
  }
  const exceptionCount = exceptions.size;
  const reportUnlessApproved = (ruleId: GovernedRule, file: string, target: string, message: string) => {
    if (!exceptions.delete(exceptionKey(ruleId, file, target))) report({ ruleId, file, target, message });
  };

  const runtimeGraph = new Map<string, Set<string>>();
  const ownerGraph = new Map<Owner, Set<Owner>>();
  const counts = new Map<string, number>();
  let typeOnlyEdges = 0;
  let serverEdges = 0;
  let sharedRuntimeEdges = 0;
  let actionProxyEdges = 0;
  let schemaValueEdges = 0;
  for (const [file, module] of modules) {
    const from = ownerOf(file);
    if (file.startsWith("src/lib/") && !from) {
      report({ ruleId: "ARCH_UNKNOWN_MODULE", file, message: "新领域目录必须声明依赖 owner。" });
    }
    if (valueContracts.has(file)) {
      for (const target of module.externalRuntime) {
        report({ ruleId: "ARCH_SCHEMA_CONTRACT", file, target, message: "共享值契约不能引入外部运行时实现。" });
      }
    }
    const targets = new Set(module.edges.filter(edge => edge.kind === "runtime").map(edge => edge.target));
    runtimeGraph.set(file, targets);
    typeOnlyEdges += new Set(module.edges.filter(edge => edge.kind === "type" && !targets.has(edge.target))
      .map(edge => edge.target)).size;
    actionProxyEdges += new Set(module.edges.filter(edge => edge.kind === "proxy").map(edge => edge.target)).size;
    for (const target of targets) {
      if (module.serverOnly || modules.get(target)?.serverOnly) serverEdges++;
      else sharedRuntimeEdges++;
      if (file.startsWith("src/db/schema/") && target.startsWith("src/lib/")) {
        if (schemaValueContracts.has(target)) schemaValueEdges++;
        else report({ ruleId: "ARCH_SCHEMA_CONTRACT", file, target, message: "Schema 运行时只依赖已声明的值契约。" });
      }
      if (valueContracts.has(file) && !valueContracts.has(target)) {
        report({ ruleId: "ARCH_SCHEMA_CONTRACT", file, target, message: "共享值契约不能引入运行时实现。" });
      }
      if (!from || valueContracts.has(target)) continue;
      const to = ownerOf(target);
      if (!to || from === to) continue;
      const direction = `${from} -> ${to}`;
      counts.set(direction, (counts.get(direction) ?? 0) + 1);
      const owners = ownerGraph.get(from) ?? new Set<Owner>();
      owners.add(to);
      ownerGraph.set(from, owners);
      if (to !== "support" && !allowedDependencies[from].includes(to)) {
        reportUnlessApproved("ARCH_DOMAIN_DEPENDENCY", file, target, `依赖 ${direction} 超出 owner 允许范围。`);
      }
    }
  }

  const moduleComponents = cyclicComponents(runtimeGraph);
  for (const component of moduleComponents) {
    const members = new Set(component);
    for (const file of component) {
      for (const target of runtimeGraph.get(file) ?? []) {
        if (members.has(target)) {
          reportUnlessApproved("ARCH_RUNTIME_CYCLE", file, target, "运行时模块依赖形成循环。");
        }
      }
    }
  }
  for (const stale of exceptions.values()) report(stale);
  return {
    typeOnlyEdges,
    serverEdges,
    sharedRuntimeEdges,
    actionProxyEdges,
    schemaValueEdges,
    crossDomainEdges: Object.fromEntries([...counts].sort(([a], [b]) => a.localeCompare(b))),
    domainComponents: cyclicComponents(ownerGraph),
    moduleComponents,
    exceptions: exceptionCount,
  };
}
