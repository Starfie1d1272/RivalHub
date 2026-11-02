import { execFileSync, spawnSync } from "node:child_process";

type Version = { readerVersion: number; publisherVersion: number };
type Contract = Version & { capabilities: Record<string, Version> };
type Snapshot = Record<string, Contract>;
const contracts = [
  { key: "betCatalog", path: "src/lib/bet/catalog-contract.json", minimum: 1, label: "BET catalog" },
  { key: "betLedger", path: "src/lib/bet/ledger-contract.json", minimum: 0, label: "BET ledger" },
  { key: "vetoLifecycle", path: "src/lib/matches/veto-room/lifecycle-contract.json", minimum: 0, label: "Veto lifecycle" },
  { key: "publicAsset", path: "src/lib/assets-contract.json", minimum: 0, label: "Public asset" },
  { key: "competitionFormat", path: "src/lib/competition/release-contract.json", minimum: 0, label: "Competition format" },
] as const;

function version(value: unknown, minimum: number, label: string): Version {
  const v = value as Partial<Version> | null;
  if (!v || typeof v !== "object" || Array.isArray(v) || !Number.isInteger(v.readerVersion) || !Number.isInteger(v.publisherVersion)
    || Number(v.publisherVersion) < minimum || Number(v.readerVersion) < Number(v.publisherVersion)) throw new Error(`${label}${label.includes(" capability ") ? "" : " contract"} 无效；release capability gate 拒绝继续。`);
  return { readerVersion: Number(v.readerVersion), publisherVersion: Number(v.publisherVersion) };
}

function contract(value: unknown, minimum: number, label: string): Contract {
  const root = value as Record<string, unknown> | null;
  if (root?.releaseReady === false) throw new Error(`${label} contract 尚未完成 reader 验收；release capability gate 拒绝继续。`);
  if (root?.releaseReady !== undefined && root.releaseReady !== true) throw new Error(`${label} releaseReady 无效。`);
  const base = version(root, minimum, label);
  const declared = root?.capabilities;
  if (declared !== undefined && (!declared || typeof declared !== "object" || Array.isArray(declared))) throw new Error(`${label} capabilities 无效。`);
  const capabilities = Object.create(null) as Record<string, Version>;
  for (const [name, raw] of Object.entries(declared ?? {})) capabilities[name] = version(raw, 0, `${label} capability ${name}`);
  return { ...base, capabilities };
}

/** The controller resolves capabilities from immutable Git commits, never from a candidate's claims about its predecessor. */
export function readReleaseCapabilities(cwd: string, revision: string): Snapshot {
  const snapshot: Snapshot = Object.create(null);
  for (const item of contracts) {
    const present = execFileSync("git", ["ls-tree", "--name-only", revision, "--", item.path], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    if (!present) {
      const legacyReader = item.key === "publicAsset" && spawnSync("git", ["merge-base", "--is-ancestor", "96d04bba33d8e43e9f2b7e16e858628fb519aa0d", revision], { cwd, stdio: "ignore" }).status === 0;
      snapshot[item.key] = { readerVersion: legacyReader ? 1 : item.minimum, publisherVersion: item.minimum, capabilities: {} };
    } else {
      snapshot[item.key] = contract(JSON.parse(execFileSync("git", ["show", `${revision}:${item.path}`], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })), item.minimum, item.label);
    }
  }
  return snapshot;
}

/** Shared comparison for controller Git reads and host's bounded evidence. */
export function assertCapabilitySnapshots(before: Snapshot, after: Snapshot): void {
  if (!before || !after || Object.keys(before).sort().join(",") !== contracts.map(x => x.key).sort().join(",") || Object.keys(after).sort().join(",") !== contracts.map(x => x.key).sort().join(",")) throw new Error("Release capability evidence 无效。");
  for (const item of contracts) {
    const a = contract(before[item.key], item.minimum, item.label), b = contract(after[item.key], item.minimum, item.label);
    const check = (oldVersion: Version, newVersion: Version, label: string) => {
      if (newVersion.publisherVersion > oldVersion.readerVersion || newVersion.readerVersion < oldVersion.publisherVersion) throw new Error(`${label} compatibility gate：必须先独立发布兼容读取版本，不能合并为一次发布或降级到不兼容版本。`);
    };
    check(a, b, item.label);
    for (const name of new Set([...Object.keys(a.capabilities), ...Object.keys(b.capabilities)])) check(a.capabilities[name] ?? { readerVersion: 0, publisherVersion: 0 }, b.capabilities[name] ?? { readerVersion: 0, publisherVersion: 0 }, `${item.label} capability ${name}`);
  }
}

export function assertReleaseCapabilities(cwd: string, previous: string, candidate: string): void {
  assertCapabilitySnapshots(readReleaseCapabilities(cwd, previous), readReleaseCapabilities(cwd, candidate));
}
