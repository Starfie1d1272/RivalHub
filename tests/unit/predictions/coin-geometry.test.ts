import { expect, it } from "vitest";
import { createCoinGeometry } from "@/components/predictions/coin-geometry";

it("keeps both artwork faces upright and independently mapped on a real thick coin", () => {
  const geometry = createCoinGeometry();
  const p = geometry.getAttribute("position"), n = geometry.getAttribute("normal"), uv = geometry.getAttribute("uv");
  let front = 0, back = 0;
  for (let i = 0; i < p.count; i++) {
    const z = n.getZ(i);
    if (Math.abs(z) < .99) continue;
    if (z > 0) front++; else back++;
    expect(p.getZ(i)).toBeCloseTo(Math.sign(z) * .07);
    expect(uv.getX(i)).toBeCloseTo(.5 + p.getX(i) * Math.sign(z) / 1.96);
    expect(uv.getY(i)).toBeCloseTo(.5 + p.getY(i) / 1.96);
  }
  expect(front).toBeGreaterThan(100); expect(back).toEqual(front);
  expect(geometry.groups.map(group => group.materialIndex)).toEqual([0, 1, 2]);
  geometry.dispose();
});
