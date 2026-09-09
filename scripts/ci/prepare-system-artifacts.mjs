import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { extname, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";

const root = process.cwd();
const destination = resolve(root, ".agent-tmp", "system-artifacts");
const attemptsDirectory = resolve(process.env.RIVALHUB_E2E_ARTIFACT_DIR ?? resolve(root, ".agent-tmp", "e2e-attempts"));
mkdirSync(destination, { recursive: true });

const attempts = readAttemptRecords(attemptsDirectory);
writeFileSync(resolve(destination, "e2e-attempts.json"), `${JSON.stringify({
  attempts,
  retryCount: attempts.filter((attempt) => attempt.retry > 0).length,
  flakyCount: attempts.filter((attempt) => attempt.retry > 0 && attempt.status === "passed").length,
}, null, 2)}\n`, "utf8");

copySafeTree(resolve(root, "test-results"), resolve(destination, "test-results"), false);
copySafeTree(resolve(root, "playwright-report"), resolve(destination, "playwright-report"), true);

const nextLog = resolve(root, ".agent-tmp", "next-server.log");
if (existsSync(nextLog)) {
  const safeLog = redact(readFileSync(nextLog, "utf8")).split("\n").slice(-2_000).join("\n");
  writeFileSync(resolve(destination, "next-server.safe.log"), safeLog, "utf8");
}

function readAttemptRecords(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => name.endsWith(".attempt.json"))
    .flatMap((name) => {
      try {
        const value = JSON.parse(readFileSync(resolve(directory, name), "utf8"));
        if (!value || typeof value !== "object" || typeof value.scenarioId !== "string") return [];
        return [{
          scenarioId: value.scenarioId,
          project: typeof value.project === "string" ? value.project : "unknown",
          retry: Number.isInteger(value.retry) ? value.retry : 0,
          repeatEachIndex: Number.isInteger(value.repeatEachIndex) ? value.repeatEachIndex : 0,
          status: typeof value.status === "string" ? value.status : "unknown",
          expectedStatus: typeof value.expectedStatus === "string" ? value.expectedStatus : "unknown",
          durationMs: Number.isFinite(value.durationMs) ? value.durationMs : 0,
        }];
      } catch {
        return [];
      }
    });
}

function copySafeTree(source, target, includeReportJson) {
  if (!existsSync(source)) return;
  mkdirSync(target, { recursive: true });
  for (const name of readdirSync(source)) {
    if (name.includes("credentials") || name.includes("secret") || name.includes("token")) continue;
    const sourcePath = resolve(source, name);
    const targetPath = resolve(target, name);
    if (statSync(sourcePath).isDirectory()) {
      copySafeTree(sourcePath, targetPath, includeReportJson);
      continue;
    }
    const extension = extname(name).toLowerCase();
    try {
      if (extension === ".json" && !includeReportJson) continue;
      if (extension === ".zip") {
        sanitizeTraceArchive(sourcePath, targetPath);
        continue;
      }
      if ([".txt", ".md", ".html", ".json", ".js", ".css", ".svg"].includes(extension)) {
        writeFileSync(targetPath, redact(readFileSync(sourcePath, "utf8")), "utf8");
      } else {
        cpSync(sourcePath, targetPath, { recursive: true, force: true });
      }
    } catch {
      // Ignore a transient report file; failure diagnostics must never make
      // the original system result less actionable.
    }
  }
}

function sanitizeTraceArchive(source, target) {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "rivalhub-trace-"));
  try {
    execFileSync("unzip", ["-qq", source, "-d", temporaryDirectory], { stdio: "ignore" });
    sanitizeTree(temporaryDirectory);
    execFileSync("zip", ["-q", "-r", target, "."], { cwd: temporaryDirectory, stdio: "ignore" });
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

function sanitizeTree(directory) {
  for (const name of readdirSync(directory)) {
    const path = resolve(directory, name);
    if (statSync(path).isDirectory()) {
      sanitizeTree(path);
      continue;
    }
    if ([".png", ".jpg", ".jpeg", ".webm", ".woff", ".woff2"].includes(extname(name).toLowerCase())) continue;
    try {
      writeFileSync(path, redact(readFileSync(path, "utf8")), "utf8");
    } catch {
      // Binary trace resources are retained without attempting text redaction.
    }
  }
}

function redact(value) {
  return value
    .replace(/(["']?(?:SUPABASE_SERVICE_ROLE_KEY|SUPABASE_ANON_KEY|ADMIN_SESSION_SECRET|password|token|access_token|refresh_token|secret|signedUrl|signed_url|authorization)["']?\s*[:=]\s*)(["']?)[^\s,"'}]+["']?/gi, (_match, prefix, quote) => `${prefix}${quote}[REDACTED]${quote}`)
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
    .replace(/([?&](?:token|access_token|refresh_token|signature)=)[^&\s"']+/gi, "$1[REDACTED]")
    .replace(/https?:\/\/[^\s"']+\/storage\/v1\/object\/[^\s"']+/gi, "[REDACTED_STORAGE_URL]")
    .replace(/education-evidence\/[0-9a-f-]+\/[0-9a-f-]+\.[a-z]+/gi, "education-evidence/[REDACTED_OBJECT]");
}

console.log(`Prepared safe system artifacts: ${relative(root, destination)}; attempts=${readAttemptRecords(attemptsDirectory).length}.`);
