export interface MapCalibration {
  offsetX: number;
  offsetY: number;
  scale: number;
  radar: string;
}

type Vec3 = { x: number; y: number; z: number };

// SimpleRadar 标准标定值 — 来源：omar2535/CSRadar data.json
const CALIBRATIONS: Record<string, MapCalibration> = {
  de_ancient: {
    offsetX: -2953,
    offsetY: 2164,
    scale: 5,
    radar: "/maps/radars/de_ancient.png",
  },
  de_anubis: {
    offsetX: -2796,
    offsetY: 3328,
    scale: 5.22,
    radar: "/maps/radars/de_anubis.png",
  },
  de_dust2: {
    offsetX: -2476,
    offsetY: 3239,
    scale: 4.4,
    radar: "/maps/radars/de_dust2.png",
  },
  de_inferno: {
    offsetX: -2087,
    offsetY: 3870,
    scale: 4.9,
    radar: "/maps/radars/de_inferno.png",
  },
  de_mirage: {
    offsetX: -3230,
    offsetY: 1713,
    scale: 5.0,
    radar: "/maps/radars/de_mirage.png",
  },
  de_nuke: {
    offsetX: -3453,
    offsetY: 2887,
    scale: 7,
    radar: "/maps/radars/de_nuke.png",
  },
  de_overpass: {
    offsetX: -4831,
    offsetY: 1781,
    scale: 5.2,
    radar: "/maps/radars/de_overpass.png",
  },
  de_vertigo: {
    offsetX: -3168,
    offsetY: 1762,
    scale: 4.0,
    radar: "/maps/radars/de_vertigo.png",
  },
};

/** 获取某地图的 radar 标定，未知地图返回 null */
export function getCalibration(mapName: string): MapCalibration | null {
  return CALIBRATIONS[mapName] ?? null;
}

/** 世界坐标 → radar 像素（SimpleRadar 公式） */
export function worldToPixel(
  p: Vec3,
  cal: MapCalibration,
): { x: number; y: number } {
  return {
    x: (p.x - cal.offsetX) / cal.scale,
    y: (cal.offsetY - p.y) / cal.scale,
  };
}
