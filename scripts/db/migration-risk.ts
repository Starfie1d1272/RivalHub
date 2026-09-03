import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const MIGRATION_RISK_ANNOTATION =
  "-- rivalhub:migration-risk: contract cleanup after the previous release stopped reading/writing <old field>";

export type MigrationRiskCategory =
  | "drop"
  | "rename"
  | "alter-type"
  | "set-not-null"
  | "rewrite-or-exclusive-lock";

export interface MigrationRiskFinding {
  category: MigrationRiskCategory;
  filePath: string;
  line: number;
  statement: string;
  statementText?: string;
  annotation?: string;
}

export interface MigrationRiskClassifierOptions {
  includeStatementText?: boolean;
}

export type MigrationContractOwnerKind = "relation" | "column" | "type";

export interface MigrationContractOwner {
  kind: MigrationContractOwnerKind;
  identifier: string;
  relation?: string;
  schema?: string;
  renamedTo?: string;
  displayName: string;
}

interface SqlStatement {
  text: string;
  start: number;
}

const RISK_PATTERNS: ReadonlyArray<readonly [MigrationRiskCategory, RegExp]> = [
  ["drop", /\bDROP\s+(?:TABLE|COLUMN|TYPE)\b/i],
  ["rename", /\bALTER\s+(?:TABLE|TYPE)\b[\s\S]*?\bRENAME\s+(?:COLUMN\b[\s\S]*?\bTO\b|TO\b)/i],
  [
    "alter-type",
    /\bALTER\s+TABLE\b[\s\S]*?\bALTER\s+COLUMN\b[\s\S]*?\b(?:SET\s+DATA\s+TYPE|TYPE)\b|\bALTER\s+TYPE\b(?![\s\S]*?\bRENAME\s+TO\b)/i,
  ],
  ["set-not-null", /\bALTER\s+TABLE\b[\s\S]*?\bALTER\s+COLUMN\b[\s\S]*?\bSET\s+NOT\s+NULL\b/i],
  [
    "rewrite-or-exclusive-lock",
    /\bCREATE\s+(?:UNIQUE\s+)?INDEX\b(?![\s\S]*?\bCONCURRENTLY\b)|\bALTER\s+TABLE\b[\s\S]*?\bADD\s+CONSTRAINT\b/i,
  ],
];

const ANNOTATION_PATTERN = /^\s*--\s*rivalhub:migration-risk:\s*(contract cleanup after the previous release stopped reading\/writing\s+\S.*)$/i;

/**
 * Classify only the SQL statements that are visibly risky to compatibility
 * or locking. This deliberately does not attempt to prove that a migration
 * is safe; replay and the active Drizzle ledger remain the authority.
 */
export function classifyMigrationSql(
  sql: string,
  filePath = "<inline migration>",
  options: MigrationRiskClassifierOptions = {},
): MigrationRiskFinding[] {
  const findings: MigrationRiskFinding[] = [];

  for (const statement of splitSqlStatements(sql)) {
    const masked = maskSql(statement.text);
    const codeLineOffset = firstCodeLineOffset(masked);
    if (codeLineOffset < 0) continue;

    const line = lineNumberAt(sql, statement.start) + codeLineOffset;
    const annotation = findImmediateAnnotation(statement.text, codeLineOffset);
    const statementPreview = statement.text.trim().replace(/\s+/g, " ").slice(0, 180);

    for (const [category, pattern] of RISK_PATTERNS) {
      if (pattern.test(masked)) {
        findings.push({
          category,
          filePath,
          line,
          statement: statementPreview,
          ...(options.includeStatementText ? { statementText: statement.text } : {}),
          ...(annotation ? { annotation } : {}),
        });
      }
    }
  }

  return findings;
}

export function changedMigrationFiles(cwd = process.cwd(), defaultBase?: string): string[] {
  const configuredBase = process.env.RIVALHUB_MIGRATION_BASE_SHA?.trim();
  const base = configuredBase && !isZeroRevision(configuredBase) ? configuredBase : defaultBase;
  const head = process.env.RIVALHUB_MIGRATION_HEAD_SHA?.trim() || "HEAD";
  const paths = new Set<string>();

  const usableBase = base && !isZeroRevision(base) ? base : undefined;
  if (usableBase && isGitRevision(usableBase)) {
    if (!isGitRevision(head)) {
      throw new Error(`RIVALHUB_MIGRATION_HEAD_SHA 不是有效 git revision：${head}`);
    }
    for (const path of gitNames(cwd, ["diff", "--name-only", "-z", "--diff-filter=ACMRTUXB", usableBase, head, "--", "drizzle/migrations"])) {
      paths.add(path);
    }
  } else if (usableBase) {
    throw new Error(`RIVALHUB_MIGRATION_BASE_SHA 不是有效 git revision：${base}`);
  } else {
    for (const path of gitNames(cwd, ["diff", "--name-only", "-z", "--diff-filter=ACMRTUXB", "HEAD", "--", "drizzle/migrations"])) {
      paths.add(path);
    }
    for (const path of gitNames(cwd, ["ls-files", "--others", "--exclude-standard", "-z", "--", "drizzle/migrations"])) {
      paths.add(path);
    }
  }

  return [...paths].sort();
}

export function extractMigrationContractOwners(finding: MigrationRiskFinding): MigrationContractOwner[] {
  const statement = finding.statementText ?? finding.statement;
  if (finding.category === "drop") return extractDropOwners(statement);
  if (finding.category === "rename") return extractRenameOwners(statement);
  return [];
}

function main(): void {
  const files = changedMigrationFiles();
  if (files.length === 0) {
    console.log("migration-risk: no changed active migrations; historical SQL remains under Drizzle ledger/replay checks.");
    return;
  }

  const findings = files.flatMap((filePath) => {
    const absolutePath = resolve(process.cwd(), filePath);
    return classifyMigrationSql(readFileSync(absolutePath, "utf8"), filePath);
  });
  const unannotated = findings.filter((finding) => !finding.annotation);

  for (const finding of findings) {
    const status = finding.annotation ? "annotated" : "requires annotation";
    console.log(`${finding.filePath}:${finding.line} [${finding.category}] ${status}: ${finding.statement}`);
  }

  if (unannotated.length > 0) {
    console.error("migration-risk: risky SQL requires a durable annotation immediately before the statement:");
    console.error(MIGRATION_RISK_ANNOTATION);
    process.exitCode = 1;
    return;
  }

  console.log(`migration-risk: ${findings.length} classified statement(s) have durable annotations; replay/preflight is still required.`);
}

function splitSqlStatements(sql: string): SqlStatement[] {
  const statements: SqlStatement[] = [];
  let start = 0;
  let index = 0;
  let quote: "single" | "double" | "dollar" | "line-comment" | "block-comment" | null = null;
  let dollarDelimiter = "";

  while (index < sql.length) {
    const char = sql[index];
    const next = sql[index + 1];

    if (quote === "line-comment") {
      if (char === "\n") quote = null;
      index += 1;
      continue;
    }
    if (quote === "block-comment") {
      if (char === "*" && next === "/") {
        quote = null;
        index += 2;
      } else {
        index += 1;
      }
      continue;
    }
    if (quote === "single") {
      if (char === "'" && next === "'") {
        index += 2;
      } else if (char === "'") {
        quote = null;
        index += 1;
      } else {
        index += 1;
      }
      continue;
    }
    if (quote === "double") {
      if (char === '"' && next === '"') {
        index += 2;
      } else if (char === '"') {
        quote = null;
        index += 1;
      } else {
        index += 1;
      }
      continue;
    }
    if (quote === "dollar") {
      if (sql.startsWith(dollarDelimiter, index)) {
        quote = null;
        index += dollarDelimiter.length;
      } else {
        index += 1;
      }
      continue;
    }

    if (char === "-" && next === "-") {
      quote = "line-comment";
      index += 2;
      continue;
    }
    if (char === "/" && next === "*") {
      quote = "block-comment";
      index += 2;
      continue;
    }
    if (char === "'") {
      quote = "single";
      index += 1;
      continue;
    }
    if (char === '"') {
      quote = "double";
      index += 1;
      continue;
    }
    if (char === "$" && next !== undefined) {
      const delimiter = sql.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/)?.[0];
      if (delimiter) {
        quote = "dollar";
        dollarDelimiter = delimiter;
        index += delimiter.length;
        continue;
      }
    }
    if (char === ";") {
      statements.push({ text: sql.slice(start, index + 1), start });
      start = index + 1;
    }
    index += 1;
  }

  if (sql.slice(start).trim()) statements.push({ text: sql.slice(start), start });
  return statements;
}

interface SqlToken {
  kind: "identifier" | "punctuation";
  value: string;
  quoted: boolean;
}

function extractDropOwners(sql: string): MigrationContractOwner[] {
  const tokens = tokenizeSql(sql);
  const dropIndex = findKeyword(tokens, "DROP");
  if (dropIndex < 0) return [];
  const objectKind = tokens[dropIndex + 1]?.value.toUpperCase();
  if (objectKind === "COLUMN") {
    const tableIndex = findKeywordBefore(tokens, "TABLE", dropIndex);
    if (tableIndex < 0) return [];
    const relation = readQualifiedName(tokens, skipKeyword(tokens, tableIndex + 1, "ONLY"));
    if (!relation) return [];
    const owners: MigrationContractOwner[] = [];
    let columnStart = skipKeywords(tokens, dropIndex + 2, ["IF", "EXISTS"]);
    while (columnStart < tokens.length) {
      const column = readQualifiedName(tokens, columnStart);
      if (!column || column.schema) return [];
      owners.push({
        kind: "column",
        identifier: column.name,
        relation: relation.name,
        ...(relation.schema ? { schema: relation.schema } : {}),
        displayName: `${relation.displayName}.${column.name}`,
      });
      const next = column.next;
      if (tokens[next]?.value !== "," || !tokens[next + 1] || !tokens[next + 2] || !isKeyword(tokens[next + 1], "DROP") || !isKeyword(tokens[next + 2], "COLUMN")) break;
      columnStart = skipKeywords(tokens, next + 3, ["IF", "EXISTS"]);
    }
    return owners;
  }

  const kind = objectKind === "TYPE" ? "type" : objectKind === "TABLE" ? "relation" : undefined;
  if (!kind) return [];
  let cursor = skipKeywords(tokens, dropIndex + 2, ["IF", "EXISTS"]);
  const owners: MigrationContractOwner[] = [];
  while (cursor < tokens.length) {
    const name = readQualifiedName(tokens, cursor);
    if (!name) break;
    owners.push({
      kind,
      identifier: name.name,
      ...(name.schema ? { schema: name.schema } : {}),
      displayName: name.displayName,
    });
    cursor = name.next;
    if (tokens[cursor]?.value !== ",") break;
    cursor = skipKeywords(tokens, cursor + 1, ["IF", "EXISTS"]);
  }
  return owners;
}

function extractRenameOwners(sql: string): MigrationContractOwner[] {
  const tokens = tokenizeSql(sql);
  const renameIndex = findKeyword(tokens, "RENAME");
  if (renameIndex < 0) return [];

  const tableIndex = findKeywordBefore(tokens, "TABLE", renameIndex);
  if (tableIndex >= 0) {
    const relation = readQualifiedName(tokens, skipKeyword(tokens, tableIndex + 1, "ONLY"));
    if (!relation) return [];
    if (tokens[renameIndex + 1]?.value.toUpperCase() === "COLUMN") {
      const oldColumn = readQualifiedName(tokens, renameIndex + 2);
      const toIndex = findKeywordAfter(tokens, "TO", oldColumn?.next ?? renameIndex + 2);
      const newColumn = toIndex >= 0 ? readQualifiedName(tokens, toIndex + 1) : undefined;
      if (!oldColumn || !newColumn || oldColumn.schema || newColumn.schema) return [];
      if (tokens.slice(newColumn.next).some((token) => isKeyword(token, "RENAME"))) return [];
      return [{
        kind: "column",
        identifier: oldColumn.name,
        relation: relation.name,
        ...(relation.schema ? { schema: relation.schema } : {}),
        renamedTo: newColumn.name,
        displayName: `${relation.displayName}.${oldColumn.name}`,
      }];
    }

    if (tokens[renameIndex + 1]?.value.toUpperCase() === "TO") {
      const newRelation = readQualifiedName(tokens, renameIndex + 2);
      if (!newRelation) return [];
      return [{
        kind: "relation",
        identifier: relation.name,
        ...(relation.schema ? { schema: relation.schema } : {}),
        renamedTo: newRelation.name,
        displayName: relation.displayName,
      }];
    }
    return [];
  }

  const typeIndex = findKeyword(tokens, "TYPE");
  if (typeIndex < 0 || typeIndex > renameIndex) return [];
  const type = readQualifiedName(tokens, typeIndex + 1);
  const toIndex = findKeywordAfter(tokens, "TO", type?.next ?? typeIndex + 1);
  const newType = toIndex >= 0 ? readQualifiedName(tokens, toIndex + 1) : undefined;
  if (!type || !newType) return [];
  return [{
    kind: "type",
    identifier: type.name,
    ...(type.schema ? { schema: type.schema } : {}),
    renamedTo: newType.name,
    displayName: type.displayName,
  }];
}

function tokenizeSql(sql: string): SqlToken[] {
  const tokens: SqlToken[] = [];
  let index = 0;
  while (index < sql.length) {
    const char = sql[index];
    const next = sql[index + 1];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === "-" && next === "-") {
      index = sql.indexOf("\n", index + 2);
      if (index < 0) break;
      continue;
    }
    if (char === "/" && next === "*") {
      const end = sql.indexOf("*/", index + 2);
      index = end < 0 ? sql.length : end + 2;
      continue;
    }
    if (char === "'") {
      index = skipSingleQuoted(sql, index);
      continue;
    }
    if (char === '"') {
      let end = index + 1;
      let value = "";
      while (end < sql.length) {
        if (sql[end] === '"' && sql[end + 1] === '"') {
          value += '"';
          end += 2;
        } else if (sql[end] === '"') {
          break;
        } else {
          value += sql[end];
          end += 1;
        }
      }
      tokens.push({ kind: "identifier", value, quoted: true });
      index = end < sql.length ? end + 1 : sql.length;
      continue;
    }
    if (/[A-Za-z_]/.test(char)) {
      let end = index + 1;
      while (end < sql.length && /[A-Za-z0-9_$]/.test(sql[end])) end += 1;
      tokens.push({ kind: "identifier", value: sql.slice(index, end), quoted: false });
      index = end;
      continue;
    }
    tokens.push({ kind: "punctuation", value: char, quoted: false });
    index += 1;
  }
  return tokens;
}

function skipSingleQuoted(sql: string, start: number): number {
  let index = start + 1;
  while (index < sql.length) {
    if (sql[index] === "'" && sql[index + 1] === "'") index += 2;
    else if (sql[index] === "'") return index + 1;
    else index += 1;
  }
  return sql.length;
}

function findKeyword(tokens: readonly SqlToken[], keyword: string): number {
  return tokens.findIndex((token) => isKeyword(token, keyword));
}

function findKeywordBefore(tokens: readonly SqlToken[], keyword: string, before: number): number {
  for (let index = before - 1; index >= 0; index -= 1) {
    if (tokens[index] && isKeyword(tokens[index], keyword)) return index;
  }
  return -1;
}

function findKeywordAfter(tokens: readonly SqlToken[], keyword: string, after: number): number {
  for (let index = after; index < tokens.length; index += 1) {
    if (tokens[index] && isKeyword(tokens[index], keyword)) return index;
  }
  return -1;
}

function skipKeyword(tokens: readonly SqlToken[], index: number, keyword: string): number {
  return tokens[index] && isKeyword(tokens[index], keyword) ? index + 1 : index;
}

function skipKeywords(tokens: readonly SqlToken[], index: number, keywords: readonly string[]): number {
  let cursor = index;
  while (tokens[cursor] && keywords.some((keyword) => isKeyword(tokens[cursor]!, keyword))) cursor += 1;
  return cursor;
}

function isKeyword(token: SqlToken, keyword: string): boolean {
  return token.kind === "identifier" && !token.quoted && token.value.toUpperCase() === keyword;
}

function readQualifiedName(tokens: readonly SqlToken[], start: number): { name: string; schema?: string; displayName: string; next: number } | undefined {
  const first = tokens[start];
  if (!first || first.kind !== "identifier") return undefined;
  const parts = [normalizeIdentifier(first)];
  let cursor = start + 1;
  while (tokens[cursor]?.value === ".") {
    const part = tokens[cursor + 1];
    if (!part || part.kind !== "identifier") return undefined;
    parts.push(normalizeIdentifier(part));
    cursor += 2;
  }
  if (parts.length > 2) return undefined;
  const name = parts.at(-1);
  if (!name) return undefined;
  return {
    name,
    ...(parts.length > 1 ? { schema: parts.at(-2) } : {}),
    displayName: parts.join("."),
    next: cursor,
  };
}

function normalizeIdentifier(token: SqlToken): string {
  return token.quoted ? token.value : token.value.toLowerCase();
}

function maskSql(sql: string): string {
  const chars = sql.split("");
  let index = 0;
  let quote: "single" | "double" | "dollar" | "line-comment" | "block-comment" | null = null;
  let dollarDelimiter = "";

  const blank = (position: number): void => {
    if (chars[position] !== "\n" && chars[position] !== "\r") chars[position] = " ";
  };

  while (index < chars.length) {
    const char = chars[index];
    const next = chars[index + 1];

    if (quote === "line-comment") {
      blank(index);
      if (char === "\n") quote = null;
      index += 1;
      continue;
    }
    if (quote === "block-comment") {
      blank(index);
      if (char === "*" && next === "/") {
        blank(index + 1);
        quote = null;
        index += 2;
      } else {
        index += 1;
      }
      continue;
    }
    if (quote === "single") {
      blank(index);
      if (char === "'" && next === "'") {
        blank(index + 1);
        index += 2;
      } else if (char === "'") {
        quote = null;
        index += 1;
      } else {
        index += 1;
      }
      continue;
    }
    if (quote === "double") {
      blank(index);
      if (char === '"' && next === '"') {
        blank(index + 1);
        index += 2;
      } else if (char === '"') {
        quote = null;
        index += 1;
      } else {
        index += 1;
      }
      continue;
    }
    if (quote === "dollar") {
      if (sql.startsWith(dollarDelimiter, index)) {
        for (let offset = 0; offset < dollarDelimiter.length; offset += 1) blank(index + offset);
        quote = null;
        index += dollarDelimiter.length;
      } else {
        blank(index);
        index += 1;
      }
      continue;
    }

    if (char === "-" && next === "-") {
      blank(index);
      blank(index + 1);
      quote = "line-comment";
      index += 2;
      continue;
    }
    if (char === "/" && next === "*") {
      blank(index);
      blank(index + 1);
      quote = "block-comment";
      index += 2;
      continue;
    }
    if (char === "'") {
      blank(index);
      quote = "single";
      index += 1;
      continue;
    }
    if (char === '"') {
      blank(index);
      quote = "double";
      index += 1;
      continue;
    }
    if (char === "$" && next !== undefined) {
      const delimiter = sql.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/)?.[0];
      if (delimiter) {
        for (let offset = 0; offset < delimiter.length; offset += 1) blank(index + offset);
        quote = "dollar";
        dollarDelimiter = delimiter;
        index += delimiter.length;
        continue;
      }
    }
    index += 1;
  }

  return chars.join("");
}

function firstCodeLineOffset(masked: string): number {
  const lines = masked.split(/\r?\n/);
  return lines.findIndex((line) => line.trim().length > 0);
}

function findImmediateAnnotation(statement: string, codeLineOffset: number): string | undefined {
  const lines = statement.split(/\r?\n/).slice(0, codeLineOffset);
  const previous = [...lines].reverse().find((line) => line.trim().length > 0);
  const match = previous?.match(ANNOTATION_PATTERN);
  return match?.[1]?.trim();
}

function lineNumberAt(sql: string, offset: number): number {
  return sql.slice(0, offset).split(/\r?\n/).length;
}

function isGitRevision(value: string): boolean {
  return /^(?:[0-9a-f]{7,40}|HEAD|FETCH_HEAD|ORIG_HEAD)$/i.test(value);
}

function isZeroRevision(value: string): boolean {
  return /^0+$/.test(value);
}

function gitNames(cwd: string, args: string[]): string[] {
  try {
    const output = execFileSync("git", args, { cwd, encoding: "utf8" });
    return output.split("\0").filter(Boolean);
  } catch (error) {
    throw new Error(`无法读取 active migration changed-surface：${error instanceof Error ? error.message : String(error)}`);
  }
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main();
}
