import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const colocated = join(scriptDir, "capability-contract.ts");
const contractFile = existsSync(colocated) ? colocated : join(scriptDir, "../release/capability-contract.ts");
const { assertReleaseCapabilities } = await import(pathToFileURL(contractFile).href);

const [bundle, previous, candidate] = process.argv.slice(2);
if (!bundle || !/^[a-f0-9]{40}$/.test(previous ?? "") || !/^[a-f0-9]{40}$/.test(candidate ?? "")) throw new Error("Immutable capability evidence required.");
const directory = mkdtempSync(join(tmpdir(), "rivalhub-capability-"));
try {
  // A bare clone checks object hashes; the checked revisions must be the exact
  // host/package identities, never a caller-supplied reader version.
  execFileSync("git", ["clone", "--bare", "--quiet", resolve(bundle), join(directory, "repo")], { stdio: "ignore" });
  assertReleaseCapabilities(join(directory, "repo"), previous, candidate);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
