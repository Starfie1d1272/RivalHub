import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, normalize } from "node:path";

function specsIn(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = `${directory}/${entry.name}`;
    return entry.isDirectory() ? (entry.name === "harness" ? [] : specsIn(path)) : /\.test\.ts$/.test(path) ? [path] : [];
  }).sort();
}

// Include imports, dynamic imports and vi.mock references. Extra literal paths
// may over-select, but cannot hide a consumer behind a mock or an alias.
function dependencies(path, visited) {
  if (visited.has(path)) return;
  visited.add(path);
  const source = readFileSync(path, "utf8");
  for (const match of source.matchAll(/["'](@\/[^"'\n]+|\.\.?\/[^"'\n]+)["']/g)) {
    const base = normalize(match[1].startsWith("@/") ? `src/${match[1].slice(2)}` : `${dirname(path)}/${match[1]}`);
    const resolved = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.mjs`, `${base}/index.ts`, `${base}/index.tsx`]
      .find(candidate => /\.[cm]?[jt]sx?$/.test(candidate) && existsSync(candidate));
    if (resolved) dependencies(resolved, visited);
  }
}

export function postgresSpecsForSource(path) {
  // Migration replay, schema, environment and provider infrastructure always
  // use FULL. Only a known executable source consumer may narrow the suite.
  if (!path.startsWith("src/") || path.startsWith("src/db/") || !existsSync(path)) return null;
  const impacted = specsIn("tests/integration/db").filter(spec => {
    const visited = new Set();
    dependencies(spec, visited);
    return visited.has(path);
  });
  return impacted.length > 0 ? impacted : null;
}
