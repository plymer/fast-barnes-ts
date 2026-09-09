import { describe, expect, it } from "vitest";
import type { Position } from "geojson";
import { generateIsoareas } from "../src/march/isoareas";
import type { PolylinesWithLevels } from "../src/march/types";

describe("generateIsoareas", () => {
  it("closes open polylines using the shortest arc on the same boundary ring", () => {
    const boundaries = [
      [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
        [0, 0],
      ],
    ];

    const polylines: PolylinesWithLevels = {
      polylines: [
        [
          [3, 0],
          [3.2, 0.8],
          [4, 1],
        ],
      ],
      levelValues: [0.5, 1],
      levelIndex: Uint8Array.from([0]),
    };

    const result = generateIsoareas(polylines, boundaries, { shape: [5, 4] });
    const ring = result.polygons[0]?.[0];

    expect(ring).toBeDefined();
    expect(ring).toContainEqual([4, 0]);
    expect(ring).not.toContainEqual([0, 3]);
    expect(ring?.[0]).toEqual(ring?.[ring.length - 1]);
  });

  it("creates adjacent threshold bands and holes from the next level", () => {
    const boundaries: Position[][] = [];

    const polylines: PolylinesWithLevels = {
      polylines: [
        [
          [0, 0],
          [4, 0],
          [4, 4],
          [0, 4],
          [0, 0],
        ],
        [
          [1, 1],
          [3, 1],
          [3, 3],
          [1, 3],
          [1, 1],
        ],
      ],
      levelValues: [0, 0.5, 1],
      levelIndex: Uint8Array.from([0, 1]),
    };

    const result = generateIsoareas(polylines, boundaries, { shape: [5, 4] });

    expect(result.polygons).toHaveLength(2);
    expect(Array.from(result.levelIndex)).toEqual([0, 1]);
    expect(result.polygons[0]?.[0]).toEqual(polylines.polylines[0]);
    expect(result.polygons[0]?.[1]).toEqual(polylines.polylines[1]);
    expect(result.polygons[1]?.[0]).toEqual(polylines.polylines[1]);
  });
});
