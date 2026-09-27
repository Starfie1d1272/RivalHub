import { execFileSync } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

const root = process.cwd();
const nextDirectory = resolve(root, ".next");
const nextBuildCacheDirectory = resolve(nextDirectory, "cache");
const nextServerDirectory = resolve(nextDirectory, "server");
const vercelDirectory = resolve(root, ".vercel", "output");
const vercelFunctionsDirectory = resolve(vercelDirectory, "functions");
const vercelStaticDirectory = resolve(vercelDirectory, "static");
const publicDirectory = resolve(root, "public");
const nextStaticDirectory = resolve(nextDirectory, "static");

async function walkFiles(path) {
  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch {
    return [];
  }

  const files = [];
  for (const entry of entries) {
    const entryPath = resolve(path, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(entryPath));
    else if (entry.isFile()) files.push(entryPath);
  }
  return files;
}

async function measureDirectory(path) {
  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch {
    return null;
  }

  let bytes = 0;
  let files = 0;
  for (const entry of entries) {
    const entryPath = resolve(path, entry.name);
    if (entry.isDirectory()) {
      const nested = await measureDirectory(entryPath);
      if (nested) {
        bytes += nested.bytes;
        files += nested.files;
      }
    } else if (entry.isFile()) {
      const details = await stat(entryPath);
      bytes += details.size;
      files += 1;
    }
  }
  return { bytes, files };
}

async function fileBytes(path) {
  try {
    const details = await stat(path);
    return details.isFile() ? details.size : null;
  } catch {
    return null;
  }
}

function formatPath(path) {
  return relative(root, path).split(sep).join("/");
}

function buildCommit() {
  const fromEnvironment = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA;
  if (fromEnvironment) return fromEnvironment;
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function packageNameFromTracePath(path) {
  const segments = path.split(/[\\/]+/);
  const nodeModulesIndex = segments.lastIndexOf("node_modules");
  if (nodeModulesIndex < 0 || !segments[nodeModulesIndex + 1]) return null;
  const first = segments[nodeModulesIndex + 1];
  return first.startsWith("@")
    ? `${first}/${segments[nodeModulesIndex + 2] ?? ""}`
    : first;
}

async function traceDependencyHotspots() {
  const traceFiles = (await walkFiles(nextServerDirectory)).filter((path) => path.endsWith(".nft.json"));
  const dependencies = new Map();

  for (const traceFile of traceFiles) {
    let trace;
    try {
      trace = JSON.parse(await readFile(traceFile, "utf8"));
    } catch {
      continue;
    }
    const packageNamesInTrace = new Set();
    for (const tracedPath of Array.isArray(trace.files) ? trace.files : []) {
      const packageName = packageNameFromTracePath(tracedPath);
      if (!packageName) continue;
      const absolutePath = resolve(dirname(traceFile), tracedPath);
      const size = await fileBytes(absolutePath);
      if (size === null) continue;
      const current = dependencies.get(packageName) ?? { files: new Map(), traceCount: 0 };
      current.files.set(absolutePath, size);
      dependencies.set(packageName, current);
      packageNamesInTrace.add(packageName);
    }
    for (const packageName of packageNamesInTrace) {
      dependencies.get(packageName).traceCount += 1;
    }
  }

  return [...dependencies.entries()]
    .map(([name, details]) => ({
      name,
      bytes: [...details.files.values()].reduce((total, size) => total + size, 0),
      files: details.files.size,
      traceCount: details.traceCount,
    }))
    .sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name))
    .slice(0, 12);
}

async function largestFilesUnder(path, limit = 12) {
  const files = await Promise.all((await walkFiles(path)).map(async (file) => ({
    path: formatPath(file),
    bytes: await fileBytes(file),
  })));
  return files.filter((file) => file.bytes !== null)
    .sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path))
    .slice(0, limit);
}

async function largestDirectoriesUnder(path, limit = 12) {
  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch {
    return [];
  }
  const directories = entries.filter((entry) => entry.isDirectory());
  const measurements = await Promise.all(directories.map(async (entry) => {
    const entryPath = resolve(path, entry.name);
    return { path: formatPath(entryPath), ...(await measureDirectory(entryPath)) };
  }));
  return measurements.sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path)).slice(0, limit);
}

const [nextOutput, nextBuildCache, nextServer, vercelOutput, vercelFunctions, vercelStatic, nextStatic, publicAssets] = await Promise.all([
  measureDirectory(nextDirectory),
  measureDirectory(nextBuildCacheDirectory),
  measureDirectory(nextServerDirectory),
  measureDirectory(vercelDirectory),
  measureDirectory(vercelFunctionsDirectory),
  measureDirectory(vercelStaticDirectory),
  measureDirectory(nextStaticDirectory),
  measureDirectory(publicDirectory),
]);

let nextBuildId = null;
try {
  nextBuildId = (await readFile(resolve(nextDirectory, "BUILD_ID"), "utf8")).trim();
} catch {
  // The report can also inspect an adapter output without a Next build directory.
}

const report = {
  build: {
    commit: buildCommit(),
    nextBuildId,
    vercelBuildId: process.env.VERCEL_BUILD_ID ?? null,
  },
  bytes: {
    nextOutputTotal: nextOutput,
    nextBuildCache,
    nextOutputWithoutBuildCache: nextOutput && nextBuildCache
      ? { bytes: Math.max(0, nextOutput.bytes - nextBuildCache.bytes), files: Math.max(0, nextOutput.files - nextBuildCache.files) }
      : nextOutput,
    nextServerAndFunctionOutput: nextServer,
    vercelOutputTotal: vercelOutput,
    vercelFunctions: vercelFunctions,
    nextStatic: nextStatic,
    publicAssets: publicAssets,
    vercelStatic: vercelStatic,
  },
  largestNextRouteArtifacts: await largestFilesUnder(resolve(nextServerDirectory, "app")),
  largestVercelFunctions: await largestDirectoriesUnder(vercelFunctionsDirectory),
  sharedTracedDependencyHotspots: await traceDependencyHotspots(),
};

console.log("BUILD_FOOTPRINT_EVIDENCE");
console.log(JSON.stringify(report, null, 2));
