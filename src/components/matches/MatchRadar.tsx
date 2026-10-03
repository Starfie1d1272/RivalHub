"use client";

import React, { useEffect, useMemo, useState } from "react";
import { RadarView, fromPublicRadar, getRadarArtwork, radarAssetUrl } from "@mizar-hud/radar-view";
import "@mizar-hud/radar-view/radar.css";
import { liveBoundary, type LiveFreshness } from "@/lib/mizar/live-viewer-state";
import type { PublicLiveMatchProjection } from "@/lib/mizar/live-projection";

const RADAR_ASSET_BASE = "/vendor/radar/0.1.0";

export function MatchRadar({ snapshot, freshness, revision, assetBaseUrl = RADAR_ASSET_BASE }: {
  snapshot: PublicLiveMatchProjection;
  freshness: LiveFreshness;
  revision: number;
  assetBaseUrl?: string;
}) {
  const radar = snapshot.radar;
  const artwork = radar ? getRadarArtwork(radar.mapName) : null;
  const compatible = !!(radar && artwork && radar.calibrationRevision === artwork.calibrationRevision);
  const assetKey = JSON.stringify([assetBaseUrl, radar?.mapName, radar?.calibrationRevision]);
  const [loaded, setLoaded] = useState<{ key: string; ok: boolean } | null>(null);
  useEffect(() => {
    if (!compatible || !artwork) return;
    let cancelled = false;
    const controller = new AbortController();
    const pending: HTMLImageElement[] = [];
    const timeout = setTimeout(() => {
      controller.abort();
      if (!cancelled) setLoaded({ key: assetKey, ok: false });
    }, 10000);
    const preload = (path: string) => new Promise<void>((resolve, reject) => {
      const image = new Image();
      pending.push(image);
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("radar_asset_unavailable"));
      image.src = radarAssetUrl(path, assetBaseUrl);
    });
    // Paths come from the published package, including its C4/utility icons.
    const assets = fetch(`${assetBaseUrl}/viewer-assets.json`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("radar_assets_unavailable");
        const icons: string[] = await response.json();
        await Promise.all([...Object.values(artwork.artwork), ...icons].map(preload));
      });
    void assets.then(() => { if (!cancelled && !controller.signal.aborted) setLoaded({ key: assetKey, ok: true }); }, () => { if (!cancelled) setLoaded({ key: assetKey, ok: false }); }).finally(() => clearTimeout(timeout));
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      controller.abort();
      for (const image of pending) { image.onload = null; image.onerror = null; }
    };
  }, [compatible, artwork, assetBaseUrl, assetKey]);
  const frame = useMemo(() => fromPublicRadar(radar, {
    boundary: liveBoundary(snapshot), // Accepted heartbeats can share the gameplay cursor; the package needs a new presentation sequence.
    sequence: Date.parse(snapshot.receivedAt),
    current: compatible && freshness !== "unavailable", bomb: snapshot.bomb ? { state: snapshot.bomb.state, sourcePlayerId: snapshot.bomb.carrierSourceId } : null,
  }), [radar, snapshot, compatible, freshness]);
  const ready = loaded?.key === assetKey && loaded.ok;
  const failed = !compatible || (loaded?.key === assetKey && !loaded.ok);
  return <div className="min-w-0 border border-[var(--color-border)] bg-[var(--color-panel-low)]">
    <div className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] px-4 py-3">
      <h3 className="text-sm font-semibold">战术雷达</h3>
      <span className="text-xs text-[var(--color-fg-dim)]">{radar?.layers.length === 2 ? "上下层" : "全图"}{freshness === "stale" ? " · 画面已暂停" : ""}</span>
    </div>
    <div className="relative aspect-square p-2" aria-label="比赛战术雷达">
      {ready && compatible ? <RadarView snapshot={frame} paused={freshness === "stale"} presentationRevision={revision} assetBaseUrl={assetBaseUrl} /> : <div className="flex h-full items-center justify-center p-6 text-center text-sm text-[var(--color-fg-dim)]" role="status">{failed ? "雷达暂不可用，比赛数据仍可查看" : "正在加载地图…"}</div>}
    </div>
  </div>;
}
