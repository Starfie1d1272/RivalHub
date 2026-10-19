import { describe, expect, it } from "vitest";
import { lineupStyleAxis, selectLineupStylePoints, type LineupStyleMember } from "./lineup-style";

function member(index: number, qualified = true, maps = 100 - index): LineupStyleMember {
  return { userId: String(index).padStart(2, "0"), name: `Player ${index}`, avatarUrl: null, maps, rounds: maps * 24,
    attributes: ["firepower", "utility", "opening", "clutching"].map((key) => ({ key: key as "firepower", score: index, status: qualified ? "qualified" : "limited" })) };
}
const select = (members: LineupStyleMember[]) => selectLineupStylePoints(members, "firepower", "utility");

describe("lineup chart candidate rules", () => {
  it.each([
    [0, 9, 5], [0, 2, 0], [1, 8, 3], [1, 1, 0], [2, 7, 3], [2, 0, 0],
    [3, 6, 3], [4, 5, 4], [5, 4, 5], [6, 3, 6],
  ])("Q=%i L=%i displays %i members", (q, l, count) => {
    const members = [...Array.from({ length: q }, (_, i) => member(i)), ...Array.from({ length: l }, (_, i) => member(i + q, false))];
    const points = select(members);
    expect(points).toHaveLength(count);
    if (q >= 3) expect(points.every((point) => !point.limited)).toBe(true);
    if (count && q < 3) expect(points.filter((point) => !point.limited)).toHaveLength(q);
  });

  it("extends only Qualified against the fifth member's inclusive 80% map threshold", () => {
    const maps = [200, 150, 120, 110, 100, 80, 79, 70];
    const points = select([...maps.map((maps, index) => member(index, true, maps)), member(8, false, 500)]);
    expect(points.map((point) => point.maps)).toEqual([200, 150, 120, 110, 100, 80]);
  });

  it("orders by personal maps, then rounds, then stable userId and keeps zero scores", () => {
    const members = [member(3, true, 10), member(2, true, 10), member(0, true, 10), member(1, true, 10)];
    members[1].rounds = 300;
    expect(select(members).map((point) => point.userId)).toEqual(["02", "00", "01", "03"]);
    expect(select(members).find((point) => point.userId === "00")?.x).toBe(0);
  });

  it("qualifies each pair independently and excludes either missing or invalid coordinate", () => {
    const members = Array.from({ length: 6 }, (_, i) => member(i));
    members[0].attributes[1].status = "limited";
    members[1].attributes[1].score = null;
    members[2].attributes[0].score = Number.NaN;
    members[3].attributes[1].status = "no-data";
    expect(select(members)).toHaveLength(3);
    expect(select(members).find((point) => point.userId === "00")?.limited).toBe(true);
    expect(selectLineupStylePoints(members, "opening", "clutching")).toHaveLength(6);
    members[0].attributes[0].score = Infinity;
    expect(select(members)).toEqual([]);
  });
});

it("uses outward true-score axes including equal scores and score boundaries", () => {
  expect(lineupStyleAxis([20, 80]).ticks).toEqual([10, 40, 60, 90]);
  expect(lineupStyleAxis([30, 70])).toMatchObject({ min: 25, max: 75 });
  for (const values of [[0, 0], [100, 100], [50, 50], [0, 100], [31, 32]]) {
    const axis = lineupStyleAxis(values);
    expect(axis.min).toBeLessThanOrEqual(Math.min(...values));
    expect(axis.max).toBeGreaterThanOrEqual(Math.max(...values));
    expect(axis.max).toBeGreaterThan(axis.min);
    expect(axis.min).toBeGreaterThanOrEqual(0);
    expect(axis.max).toBeLessThanOrEqual(100);
    expect(axis.ticks[0]).toBe(axis.min);
    expect(axis.ticks.at(-1)).toBe(axis.max);
  }
});
