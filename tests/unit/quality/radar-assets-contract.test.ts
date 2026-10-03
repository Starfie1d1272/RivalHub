import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getRadarArtwork, radarAssetUrl } from "@mizar-hud/radar-view";
import manifest from "../../../package.json";
const base = `/vendor/radar/${manifest.dependencies["@mizar-hud/radar-view"]}`;
const file = (path: string) => resolve("public", `${base}${path}`.replace(/^\//, ""));
describe("published radar static deployment", () => {
  it("copies every required public icon with package provenance and preloads it", () => {
    const provenance = JSON.parse(readFileSync(file("/icon-provenance.json"), "utf8"));
    const preload: string[] = JSON.parse(readFileSync(file("/viewer-assets.json"), "utf8"));
    for (const id of ["objective.c4", "utility.smokegrenade", "utility.flashbang", "utility.hegrenade", "utility.decoy", "utility.molotov", "utility.incgrenade"]) {
      const asset = provenance.assets[id];
      expect(preload, id).toContain(asset.outputPath);
      expect(createHash("sha256").update(readFileSync(file(asset.outputPath))).digest("hex"), id).toBe(asset.outputSha256);
    }
  });
  it("resolves single and multi-floor artwork under the versioned deployment prefix", () => {
    for (const map of ["de_ancient", "de_nuke"]) {
      const artwork = getRadarArtwork(map)!;
      expect(artwork).toBeTruthy();
      for (const path of Object.values(artwork.artwork)) {
        expect(radarAssetUrl(path, base)).toBe(`${base}${path}`);
        expect(existsSync(file(path)), path).toBe(true);
      }
    }
  });
});
