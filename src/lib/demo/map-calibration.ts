export interface MapCalibration {
  offsetX: number;
  offsetY: number;
  scale: number;
  radar: string;
}

type Vec3 = { x: number; y: number; z: number };

// SimpleRadar 标准标定值
const CALIBRATIONS: Record<string, MapCalibration> = {
  de_mirage: {
    offsetX: -3230,
    offsetY: 1713,
    scale: 5.0,
    radar: "/maps/radars/de_mirage.png",
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
