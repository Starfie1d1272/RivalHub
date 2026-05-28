import { describe, it, expect } from "vitest";
import { worldToPixel, getCalibration } from "./map-calibration";

describe("worldToPixel", () => {
  it("用 de_mirage 标定把世界坐标映射到 0..1024 像素", () => {
    const cal = getCalibration("de_mirage")!;
    const px = worldToPixel({ x: cal.offsetX, y: cal.offsetY, z: 0 }, cal);
    expect(px.x).toBeCloseTo(0, 1);
    expect(px.y).toBeCloseTo(0, 1);
  });

  it("未知地图返回 null 标定", () => {
    expect(getCalibration("de_unknown")).toBeNull();
  });

  it("de_mirage 标定存在且有正确字段", () => {
    const cal = getCalibration("de_mirage");
    expect(cal).not.toBeNull();
    expect(cal!.offsetX).toBe(-3230);
    expect(cal!.offsetY).toBe(1713);
    expect(cal!.scale).toBe(5.0);
    expect(cal!.radar).toBe("/maps/radars/de_mirage.png");
  });
});
