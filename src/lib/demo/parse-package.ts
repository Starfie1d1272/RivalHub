import JSZip from "jszip";
import { manifestSchema, FILE_SCHEMAS, type Manifest } from "./schemas";

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
    files[key] = Array.isArray(parsed) ? parsed : [parsed];
  }

  return { manifest, files };
}
