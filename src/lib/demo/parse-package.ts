import JSZip from "jszip";
import { manifestSchema, FILE_SCHEMAS, type Manifest } from "./schemas";

/**
 * 这些文件包含 roundNumber 字段，且暖场数据（roundNumber=0）
 * 的 steamId64/side 等字段为 null/unknown，统计时无意义，一律过滤。
 */
const WARMUP_FILTERED_KEYS = new Set([
  "kills", "damages", "blinds", "bombs",
  "grenades", "shots", "clutches",
  "playerEconomies", "rounds", "positions1s",
]);

export interface ParsedDemoPackage {
  manifest: Manifest;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  files: Record<string, any[]>;
}

export async function parseDemoPackage(buffer: Buffer | ArrayBuffer): Promise<ParsedDemoPackage> {
  const zip = await JSZip.loadAsync(buffer);

  const manifestFile = zip.file("manifest.json");
  if (!manifestFile) throw new Error("zip 缺少 manifest.json");

  const manifestRaw = JSON.parse(await manifestFile.async("text"));
  const manifest = manifestSchema.parse(manifestRaw);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const files: Record<string, any[]> = {};

  for (const [key, filename] of Object.entries(manifest.files)) {
    const entry = zip.file(filename);
    if (!entry) throw new Error(`zip 缺少文件: ${filename} (key: ${key})`);

    const raw = JSON.parse(await entry.async("text"));
    const schema = FILE_SCHEMAS[key];

    if (!schema) throw new Error(`未知文件 key: ${key}`);

    const parsed = schema.parse(raw);
    // match.json 是单对象，统一包成数组方便消费者
    let rows = Array.isArray(parsed) ? parsed : [parsed];

    // 过滤暖场数据（roundNumber=0）：exporter 会把暖场击杀/投掷物一并写入，
    // 但 throwerSteamId64/killerSide 等字段全为 null/unknown，对统计无意义。
    if (WARMUP_FILTERED_KEYS.has(key)) {
      rows = rows.filter((r: { roundNumber?: number }) => (r.roundNumber ?? 1) > 0);
    }

    files[key] = rows;
  }

  return { manifest, files };
}
