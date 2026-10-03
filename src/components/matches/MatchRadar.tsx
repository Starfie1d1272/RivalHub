"use client";

import React, { useEffect, useMemo, useState } from "react";
import { RadarView, fromPublicRadar, getRadarArtwork, radarAssetUrl } from "@mizar-hud/radar-view";
import "@mizar-hud/radar-view/radar.css";
import { liveBoundary, type LiveFreshness } from "@/lib/mizar/live-viewer-state";
import type { PublicLiveMatchProjection } from "@/lib/mizar/live-projection";

export const RADAR_ASSET_BASE = "/vendor/radar/0.1.0";

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
    const images = Object.values(artwork.artwork).map(path => new Promise<void>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("radar_artwork_unavailable"));
      image.src = radarAssetUrl(path, assetBaseUrl);
    }));
    void Promise.all(images).then(() => { if (!cancelled) setLoaded({ key: assetKey, ok: true }); }, () => { if (!cancelled) setLoaded({ key: assetKey, ok: false }); });
    return () => { cancelled = true; };
  }, [compatible, artwork, assetBaseUrl, assetKey]);
  const frame = useMemo(() => fromPublicRadar(radar, {
    boundary: liveBoundary(snapshot), sequence: snapshot.delivery.sequence,
    current: compatible && freshness !== "unavailable", bomb: snapshot.bomb ? { state: snapshot.bomb.state, sourcePlayerId: snapshot.bomb.carrierSourceId } : null,
  }), [radar, snapshot, compatible, freshness]);
  const ready = loaded?.key === assetKey && loaded.ok;
  const failed = !compatible || (loaded?.key === assetKey && !loaded.ok);
  return <div className="min-w-0 border border-[var(--color-border)] bg-[var(--color-panel-lo)]">
    <div className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] px-4 py-3">
      <h3 className="text-sm font-semibold">战术雷达</h3>
      <span className="text-xs text-[var(--color-fg-dim)]">{radar?.layers.length === 2 ? "上下层" : "全图"}{freshness === "stale" ? " · 画面已暂停" : ""}</span>
    </div>
    <div className="relative aspect-square p-2" aria-label="比赛战术雷达">
      {ready && compatible ? <RadarView snapshot={frame} paused={freshness === "stale"} presentationRevision={revision} assetBaseUrl={assetBaseUrl} /> : <div className="flex h-full items-center justify-center p-6 text-center text-sm text-[var(--color-fg-dim)]" role="status">{failed ? "雷达暂不可用，比赛数据仍可查看" : "正在加载地图…"}</div>}
    </div>
  </div>;
}
