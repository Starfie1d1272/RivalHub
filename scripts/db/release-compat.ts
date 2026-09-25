import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { basename } from "node:path";
import {
  changedMigrationFiles,
  classifyMigrationSql,
  extractMigrationContractOwners,
  type MigrationContractOwner,
  type MigrationRiskFinding,
} from "./migration-risk";
import { PREVIEW_SCHEMA_LIFECYCLE } from "./preview/policy";
import {
  PREVIOUS_RELEASE_COMMIT_ENV,
  PREVIOUS_RELEASE_TAG_ENV,
  REQUIRE_EXPLICIT_PREVIOUS_RELEASE_ENV,
  resolveConfiguredPreviousProductionIdentity,
  type ReleaseEnvironment,
} from "../release/production-identity";

const SHIPPED_SOURCE_ROOTS = [
  "src/db/schema",
  "src/actions",
  "src/lib",
  "src/app",
  "src/components",
  "scripts",
] as const;

const STABLE_TAG_PATTERN = /^v(\d+)\.(\d+)\.(\d+)$/;
const DEFAULT_PRODUCTION_STABLE_REF = "origin/main";

export interface ReleaseTagResolution {
  ref: string;
  commit: string;
}

export interface SourceEvidence {
  path: string;
  line: number;
  reason: string;
}

export interface CompatibilityFinding {
  finding: MigrationRiskFinding;
  owners: MigrationContractOwner[];
  evidence: SourceEvidence[];
  status: "pass" | "fail" | "not-applicable";
  message?: string;
}

export interface ReleaseCompatibilityResult {
  previousRelease: ReleaseTagResolution;
  changedMigrationFiles: string[];
  findings: CompatibilityFinding[];
  failures: string[];
}

interface ShippedSource {
  path: string;
  content: string;
  searchableContent: string;
}

interface TableDeclaration {
  path: string;
  symbol: string;
  relation: string;
  start: number;
  bodyStart: number;
  bodyEnd: number;
  content: string;
  searchableContent: string;
}

interface EnumDeclaration {
  path: string;
  symbol: string;
  name: string;
  content: string;
  start: number;
}

export function checkReleaseCompatibility(cwd = process.cwd()): ReleaseCompatibilityResult {
  const head = process.env.RIVALHUB_MIGRATION_HEAD_SHA?.trim() || "HEAD";
  const previousRelease = resolvePreviousProductionRelease(cwd, head);
  const files = changedMigrationFiles(cwd, previousRelease.commit);
  const findings = files.flatMap((filePath) => {
    const absolutePath = resolve(cwd, filePath);
    return classifyMigrationSql(readFileSync(absolutePath, "utf8"), filePath, { includeStatementText: true });
  });

  const sources = findings.some((finding) => finding.category === "drop" || finding.category === "rename")
    ? readShippedSources(cwd, previousRelease.commit)
    : [];
  const checks = findings.map((finding) => evaluateFinding(finding, sources));
  const failures = checks
    .filter((check) => check.status === "fail")
    .map((check) => check.message ?? formatFinding(check.finding));

  return {
    previousRelease,
    changedMigrationFiles: files,
    findings: checks,
    failures,
  };
}

export function resolvePreviousProductionRelease(cwd = process.cwd(), head = "HEAD"): ReleaseTagResolution {
  const configuredExplicit = resolveConfiguredPreviousProductionIdentity(cwd, process.env, head);
  if (configuredExplicit) return { ref: configuredExplicit.releaseTag, commit: configuredExplicit.releaseCommit };
  if (requiresExplicitPreviousRelease(process.env)) {
    throw new Error(`${PREVIOUS_RELEASE_TAG_ENV} 与 ${PREVIOUS_RELEASE_COMMIT_ENV} 缺失；生产发布禁止回退到 Git 推导的稳定 tag。`);
  }

  return resolveGitDerivedPreviousStableRelease(cwd, head);
}

/** Git 推导的回退路径仅供开发环境/持续集成使用；生产发布必须先冻结身份标识。 */
export function resolveGitDerivedPreviousStableRelease(cwd = process.cwd(), head = "HEAD"): ReleaseTagResolution {
  const headCommit = resolveGitRevision(cwd, head, "RIVALHUB_MIGRATION_HEAD_SHA");

  const configuredProductionRef = process.env.RIVALHUB_PRODUCTION_STABLE_REF;
  const productionRef = configuredProductionRef === undefined
    ? DEFAULT_PRODUCTION_STABLE_REF
    : configuredProductionRef.trim();
  const productionCommit = resolveGitRevision(cwd, productionRef, "RIVALHUB_PRODUCTION_STABLE_REF");
  const candidateVersion = stableTagsAtCommit(cwd, headCommit)[0]?.version;
  const stableTags = stableTagsMergedInto(cwd, productionCommit);

  for (const candidate of stableTags) {
    if (candidateVersion && compareStableVersions(candidate.version, candidateVersion) >= 0) continue;
    const commit = resolveStableTag(cwd, candidate.tag, "稳定版本 tag");
    if (commit === headCommit) continue;
    return { ref: candidate.tag, commit };
  }

  throw new Error(
    `无法从开发环境/持续集成的生产稳定引用 ${productionRef} 解析上一生产版本；需要提交链中早于候选版本的 vX.Y.Z tag，并会忽略预发布 tag。`,
  );
}

function requiresExplicitPreviousRelease(env: ReleaseEnvironment): boolean {
  return env[REQUIRE_EXPLICIT_PREVIOUS_RELEASE_ENV] === "1" || env[REQUIRE_EXPLICIT_PREVIOUS_RELEASE_ENV] === "true";
}

function stableTagsMergedInto(
  cwd: string,
  productionCommit: string,
): Array<{ tag: string; version: [number, number, number] }> {
  return stableTagsFromGitOutput(git(cwd, ["tag", "--merged", productionCommit, "--list", "v*"]));
}

function stableTagsAtCommit(
  cwd: string,
  commit: string,
): Array<{ tag: string; version: [number, number, number] }> {
  return stableTagsFromGitOutput(git(cwd, ["tag", "--points-at", commit, "--list", "v*"]));
}

function stableTagsFromGitOutput(
  output: string,
): Array<{ tag: string; version: [number, number, number] }> {
  return output
    .split(/\r?\n/)
    .map((tag) => tag.trim())
    .filter((tag) => STABLE_TAG_PATTERN.test(tag))
    .map((tag) => ({ tag, version: parseStableTag(tag) }))
    .filter((candidate): candidate is { tag: string; version: [number, number, number] } => Boolean(candidate.version))
    .sort((left, right) => compareStableVersions(right.version, left.version));
}

function resolveStableTag(cwd: string, tag: string, label: string): string {
  return resolveGitRevision(cwd, `refs/tags/${tag}`, label);
}

function evaluateFinding(finding: MigrationRiskFinding, sources: readonly ShippedSource[]): CompatibilityFinding {
  if (finding.category === "alter-type" || finding.category === "set-not-null") {
    return {
      finding,
      owners: [],
      evidence: [],
      status: "fail",
      message: `${formatFinding(finding)} 直接拒绝继续：${finding.category} 无法仅凭上一生产版本源代码证明 N/N+1 兼容；请改写为 Expand → Switch → Contract 迁移。迁移注解不能绕过此门槛。`,
    };
  }

  if (finding.category !== "drop" && finding.category !== "rename") {
    return { finding, owners: [], evidence: [], status: "not-applicable" };
  }

  const owners = extractMigrationContractOwners(finding);
  if (owners.length === 0) {
    return {
      finding,
      owners,
      evidence: [],
      status: "fail",
      message: `${formatFinding(finding)} 无法安全解析待收缩的关系/列/类型归属方；拒绝猜测，请明确拆分为可验证的 Expand → Switch → Contract 迁移。`,
    };
  }

  const evidence = owners.flatMap((owner) => findOwnerEvidence(sources, owner, finding));
  const unsupportedSchema = owners.find((owner) => owner.schema && owner.schema !== "public");
  if (unsupportedSchema && evidence.length === 0) {
    return {
      finding,
      owners,
      evidence,
      status: "fail",
      message: `${formatFinding(finding)} 无法安全证明非 public schema 归属方 ${unsupportedSchema.displayName} 已停止被上一生产版本使用；拒绝猜测，请提供 Expand → Switch → Contract 迁移。`,
    };
  }
  if (evidence.length > 0) {
    const evidenceText = evidence.map((item) => `${item.path}:${item.line} (${item.reason})`).join(", ");
    return {
      finding,
      owners,
      evidence,
      status: "fail",
      message: `${formatFinding(finding)} 上一生产版本仍依赖 ${owners.map((owner) => owner.displayName).join(", ")}：${evidenceText}。迁移注解只声明清理意图，不能替代兼容性证明；请将收缩操作延后到下一次发布。`,
    };
  }

  return {
    finding,
    owners,
    evidence,
    status: "pass",
    message: `${formatFinding(finding)} 上一生产版本源代码未发现 ${owners.map((owner) => owner.displayName).join(", ")} 的数据库收缩依赖。`,
  };
}

function readShippedSources(cwd: string, revision: string): ShippedSource[] {
  const paths = git(cwd, ["ls-tree", "-r", "--name-only", revision, "--", ...SHIPPED_SOURCE_ROOTS])
    .split(/\r?\n/)
    .map((path) => path.trim())
    .filter(Boolean);

  return paths.map((path) => {
    const content = git(cwd, ["show", `${revision}:${path}`]);
    return { path, content, searchableContent: maskSourceComments(content) };
  });
}

function isLegacyShadowColumn(owner: MigrationContractOwner, finding?: MigrationRiskFinding): boolean {
  if (!finding || owner.kind !== "column" || !owner.relation) return false;
  const migrationTag = basename(finding.filePath, ".sql");
  const lifecycleEntry = PREVIEW_SCHEMA_LIFECYCLE.find(
    (entry) => "columns" in entry && entry.table === owner.relation,
  );
  if (!lifecycleEntry || !("columns" in lifecycleEntry) || !lifecycleEntry.columns) return false;
  return lifecycleEntry.columns.some(
    (col) => col.name === owner.identifier && col.removedAt === migrationTag && col.compatibility === "legacy-shadow",
  );
}

function findOwnerEvidence(
  sources: readonly ShippedSource[],
  owner: MigrationContractOwner,
  finding?: MigrationRiskFinding,
): SourceEvidence[] {
  const tableDeclarations = sources.flatMap((source) => collectTableDeclarations(source));
  const enumDeclarations = sources.flatMap((source) => collectEnumDeclarations(source));
  const evidence: SourceEvidence[] = [];
  const isLegacyShadow = isLegacyShadowColumn(owner, finding);

  for (const source of sources) {
    if (owner.kind === "relation") {
      for (const declaration of tableDeclarations) {
        if (
          matchesRelation(declaration, owner)
          && declaration.path === source.path
          && tableDeclarationHasShippedConsumer(declaration, sources)
        ) {
          addEvidence(evidence, {
            path: source.path,
            line: lineNumberAt(source.content, declaration.start),
            reason: `Drizzle pgTable(${owner.identifier}) 声明及已发布代码调用`,
          });
        }
      }
      addRegexEvidence(
        evidence,
        source,
        sqlRelationReferencePattern(owner.identifier, owner.schema),
        "SQL 关系引用",
      );
      for (const declaration of tableDeclarations.filter((item) => matchesRelation(item, owner))) {
        addRegexEvidence(
          evidence,
          source,
          tableUsagePattern(tableSymbolsForSource(declaration, source)),
          "Drizzle 表调用",
        );
      }
    }

    if (owner.kind === "column") {
      for (const declaration of tableDeclarations.filter((item) => matchesRelation(item, owner))) {
        const columnMatches = columnMappingMatches(declaration, owner.identifier);
        if (declaration.path === source.path) {
          for (const match of columnMatches) {
            addEvidence(evidence, {
              path: source.path,
              line: lineNumberAt(source.content, match),
              reason: `Drizzle ${owner.relation}.${owner.identifier} 列映射`,
            });
          }
        }
        const symbols = tableSymbolsForSource(declaration, source);
        const propertyNames = ownerPropertyNames(owner.identifier);
        const hasColumnMapping = columnMatches.length > 0;
        if (!isLegacyShadow || hasColumnMapping) {
          for (const propertyName of propertyNames) {
            addRegexEvidence(
              evidence,
              source,
              propertyAccessPattern(symbols, propertyName),
              `Drizzle ${owner.relation}.${propertyName} 调用`,
            );
          }
        }
        if (hasColumnMapping && symbols.length > 0 && tableUsagePattern(symbols).test(source.searchableContent)) {
          addRegexEvidence(
            evidence,
            source,
            objectPropertyPattern(propertyNames),
            `${owner.relation} 调用中的数据库对象属性`,
          );
        }
      }
      if (!isLegacyShadow) {
        addRegexEvidence(
          evidence,
          source,
          qualifiedColumnReferencePattern(owner),
          "限定 SQL 列引用",
        );
        addUnqualifiedSqlColumnEvidence(evidence, source, owner, tableDeclarations);
      }
    }

    if (owner.kind === "type") {
      for (const declaration of enumDeclarations) {
        if (sameIdentifier(declaration.name, owner.identifier) && declaration.path === source.path) {
          addEvidence(evidence, {
            path: source.path,
            line: lineNumberAt(source.content, declaration.start),
            reason: `Drizzle pgEnum(${owner.identifier}) 声明`,
          });
        }
      }
      addRegexEvidence(
        evidence,
        source,
        sqlTypeReferencePattern(owner.identifier, owner.schema),
        "SQL 类型引用",
      );
      for (const declaration of enumDeclarations.filter((item) => sameIdentifier(item.name, owner.identifier))) {
        addRegexEvidence(
          evidence,
          source,
          new RegExp(`\\b${escapeRegExp(declaration.symbol)}\\b`, "g"),
          "Drizzle 枚举调用",
        );
      }
    }
  }

  return dedupeEvidence(evidence);
}

function tableDeclarationHasShippedConsumer(
  declaration: TableDeclaration,
  sources: readonly ShippedSource[],
): boolean {
  // 仅作为 N/N+1 兼容外壳保留的关系声明本身不是已发布代码调用。
  // 但其他已发布源代码中的导入、别名或其他引用仍是依赖，必须阻止 DROP。
  return sources.some((source) => {
    if (source.path === declaration.path) return false;
    const symbolPattern = new RegExp(`\\b${escapeRegExp(declaration.symbol)}\\b`);
    return symbolPattern.test(source.searchableContent);
  });
}

function collectTableDeclarations(source: ShippedSource): TableDeclaration[] {
  const declarations: TableDeclaration[] = [];
  const pattern = /\b(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*pgTable\s*\(\s*(["'`])([^"'`]+)\2\s*,/g;
  for (const match of source.searchableContent.matchAll(pattern)) {
    const matchIndex = match.index ?? 0;
    const openBrace = source.content.indexOf("{", matchIndex + match[0].length);
    const closeBrace = openBrace >= 0 ? findMatchingBrace(source.content, openBrace) : -1;
    if (openBrace < 0 || closeBrace < 0) continue;
    declarations.push({
      path: source.path,
      symbol: match[1] ?? "",
      relation: normalizeSourceIdentifier(match[3] ?? ""),
      start: matchIndex,
      bodyStart: openBrace + 1,
      bodyEnd: closeBrace,
      content: source.content,
      searchableContent: source.searchableContent,
    });
  }
  return declarations;
}

function collectEnumDeclarations(source: ShippedSource): EnumDeclaration[] {
  const declarations: EnumDeclaration[] = [];
  const pattern = /\b(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*pgEnum\s*\(\s*(["'`])([^"'`]+)\2\s*,/g;
  for (const match of source.searchableContent.matchAll(pattern)) {
    declarations.push({
      path: source.path,
      symbol: match[1] ?? "",
      name: normalizeSourceIdentifier(match[3] ?? ""),
      content: source.content,
      start: match.index ?? 0,
    });
  }
  return declarations;
}

function columnMappingMatches(declaration: TableDeclaration, identifier: string): number[] {
  const body = declaration.searchableContent.slice(declaration.bodyStart, declaration.bodyEnd);
  const properties = ownerPropertyNames(identifier)
    .map((property) => `(?:"${escapeRegExp(property)}"|${escapeRegExp(property)})`)
    .join("|");
  const literal = escapeRegExp(identifier);
  const pattern = new RegExp(
    "(?:^|[\\n,])\\s*(?:" + properties + ")\\s*:\\s*[^,}]*[\"'`]" + literal + "[\"'`]",
    "g",
  );
  return [...body.matchAll(pattern)].map((match) => declaration.bodyStart + (match.index ?? 0));
}

function matchesRelation(declaration: TableDeclaration, owner: MigrationContractOwner): boolean {
  const relation = owner.kind === "relation" ? owner.identifier : owner.relation;
  return Boolean(relation && sameIdentifier(relation, declaration.relation)) && (!owner.schema || owner.schema === "public");
}

function tableSymbolsForSource(declaration: TableDeclaration, source: ShippedSource): string[] {
  const symbols = new Set<string>();
  const symbol = declaration.symbol;
  if (source.path === declaration.path || new RegExp(`\\b${escapeRegExp(symbol)}\\b`).test(source.searchableContent)) symbols.add(symbol);
  const aliasPattern = new RegExp(`\\b${escapeRegExp(symbol)}\\s+as\\s+([A-Za-z_$][\\w$]*)`, "g");
  for (const match of source.searchableContent.matchAll(aliasPattern)) {
    if (match[1]) symbols.add(match[1]);
  }
  return [...symbols];
}

function tableUsagePattern(symbols: readonly string[]): RegExp {
  if (symbols.length === 0) return /(?!)/g;
  const names = symbols.map(escapeRegExp).join("|");
  return new RegExp(
    `(?:\\b(?:${names})\\s*\\.(?!\\$infer(?:Select|Insert)\\b)|\\.(?:from|insert|update|delete)\\s*\\(\\s*(?:${names})\\b|\\b(?:db|tx)\\s*\\.\\s*query\\s*\\.\\s*(?:${names})\\b)`,
    "g",
  );
}

function propertyAccessPattern(symbols: readonly string[], propertyName: string): RegExp {
  if (symbols.length === 0) return /(?!)/g;
  return new RegExp(`\\b(?:${symbols.map(escapeRegExp).join("|")})\\s*\\.\\s*${escapeRegExp(propertyName)}\\b`, "g");
}

function objectPropertyPattern(propertyNames: readonly string[]): RegExp {
  return new RegExp(`\\b(?:${propertyNames.map(escapeRegExp).join("|")})\\s*:`, "g");
}

function sqlRelationReferencePattern(identifier: string, schema?: string): RegExp {
  return new RegExp(
    `\\b(?:from|join|update|into|references|truncate(?:\\s+table)?|delete\\s+from)\\s+(?:only\\s+)?${sqlNamePattern(identifier, schema)}(?![A-Za-z0-9_$])`,
    "gi",
  );
}

function qualifiedColumnReferencePattern(owner: MigrationContractOwner): RegExp {
  const relation = owner.relation ?? owner.identifier;
  return new RegExp(
    `${sqlNamePattern(relation, owner.schema)}\\s*\\.\\s*${sqlIdentifierPattern(owner.identifier)}(?![A-Za-z0-9_$])`,
    "gi",
  );
}

function sqlTypeReferencePattern(identifier: string, schema?: string): RegExp {
  return new RegExp(`::\\s*${sqlNamePattern(identifier, schema)}(?![A-Za-z0-9_$])`, "gi");
}

function addUnqualifiedSqlColumnEvidence(
  evidence: SourceEvidence[],
  source: ShippedSource,
  owner: MigrationContractOwner,
  declarations: readonly TableDeclaration[],
): void {
  const matchingDeclarations = declarations.filter((declaration) => matchesRelation(declaration, owner));
  const relationContext = sqlRelationReferencePattern(owner.relation ?? "", owner.schema).test(source.searchableContent)
    || matchingDeclarations.some((declaration) => tableUsagePattern(tableSymbolsForSource(declaration, source)).test(source.searchableContent));
  if (!relationContext) return;

  const pattern = new RegExp(sqlIdentifierPattern(owner.identifier), "gi");
  for (const match of source.searchableContent.matchAll(pattern)) {
    const index = match.index ?? 0;
    const window = source.content.slice(Math.max(0, index - 400), Math.min(source.content.length, index + 400));
    if (/(?:select|where|set|values|returning|order\s+by|group\s+by|insert|update|delete|from)/i.test(window)) {
      addEvidence(evidence, {
        path: source.path,
        line: lineNumberAt(source.content, index),
        reason: `关系上下文中的 SQL 列 ${owner.relation}.${owner.identifier}`,
      });
    }
  }
}

function addRegexEvidence(
  evidence: SourceEvidence[],
  source: ShippedSource,
  pattern: RegExp,
  reason: string,
): void {
  pattern.lastIndex = 0;
  for (const match of source.searchableContent.matchAll(pattern)) {
    addEvidence(evidence, {
      path: source.path,
      line: lineNumberAt(source.content, match.index ?? 0),
      reason,
    });
  }
}

function addEvidence(evidence: SourceEvidence[], item: SourceEvidence): void {
  if (!evidence.some((existing) => existing.path === item.path && existing.line === item.line && existing.reason === item.reason)) {
    evidence.push(item);
  }
}

function dedupeEvidence(evidence: readonly SourceEvidence[]): SourceEvidence[] {
  const unique = new Map<string, SourceEvidence>();
  for (const item of evidence) unique.set(`${item.path}:${item.line}:${item.reason}`, item);
  return [...unique.values()];
}

function findMatchingBrace(source: string, openBrace: number): number {
  let depth = 0;
  let quote: "single" | "double" | "template" | "line-comment" | "block-comment" | null = null;
  for (let index = openBrace; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (quote === "line-comment") {
      if (char === "\n") quote = null;
      continue;
    }
    if (quote === "block-comment") {
      if (char === "*" && next === "/") {
        quote = null;
        index += 1;
      }
      continue;
    }
    if (quote === "single" || quote === "double" || quote === "template") {
      if (char === "\\") {
        index += 1;
      } else if ((quote === "single" && char === "'") || (quote === "double" && char === '"') || (quote === "template" && char === "`")) {
        quote = null;
      }
      continue;
    }
    if (char === "/" && next === "/") {
      quote = "line-comment";
      index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      quote = "block-comment";
      index += 1;
      continue;
    }
    if (char === "'") {
      quote = "single";
      continue;
    }
    if (char === '"') {
      quote = "double";
      continue;
    }
    if (char === "`") {
      quote = "template";
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function maskSourceComments(source: string): string {
  const chars = source.split("");
  let state: "single" | "double" | "template" | "line-comment" | "block-comment" | null = null;
  const blank = (index: number): void => {
    if (chars[index] !== "\n" && chars[index] !== "\r") chars[index] = " ";
  };

  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index];
    const next = chars[index + 1];
    if (state === "line-comment") {
      blank(index);
      if (char === "\n") state = null;
      continue;
    }
    if (state === "block-comment") {
      blank(index);
      if (char === "*" && next === "/") {
        blank(index + 1);
        state = null;
        index += 1;
      }
      continue;
    }
    if (state === "single" || state === "double" || state === "template") {
      if (char === "\\") index += 1;
      else if ((state === "single" && char === "'") || (state === "double" && char === '"') || (state === "template" && char === "`")) state = null;
      continue;
    }
    if (char === "/" && next === "/") {
      blank(index);
      blank(index + 1);
      state = "line-comment";
      index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      blank(index);
      blank(index + 1);
      state = "block-comment";
      index += 1;
      continue;
    }
    if (char === "'") state = "single";
    else if (char === '"') state = "double";
    else if (char === "`") state = "template";
  }
  return chars.join("");
}

function ownerPropertyNames(identifier: string): string[] {
  const camel = identifier.replace(/_([a-z0-9])/gi, (_match, character: string) => character.toUpperCase());
  return [...new Set([identifier, camel])];
}

function sqlNamePattern(identifier: string, schema?: string): string {
  const relation = sqlIdentifierPattern(identifier);
  if (schema && schema !== "public") return `${sqlIdentifierPattern(schema)}\\s*\\.\\s*${relation}`;
  return `(?:${sqlIdentifierPattern("public")}\\s*\\.\\s*)?${relation}`;
}

function sqlIdentifierPattern(identifier: string): string {
  const escaped = escapeRegExp(identifier);
  return `(?:"${escaped}"|${escaped})`;
}

function normalizeSourceIdentifier(identifier: string): string {
  return identifier.toLowerCase();
}

function sameIdentifier(left: string, right: string): boolean {
  return left === right || left.toLowerCase() === right.toLowerCase();
}

function lineNumberAt(source: string, offset: number): number {
  return source.slice(0, offset).split(/\r?\n/).length;
}

function formatFinding(finding: MigrationRiskFinding): string {
  return `${finding.filePath}:${finding.line} [${finding.category}]`;
}

function parseStableTag(tag: string): [number, number, number] | undefined {
  const match = tag.match(STABLE_TAG_PATTERN);
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareStableVersions(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return (left[index] ?? 0) - (right[index] ?? 0);
  }
  return 0;
}

function resolveGitRevision(cwd: string, value: string, label: string): string {
  const ref = value.trim();
  if (!ref || ref.startsWith("-") || ref.includes("\0")) {
    throw new Error(`${label} 不是可解析的 Git tag/提交：${value}`);
  }
  try {
    const revision = execFileSync("git", ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (!/^[0-9a-f]{40}$/i.test(revision)) throw new Error("不是提交");
    return revision;
  } catch {
    throw new Error(`${label} 无法解析为 Git tag/提交：${value}`);
  }
}

function git(cwd: string, args: string[]): string {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trimEnd();
  } catch (error) {
    throw new Error(`release-compat 无法读取 Git 历史：${error instanceof Error ? error.message : String(error)}`);
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function main(): void {
  try {
    const result = checkReleaseCompatibility();
    console.log(
      `release-compat：上一生产版本 ${result.previousRelease.ref}（${result.previousRelease.commit.slice(0, 12)}）；已变更 ${result.changedMigrationFiles.length} 个活动迁移文件。`,
    );
    for (const check of result.findings) {
      if (check.status === "not-applicable") continue;
      const output = check.message ?? formatFinding(check.finding);
      if (check.status === "fail") console.error(`release-compat：失败 ${output}`);
      else console.log(`release-compat：通过 ${output}`);
    }
    if (result.failures.length > 0) {
      console.error(`release-compat：兼容性检查失败，共发现 ${result.failures.length} 项问题。`);
      process.exitCode = 1;
      return;
    }
    console.log("release-compat：上一生产版本 → 下一版本架构兼容性检查通过。");
  } catch (error) {
    console.error(`release-compat：${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main();
}
