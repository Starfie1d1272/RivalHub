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
  annotation?: string;
}

interface SqlStatement {
  text: string;
  start: number;
}

const RISK_PATTERNS: ReadonlyArray<readonly [MigrationRiskCategory, RegExp]> = [
  ["drop", /\bDROP\s+(?:TABLE|COLUMN|TYPE)\b/i],
  ["rename", /\bALTER\s+TABLE\b[\s\S]*?\bRENAME\s+(?:COLUMN\b[\s\S]*?\bTO\b|TO\b)/i],
  ["alter-type", /\bALTER\s+TABLE\b[\s\S]*?\bALTER\s+COLUMN\b[\s\S]*?\b(?:SET\s+DATA\s+TYPE|TYPE)\b/i],
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
          ...(annotation ? { annotation } : {}),
        });
      }
    }
  }

  return findings;
}

export function changedMigrationFiles(cwd = process.cwd()): string[] {
  const base = process.env.RIVALHUB_MIGRATION_BASE_SHA?.trim();
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
