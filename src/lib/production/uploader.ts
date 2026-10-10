import "server-only";
import { z } from "zod";
const asset = z.object({ urls: z.array(z.string().url()).min(1) });
const manifest = z.object({ schemaVersion: z.literal("cs2-demo-analysis-kit/uploader-distribution-1"), assets: z.object({ windows: asset, macos: asset, windowsInstaller: z.unknown().optional() }) });
export async function readUploaderDownloads(): Promise<{ windows: string; macos: string; windowsZip?: string } | null> {
  try {
    const response = await fetch("https://dakupdate.starfie1d.top/releases/uploader/latest.json", { next: { revalidate: 300 }, signal: AbortSignal.timeout(2500) });
    if (!response.ok) return null;
    const parsed = manifest.safeParse(await response.json());
    if (!parsed.success) return null;
    const safe = (urls: string[]) => urls.find(value => { const url = new URL(value); return url.protocol === "https:" && url.hostname === "dakupdate.starfie1d.top" && url.pathname.startsWith("/releases/") && !url.username && !url.password; });
    const windows = safe(parsed.data.assets.windows.urls), macos = safe(parsed.data.assets.macos.urls);
    if (!windows || !macos) return null;
    // Optional new-release metadata must never invalidate the legacy ZIP/DMG pair.
    const installer = asset.extend({
      name: z.string().regex(/\.exe$/i),
      size: z.number().int().positive(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/i),
    }).safeParse(parsed.data.assets.windowsInstaller);
    const windowsInstaller = installer.success ? safe(installer.data.urls) : undefined;
    return windowsInstaller ? { windows: windowsInstaller, windowsZip: windows, macos } : { windows, macos };
  } catch { return null; }
}
