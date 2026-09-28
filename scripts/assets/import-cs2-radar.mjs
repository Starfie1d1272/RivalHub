// Import only Valve CS2 overview images already extracted by Mizar's pinned importer.
// Usage: node scripts/assets/import-cs2-radar.mjs /path/to/Mizar
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

const source = resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("Provide the pinned Mizar checkout path.");
const manifest = JSON.parse(readFileSync(join(source, "packages/cs2-assets/generated/radar-maps.json"), "utf8"));
if (manifest.schemaVersion !== 1 || manifest.source.appId !== 730 || manifest.source.steamBuildId !== "25218825") throw new Error("Radar source build changed; review provenance before importing.");
const target = resolve("public/assets/cs2/maps");
mkdirSync(target, { recursive: true });
const urls = {};
const provenance = {};
for (const [mapName, layers] of Object.entries(manifest.maps)) {
  urls[mapName] = {};
  for (const [layer, asset] of Object.entries(layers)) {
    const input = join(source, "packages/cs2-assets/generated/public", asset.outputPath);
    const bytes = readFileSync(input);
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (hash !== asset.outputSha256) throw new Error(`Hash mismatch: ${mapName}/${layer}`);
    const destination = join(target, asset.outputPath.split("/").at(-1));
    writeFileSync(destination, bytes);
    urls[mapName][layer] = `/assets/cs2/maps/${asset.outputPath.split("/").at(-1)}`;
    provenance[`${mapName}.${layer}`] = { sourcePath: asset.sourcePath, sourceSha256: asset.sourceSha256, outputSha256: hash };
  }
}
const output = resolve("src/components/matches/cs2-radar-assets.ts");
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `// Generated from pinned Valve CS2 build 25218825 via Mizar radar-maps.json.\nexport const CS2_RADAR_ASSETS = ${JSON.stringify(urls, null, 2)} as const;\n`);
writeFileSync(join(target, "provenance.json"), JSON.stringify({ owner: "Valve / Counter-Strike 2 game asset", steamBuildId: manifest.source.steamBuildId, source: "Mizar/packages/cs2-assets/generated/radar-maps.json", assets: provenance }, null, 2) + "\n");
