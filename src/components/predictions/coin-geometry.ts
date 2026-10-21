import { CylinderGeometry } from "three";

/** Faces are upright in their own viewing direction; the edge has real depth. */
export function createCoinGeometry() {
  const radius = .98;
  const geometry = new CylinderGeometry(radius, radius, .14, 128);
  geometry.rotateX(Math.PI / 2);
  const positions = geometry.getAttribute("position");
  const normals = geometry.getAttribute("normal");
  const uv = geometry.getAttribute("uv");
  for (let i = 0; i < positions.count; i++) {
    const facing = normals.getZ(i);
    if (Math.abs(facing) < .99) continue;
    uv.setXY(i, .5 + positions.getX(i) * Math.sign(facing) / (2 * radius), .5 + positions.getY(i) / (2 * radius));
  }
  return geometry;
}
