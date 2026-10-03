import "server-only";
import { z } from "zod";
const asset = z.object({ urls: z.array(z.string().url()).min(1) });
const manifest = z.object({ schemaVersion: z.literal("cs2-demo-analysis-kit/uploader-distribution-1"), assets: z.object({ windows: asset, macos: asset }) });
export async function readUploaderDownloads(): Promise<{ windows: string; macos: string } | null> {
  try {
    const response = await fetch("https://dakupdate.starfie1d.top/releases/uploader/latest.json", { next: { revalidate: 300 }, signal: AbortSignal.timeout(2500) });
    if (!response.ok) return null;
    const parsed = manifest.safeParse(await response.json());
    if (!parsed.success) return null;
    const safe = (urls: string[]) => urls.find(value => { const url = new URL(value); return url.protocol === "https:" && url.hostname === "dakupdate.starfie1d.top" && url.pathname.startsWith("/releases/") && !url.username && !url.password; });
    const windows = safe(parsed.data.assets.windows.urls), macos = safe(parsed.data.assets.macos.urls);
    return windows && macos ? { windows, macos } : null;
  } catch { return null; }
}
