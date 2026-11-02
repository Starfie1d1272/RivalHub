import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const colocated = join(scriptDir, "capability-contract.ts");
const contractFile = existsSync(colocated) ? colocated : join(scriptDir, "../release/capability-contract.ts");
const { assertCapabilitySnapshots } = await import(pathToFileURL(contractFile).href);

const [path, previousTag, previousCommit, candidateTag, candidateCommit, operatorCommit, transition] = process.argv.slice(2);
const directory = scriptDir;
if (!path || realpathSync(dirname(path)) !== realpathSync(directory) || realpathSync(path) !== join(realpathSync(directory), "capability-evidence.json")) throw new Error("Controller capability evidence required.");
const file = lstatSync(path), parent = statSync(directory);
if (!file.isFile() || file.uid !== process.getuid() || parent.uid !== process.getuid() || (file.mode & 0o077) !== 0 || (parent.mode & 0o077) !== 0 || file.size > 16384) throw new Error("Capability evidence permissions or size invalid.");
const evidence = JSON.parse(readFileSync(path, "utf8"));
const tag = /^v\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/;
const sha = /^[a-f0-9]{40}$/;
if (!tag.test(previousTag ?? "") || !tag.test(candidateTag ?? "") || !sha.test(previousCommit ?? "") || !sha.test(candidateCommit ?? "") || !sha.test(operatorCommit ?? "")
  || evidence.previous?.tag !== previousTag || evidence.previous?.commit !== previousCommit
  || evidence.candidate?.tag !== candidateTag || evidence.candidate?.commit !== candidateCommit || evidence.operatorCommit !== operatorCommit) throw new Error("Capability evidence identity mismatch.");
if (transition === undefined && evidence.version === 1) {
  assertCapabilitySnapshots(evidence.previous.capabilities, evidence.candidate.capabilities);
} else if (transition === "instance-v2-to-v3" && evidence.version === 2 && evidence.transition === transition
  && /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(evidence.maintenanceWindow ?? "")) {
  assertCapabilitySnapshots(evidence.previous.capabilities, evidence.previous.capabilities);
  assertCapabilitySnapshots(evidence.candidate.capabilities, evidence.candidate.capabilities);
} else throw new Error("Invalid release capability transition.");
