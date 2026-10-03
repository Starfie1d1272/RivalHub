import provenance from "../../public/images/maps/provenance.json";

/** Decorative scene art only; radar geometry remains owned by radar-view. */
export function mapThumbnail(mapName: string): string | null {
  const key = `map.${mapName.startsWith("de_") ? mapName : `de_${mapName.toLowerCase()}`}`;
  const asset = (provenance.assets as Record<string, { outputPath: string }>)[key];
  return asset ? `/images/maps/${asset.outputPath.split("/").at(-1)}` : null;
}
