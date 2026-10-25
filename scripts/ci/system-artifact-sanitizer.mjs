import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, opendirSync, readSync, writeFileSync } from "node:fs";
import { extname, resolve } from "node:path";

const TEXT_EXTENSIONS = new Set([
  ".css", ".csv", ".html", ".js", ".json", ".jsonl", ".log", ".md", ".mjs", ".svg", ".trace", ".ts", ".tsx", ".txt", ".xml", ".yaml", ".yml",
]);
const BINARY_EXTENSIONS = new Set([
  ".avi", ".bmp", ".gif", ".ico", ".jpeg", ".jpg", ".mov", ".mp3", ".mp4", ".pdf", ".png", ".webm", ".woff", ".woff2",
]);
const FAILURE_SCREENSHOT_EXTENSIONS = new Set([".jpeg", ".jpg", ".png"]);
export const ARTIFACT_LIMITS = Object.freeze({
  files: 200, entries: 1_000, depth: 16,
  textFileBytes: 1024 * 1024, textInputBytes: 4 * 1024 * 1024, lineBytes: 4 * 1024,
  inputBytes: 32 * 1024 * 1024, outputBytes: 32 * 1024 * 1024, summaryReserveBytes: 8 * 1024,
  failureScreenshotBytes: 10 * 1024 * 1024, logTailBytes: 256 * 1024, logTailLines: 2_000,
});

export function createArtifactBudget() {
  return { files: 0, entries: 0, textInputBytes: 0, inputBytes: 0, outputBytes: 0, skipped: {} };
}
function skip(budget, reason) { budget.skipped[reason] = (budget.skipped[reason] ?? 0) + 1; }

/** Lazy enumeration bounds traversal as well as reads; never follows directory symlinks. */
export function* artifactEntries(directory, budget, depth = 0) {
  if (depth > ARTIFACT_LIMITS.depth) { skip(budget, "depthLimit"); return; }
  let handle;
  try {
    const stat = lstatSync(directory);
    if (stat.isSymbolicLink()) { skip(budget, "symbolicLink"); return; }
    if (!stat.isDirectory()) return;
    handle = opendirSync(directory);
    while (budget.entries < ARTIFACT_LIMITS.entries && budget.files < ARTIFACT_LIMITS.files) {
      const entry = handle.readSync();
      if (!entry) return;
      budget.entries += 1;
      if (/(?:credential|secret|token|\.env(?:\.|$))/i.test(entry.name)) { skip(budget, "sensitiveName"); continue; }
      if (entry.isSymbolicLink()) { skip(budget, "symbolicLink"); continue; }
      yield { name: entry.name, path: resolve(directory, entry.name), directory: entry.isDirectory(), depth };
    }
    skip(budget, budget.files >= ARTIFACT_LIMITS.files ? "fileLimit" : "entryLimit");
  } catch (error) {
    if (error.code !== "ENOENT") skip(budget, "ioError");
  } finally { handle?.closeSync(); }
}

/** Fixed-size fd reads, including tails, cannot grow into unbounded readFileSync work. */
function readArtifactBytes(path, budget, { binary = false, tail = false } = {}) {
  if (budget.files >= ARTIFACT_LIMITS.files) { skip(budget, "fileLimit"); return; }
  let fd;
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) { skip(budget, "symbolicLink"); return; }
    if (!stat.isFile()) { skip(budget, "notRegularFile"); return; }
    budget.files += 1;
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino || opened.size !== stat.size) { skip(budget, "changedFile"); return; }
    const maximum = binary ? ARTIFACT_LIMITS.failureScreenshotBytes : ARTIFACT_LIMITS.textFileBytes;
    if (!tail && opened.size > maximum) { skip(budget, "fileBytes"); return; }
    const size = tail ? Math.min(opened.size, ARTIFACT_LIMITS.logTailBytes) : opened.size;
    if (budget.inputBytes + size > ARTIFACT_LIMITS.inputBytes) { skip(budget, "inputBytes"); return; }
    if (!binary && budget.textInputBytes + size > ARTIFACT_LIMITS.textInputBytes) { skip(budget, "textInputBytes"); return; }
    const bytes = Buffer.alloc(size);
    let count = 0;
    while (count < size) {
      const read = readSync(fd, bytes, count, size - count, (tail ? opened.size - size : 0) + count);
      if (!read) break;
      count += read;
    }
    budget.inputBytes += count;
    if (!binary) budget.textInputBytes += count;
    if (count !== size || fstatSync(fd).size !== opened.size) { skip(budget, "changedFile"); return; }
    return { bytes, truncated: tail && opened.size > size };
  } catch (error) {
    if (error.code !== "ENOENT") skip(budget, "ioError");
  } finally { if (fd !== undefined) closeSync(fd); }
}

function hasMultilineEnvironmentSecret() {
  return Object.entries(process.env).some(([name, value]) => value && value.length >= 12
    && /(?:KEY|SECRET|TOKEN|PASSWORD|COOKIE|AUTH)/i.test(name) && /[\r\n]/.test(value));
}

/** Structured reports skip the whole file on long lines; logs may omit complete lines. */
export function readArtifactText(path, budget, { tail = false } = {}) {
  const source = readArtifactBytes(path, budget, { tail });
  if (!source) return;
  let text = source.bytes.toString("utf8");
  let truncated = source.truncated;
  if (truncated) {
    const boundary = text.indexOf("\n");
    text = boundary < 0 ? "" : text.slice(boundary + 1);
    skip(budget, "partialTailLine");
  }
  let lines = text.split("\n");
  if (tail && lines.length > ARTIFACT_LIMITS.logTailLines) {
    lines = lines.slice(-ARTIFACT_LIMITS.logTailLines);
    truncated = true;
    skip(budget, "tailLineLimit");
  }
  const hasLongLine = lines.some(line => Buffer.byteLength(line) > ARTIFACT_LIMITS.lineBytes);
  if ((truncated || hasLongLine) && hasMultilineEnvironmentSecret()) { skip(budget, "multilineSecretBoundary"); return; }
  if (hasLongLine && !tail) { skip(budget, "longLine"); return; }
  return lines.filter(line => {
    if (Buffer.byteLength(line) <= ARTIFACT_LIMITS.lineBytes) return true;
    skip(budget, "longLine"); return false;
  }).join("\n");
}

export function writeArtifactText(path, content, budget) {
  if (Buffer.byteLength(content) > ARTIFACT_LIMITS.textFileBytes) { skip(budget, "fileBytes"); return; }
  if (content.split("\n").some(line => Buffer.byteLength(line) > ARTIFACT_LIMITS.lineBytes)) { skip(budget, "longLine"); return; }
  const safe = redact(content);
  const size = Buffer.byteLength(safe);
  if (size > ARTIFACT_LIMITS.textFileBytes || budget.outputBytes + size > ARTIFACT_LIMITS.outputBytes - ARTIFACT_LIMITS.summaryReserveBytes) { skip(budget, "outputBytes"); return; }
  try {
    writeFileSync(path, safe, "utf8");
    budget.outputBytes += size;
  } catch { skip(budget, "ioError"); }
}

export function copySafeTree(source, target, includeReportJson, options = {}) {
  const budget = options.budget ?? createArtifactBudget();
  const depth = options.depth ?? 0;
  for (const entry of artifactEntries(source, budget, depth)) {
    const targetPath = resolve(target, entry.name);
    if (entry.directory) {
      copySafeTree(entry.path, targetPath, includeReportJson, { ...options, budget, depth: depth + 1 });
      continue;
    }
    const extension = extname(entry.name).toLowerCase();
    if (BINARY_EXTENSIONS.has(extension)) {
      if (!options.allowFailureScreenshots || !FAILURE_SCREENSHOT_EXTENSIONS.has(extension)) continue;
      const image = readArtifactBytes(entry.path, budget, { binary: true });
      if (!image) continue;
      if (budget.outputBytes + image.bytes.length > ARTIFACT_LIMITS.outputBytes - ARTIFACT_LIMITS.summaryReserveBytes) { skip(budget, "outputBytes"); continue; }
      try { mkdirSync(target, { recursive: true }); writeFileSync(targetPath, image.bytes); budget.outputBytes += image.bytes.length; }
      catch { skip(budget, "ioError"); }
      continue;
    }
    if (!TEXT_EXTENSIONS.has(extension) || (extension === ".json" && !includeReportJson)) continue;
    const content = readArtifactText(entry.path, budget);
    if (content === undefined) continue;
    try { mkdirSync(target, { recursive: true }); writeArtifactText(targetPath, content, budget); }
    catch { skip(budget, "ioError"); }
  }
  return budget;
}

export function redact(value) {
  let safe = value.replace(/\bsb_secret_[A-Za-z0-9_-]+/g, "[REDACTED_KEY]")
    .replace(/(["']?(?:SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_ANON_KEY|ADMIN_SESSION_SECRET|password|passwd|token|access_token|refresh_token|secret|signedUrl|signed_url|authorization|cookie|set-cookie)["']?\s*[:=]\s*)(["']?)[^\s,"'}]+\2/gi, "$1$2[REDACTED]$2")
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
