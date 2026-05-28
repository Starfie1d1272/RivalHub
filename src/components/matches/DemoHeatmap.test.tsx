import { describe, it, expect } from "vitest";
import { getCalibration, worldToPixel } from "@/lib/demo/map-calibration";

describe("DemoHeatmap 坐标转换", () => {
  it("de_mirage 已知点映射到 0..1024 像素范围", () => {
    const cal = getCalibration("de_mirage")!;
    // A site（近似点）
    const px = worldToPixel({ x: -400, y: 300, z: 0 }, cal);
    expect(px.x).toBeGreaterThan(0);
    expect(px.x).toBeLessThan(1024);
    expect(px.y).toBeGreaterThan(0);
    expect(px.y).toBeLessThan(1024);
  });

  it("多个点像素坐标不重叠于原点", () => {
    const cal = getCalibration("de_mirage")!;
    const a = worldToPixel({ x: 0, y: 0, z: 0 }, cal);
    const b = worldToPixel({ x: 100, y: -100, z: 0 }, cal);
    expect(a.x).not.toEqual(b.x);
    expect(a.y).not.toEqual(b.y);
  });

  it("偏移点产生不同像素坐标", () => {
    const cal = getCalibration("de_mirage")!;
    const p1 = worldToPixel({ x: cal.offsetX + 200, y: cal.offsetY - 200, z: 0 }, cal);
    // x = 200/5 = 40, y = 200/5 = 40
    expect(p1.x).toBeCloseTo(40, 1);
    expect(p1.y).toBeCloseTo(40, 1);
  });
});
