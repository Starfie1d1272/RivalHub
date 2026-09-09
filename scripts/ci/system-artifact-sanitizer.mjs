import { execFileSync } from "node:child_process";
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

const TEXT_EXTENSIONS = new Set([
  ".css", ".csv", ".html", ".js", ".json", ".jsonl", ".log", ".md", ".mjs", ".svg", ".trace", ".ts", ".tsx", ".txt", ".xml", ".yaml", ".yml",
]);
const BINARY_EXTENSIONS = new Set([
  ".avi", ".bmp", ".gif", ".ico", ".jpeg", ".jpg", ".mov", ".mp3", ".mp4", ".pdf", ".png", ".webm", ".woff", ".woff2",
]);

export function copySafeTree(source, target, includeReportJson) {
  if (!isDirectory(source)) return;
  mkdirSync(target, { recursive: true });
  for (const name of readdirSync(source)) {
    if (shouldSkipName(name)) continue;
    const sourcePath = resolve(source, name);
    const targetPath = resolve(target, name);
    let stat;
    try {
      stat = lstatSync(sourcePath);
    } catch {
      continue;
    }
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) {
      copySafeTree(sourcePath, targetPath, includeReportJson);
      continue;
    }
    if (!stat.isFile() || isBinaryPath(sourcePath)) continue;

    const extension = extname(name).toLowerCase();
    try {
      if (extension === ".json" && !includeReportJson) continue;
      if (extension === ".zip") {
        sanitizeTraceArchive(sourcePath, targetPath);
        continue;
      }
      const content = readTextFile(sourcePath);
      if (content === undefined) continue;
      writeFileSync(targetPath, redact(content), "utf8");
    } catch {
      // A transient report file must never hide the original test failure.
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

export function redact(value) {
  let safe = value
    .replace(/(["']?(?:SUPABASE_SERVICE_ROLE_KEY|SUPABASE_ANON_KEY|ADMIN_SESSION_SECRET|password|passwd|token|access_token|refresh_token|secret|signedUrl|signed_url|authorization|cookie|set-cookie)["']?\s*[:=]\s*)(["']?)[^\s,"'}]+\2/gi, "$1$2[REDACTED]$2")
    .replace(/https?:\/\/[^\s"']*[?&](?:token|access_token|refresh_token|signature)=[^\s"']*/gi, "[REDACTED_SIGNED_URL]")
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, (match) => `${match.split(/\s+/, 1)[0]} [REDACTED]`)
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9._-]+\.[A-Za-z0-9._-]+\b/g, "[REDACTED_JWT]")
    .replace(/([?&](?:token|access_token|refresh_token|signature|password|secret)=)[^&\s"']+/gi, "$1[REDACTED]")
    .replace(/https?:\/\/[^\s"']+\/storage\/v1\/object\/[^\s"']+/gi, "[REDACTED_STORAGE_URL]")
    .replace(/(?:education[-_]evidence(?:\/[0-9a-f-]+\/[0-9a-f-]+\.[a-z]+)?|evidence[-_]?object[-_]?key\s*[:=]\s*)[^\s,"'}]*/gi, "[REDACTED_EDUCATION_EVIDENCE]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]");

  for (const [name, secret] of Object.entries(process.env)) {
    if (!secret || secret.length < 12 || !/(?:KEY|SECRET|TOKEN|PASSWORD|COOKIE|AUTH)/i.test(name)) continue;
    safe = safe.split(secret).join("[REDACTED_ENV]");
  }
  return safe;
}

function sanitizeTree(directory) {
  for (const name of readdirSync(directory)) {
    if (shouldSkipName(name)) {
      rmSync(resolve(directory, name), { recursive: true, force: true });
      continue;
    }
    const path = resolve(directory, name);
    let stat;
    try {
      stat = lstatSync(path);
    } catch {
      continue;
    }
    if (stat.isSymbolicLink()) {
      rmSync(path, { force: true });
      continue;
    }
    if (stat.isDirectory()) {
      sanitizeTree(path);
      continue;
    }
    if (!stat.isFile() || isBinaryPath(path)) {
      rmSync(path, { force: true });
      continue;
    }
    const content = readTextFile(path);
    if (content === undefined) rmSync(path, { force: true });
    else writeFileSync(path, redact(content), "utf8");
  }
}

function readTextFile(path) {
  const extension = extname(path).toLowerCase();
  if (!TEXT_EXTENSIONS.has(extension)) return undefined;
  return readFileSync(path, "utf8");
}

function isBinaryPath(path) {
  return BINARY_EXTENSIONS.has(extname(path).toLowerCase());
}

function isDirectory(path) {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}

function shouldSkipName(name) {
  return /(?:credential|secret|token|\.env(?:\.|$))/i.test(name);
}
