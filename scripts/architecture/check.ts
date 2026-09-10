import { readdirSync, readFileSync } from "node:fs";
import { extname, join, posix, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"]);
const LOCAL_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"];
const CLIENT_BOUNDARY_PATHS = ["src/db/"];
const SERVER_OWNER_PATHS = [
  "src/lib/auth/supabase-server.ts",
  "src/lib/observability/server.ts",
];

export type ArchitectureRuleId =
  | "ARCH_CLIENT_SERVER"
  | "ARCH_LIB_ENTRYPOINT"
  | "ARCH_CANONICAL_PROVIDER";

export interface ArchitectureViolation {
  ruleId: ArchitectureRuleId;
  file: string;
  target?: string;
  message: string;
}

export interface ArchitectureCheckOptions {
  rootDir?: string;
  /** In-memory source map used by unit tests; keys are repository-relative paths. */
  files?: Record<string, string>;
}

interface SourceRecord {
  path: string;
  source: string;
  ast: ts.SourceFile;
  useClient: boolean;
  useServer: boolean;
  serverOnly: boolean;
  runtimeEdges: ModuleEdge[];
}

interface ModuleEdge {
  specifier: string;
  runtime: boolean;
}

interface ModuleGraph {
  records: Map<string, SourceRecord>;
  violations: ArchitectureViolation[];
}

export function checkArchitecture(options: ArchitectureCheckOptions = {}): ArchitectureViolation[] {
  const records = loadRecords(options);
  const graph: ModuleGraph = { records, violations: [] };
  const seenViolations = new Set<string>();

  const report = (violation: ArchitectureViolation) => {
    const key = `${violation.ruleId}|${violation.file}|${violation.target ?? ""}|${violation.message}`;
    if (!seenViolations.has(key)) {
      seenViolations.add(key);
      graph.violations.push(violation);
    }
  };

  for (const record of records.values()) {
    for (const edge of record.runtimeEdges) {
      checkCanonicalProvider(record, edge.specifier, report);
    }
  }

  const libraryVisited = new Set<string>();
  for (const root of records.values()) {
    if (!root.path.startsWith("src/lib/")) continue;
    traverseLibrary(root, graph, libraryVisited, report);
  }

  const clientVisited = new Set<string>();
  for (const root of records.values()) {
    if (!root.useClient) continue;
    traverseClient(root, graph, clientVisited, report);
  }

  return graph.violations.sort((a, b) =>
    `${a.file}|${a.ruleId}|${a.target ?? ""}`.localeCompare(`${b.file}|${b.ruleId}|${b.target ?? ""}`),
  );
}

export function formatArchitectureViolation(violation: ArchitectureViolation): string {
  const target = violation.target ? ` -> ${violation.target}` : "";
  return `${violation.ruleId} ${violation.file}${target}: ${violation.message}`;
}

function loadRecords(options: ArchitectureCheckOptions): Map<string, SourceRecord> {
  const files = options.files
    ? new Map(Object.entries(options.files).map(([path, source]) => [normalizePath(path), source]))
    : readRepositoryFiles(resolve(options.rootDir ?? process.cwd(), "src"));

  return new Map(
    [...files.entries()]
      .filter(([path]) => path.startsWith("src/") && isSourcePath(path) && !path.endsWith(".d.ts"))
      .filter(([path]) => !path.includes("/test/") && !path.endsWith(".test.ts") && !path.endsWith(".test.tsx"))
      .map(([path, source]) => {
        const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, scriptKind(path));
        const baseRecord = { path, source, ast, useClient: false, useServer: false, serverOnly: false };
        const allEdges = moduleEdges(baseRecord, false);
        const runtimeEdges = allEdges.filter((edge) => edge.runtime);
        return [path, {
          path,
          source,
          ast,
          useClient: hasDirective(ast, "use client"),
          useServer: hasDirective(ast, "use server"),
          serverOnly: runtimeEdges.some((edge) => edge.specifier === "server-only"),
          runtimeEdges,
        } satisfies SourceRecord];
      }),
  );
}

function readRepositoryFiles(sourceDir: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath);
        continue;
      }
      const path = normalizePath(relative(resolve(sourceDir, ".."), absolutePath));
      if (isSourcePath(path)) files.set(path, readFileSync(absolutePath, "utf8"));
    }
  };
  walk(sourceDir);
  return files;
}

function isSourcePath(path: string): boolean {
  return SOURCE_EXTENSIONS.has(extname(path));
}

function scriptKind(path: string): ts.ScriptKind {
  return path.endsWith(".tsx") || path.endsWith(".jsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

function normalizePath(path: string): string {
  return posix.normalize(path.replaceAll("\\", "/")).replace(/^\.\//, "");
}

function hasDirective(ast: ts.SourceFile, directive: string): boolean {
  for (const statement of ast.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) break;
    if (statement.expression.text === directive) return true;
  }
  return false;
}

function moduleEdges(record: Pick<SourceRecord, "ast">, runtimeOnly: boolean): ModuleEdge[] {
  const edges: ModuleEdge[] = [];
  const add = (specifier: string, runtime: boolean) => {
    if (!runtimeOnly || runtime) edges.push({ specifier, runtime });
  };

  for (const statement of record.ast.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      add(statement.moduleSpecifier.text, isRuntimeImport(statement));
    } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
      add(statement.moduleSpecifier.text, isRuntimeExport(statement));
    } else if (ts.isImportEqualsDeclaration(statement) && ts.isExternalModuleReference(statement.moduleReference)) {
      const expression = statement.moduleReference.expression;
      if (expression && ts.isStringLiteral(expression)) add(expression.text, true);
    }
  }

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      const argument = node.arguments[0];
      if (argument && ts.isStringLiteral(argument)) {
        if (expression.kind === ts.SyntaxKind.ImportKeyword) add(argument.text, true);
        if (ts.isIdentifier(expression) && expression.text === "require") add(argument.text, true);
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(record.ast, visit);
  return dedupeEdges(edges);
}

function isRuntimeImport(statement: ts.ImportDeclaration): boolean {
  const clause = statement.importClause;
  if (!clause) return true;
  if (clause.isTypeOnly) return false;
  if (clause.name || clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) return true;
  return clause.namedBindings
    ? clause.namedBindings.elements.some((element) => !element.isTypeOnly)
    : true;
}

function isRuntimeExport(statement: ts.ExportDeclaration): boolean {
  if (statement.isTypeOnly) return false;
  if (!statement.exportClause || !ts.isNamedExports(statement.exportClause)) return true;
  return statement.exportClause.elements.some((element) => !element.isTypeOnly);
}

function dedupeEdges(edges: ModuleEdge[]): ModuleEdge[] {
  const seen = new Set<string>();
  return edges.filter((edge) => {
    const key = `${edge.specifier}|${edge.runtime}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function checkCanonicalProvider(
  record: SourceRecord,
  specifier: string,
  report: (violation: ArchitectureViolation) => void,
) {
  const owner = specifier === "brackets-manager"
    ? record.path.startsWith("src/lib/bracket/")
    : specifier === "@supabase/supabase-js"
      ? record.path === "src/lib/auth/supabase.ts" || record.path === "src/lib/auth/supabase-server.ts"
      : true;
  if (owner) return;

  if (specifier === "brackets-manager") {
    report({
      ruleId: "ARCH_CANONICAL_PROVIDER",
      file: record.path,
      target: specifier,
      message: "brackets-manager 只能由 src/lib/bracket/ adapter 持有；调用方应依赖 canonical bracket owner。",
    });
  } else if (specifier === "@supabase/supabase-js") {
    report({
      ruleId: "ARCH_CANONICAL_PROVIDER",
      file: record.path,
      target: specifier,
      message: "Supabase SDK 只能由 browser/server auth owner 持有；调用方应依赖显式 auth adapter。",
    });
  }
}

function traverseLibrary(
  record: SourceRecord,
  graph: ModuleGraph,
  visited: Set<string>,
  report: (violation: ArchitectureViolation) => void,
) {
  if (visited.has(record.path)) return;
  visited.add(record.path);

  for (const edge of record.runtimeEdges) {
    const target = resolveLocalModule(record.path, edge.specifier, graph.records);
    if (!target) continue;
    if (target.path.startsWith("src/actions/") || target.path.startsWith("src/app/") || target.path.startsWith("src/components/")) {
      report({
        ruleId: "ARCH_LIB_ENTRYPOINT",
        file: record.path,
        target: target.path,
        message: "src/lib/ canonical domain/library code 不能依赖 action、app 或 component entrypoint；让 entrypoint 调用 lib owner。",
      });
    }
    traverseLibrary(target, graph, visited, report);
  }
}

function traverseClient(
  record: SourceRecord,
  graph: ModuleGraph,
  visited: Set<string>,
  report: (violation: ArchitectureViolation) => void,
) {
  if (visited.has(record.path)) return;
  visited.add(record.path);

  for (const edge of record.runtimeEdges) {
    const target = resolveLocalModule(record.path, edge.specifier, graph.records);
    if (!target) continue;
    if (target.useServer) continue;
    if (isClientForbiddenTarget(target)) {
      report({
        ruleId: "ARCH_CLIENT_SERVER",
        file: record.path,
        target: target.path,
        message: "use client graph 不能到达 server-only、数据库、secret/provider 或 observability server facade；通过 use server action 返回显式 DTO。",
      });
      continue;
    }
    traverseClient(target, graph, visited, report);
  }
}

function isClientForbiddenTarget(record: SourceRecord): boolean {
  return record.serverOnly
    || CLIENT_BOUNDARY_PATHS.some((prefix) => record.path.startsWith(prefix))
    || SERVER_OWNER_PATHS.includes(record.path);
}

function resolveLocalModule(
  importer: string,
  specifier: string,
  records: Map<string, SourceRecord>,
): SourceRecord | undefined {
  let base: string | undefined;
  if (specifier.startsWith("@/")) {
    base = `src/${specifier.slice(2)}`;
  } else if (specifier.startsWith(".")) {
    base = normalizePath(posix.join(posix.dirname(importer), specifier));
  }
  if (!base) return undefined;

  for (const candidate of moduleCandidates(normalizePath(base))) {
    const record = records.get(candidate);
    if (record) return record;
  }
  return undefined;
}

function moduleCandidates(base: string): string[] {
  const candidates = [base];
  if (!extname(base)) {
    for (const extension of LOCAL_EXTENSIONS) candidates.push(`${base}${extension}`);
    for (const extension of LOCAL_EXTENSIONS) candidates.push(`${base}/index${extension}`);
  }
  return candidates;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const violations = checkArchitecture();
  if (violations.length > 0) {
    console.error(`Architecture contract failed with ${violations.length} violation(s):`);
    for (const violation of violations) console.error(formatArchitectureViolation(violation));
    process.exitCode = 1;
  } else {
    console.log("Architecture contract passed.");
  }
}
