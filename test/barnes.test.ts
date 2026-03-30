import { describe, expect, it } from "vitest";
import { barnes, getHalfKernelSizeOpt, toNestedArray } from "../src";

function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

describe("barnes", () => {
  it("interpolates 1D fields", () => {
    const pts = [0, 1, 2, 4, 6, 9];
    const values = [3, 2, 1, 2, 5, 4];

    const result = barnes(pts, values, 1.2, 0, 0.5, 30);

    expect(result.dimension).toBe(1);
    expect(result.shape).toEqual([30]);
    expect(result.data.length).toBe(30);
    const finiteCount = result.data.filter((v) => Number.isFinite(v)).length;
    expect(finiteCount).toBeGreaterThan(0);
  });

  it("matches naive result closely in 2D for optimized_convolution", () => {
    const rand = lcg(42);

    const points: number[][] = [];
    const values: number[] = [];

    for (let i = 0; i < 120; i++) {
      const x = -3 + rand() * 12;
      const y = 1 + rand() * 10;
      const v = Math.sin(x * 0.7) + Math.cos(y * 0.4);
      points.push([x, y]);
      values.push(v);
    }

    const sigma = 0.9;
    const x0 = [-3, 1];
    const step = 0.25;
    const size = [48, 40] as const;

    const fast = barnes(points, values, sigma, x0, step, size, {
      method: "optimized_convolution",
      numIter: 4,
      maxDist: 3.5,
    });

    const naive = barnes(points, values, sigma, x0, step, size, {
      method: "naive",
    });

    let sq = 0;
    let n = 0;
    for (let i = 0; i < fast.data.length; i++) {
      const a = fast.data[i];
      const b = naive.data[i];
      if (Number.isNaN(a) || Number.isNaN(b)) continue;
      const d = a - b;
      sq += d * d;
      n++;
    }

    const rmse = Math.sqrt(sq / n);
    expect(rmse).toBeLessThan(0.12);
  });

  it("returns nested data in [y, x] order for 2D", () => {
    const points = [
      [0.2, 0.2],
      [1.2, 1.1],
      [2.5, 0.7],
    ];
    const values = [1.0, 2.0, 0.5];
    const result = barnes(points, values, 0.8, [0, 0], 0.5, [8, 6]);

    const nested = toNestedArray(result);
    expect(Array.isArray(nested)).toBe(true);
    expect((nested as number[][]).length).toBe(6);
    expect((nested as number[][])[0].length).toBe(8);
  });

  it("accepts tuple array input as well as points and values", () => {
    const tupleArray: [number, number, number][] = [
      [0.2, 0.2, 1.0],
      [1.2, 1.1, 2.0],
      [2.5, 0.7, 0.5],
    ];

    const pointsAndValues = barnes(
      tupleArray.map(([x, y]) => [x, y]),
      tupleArray.map(([_, __, v]) => v),
      0.8,
      [0, 0],
      0.5,
      [8, 6],
    );

    const tupleInput = barnes(tupleArray, 0.8, [0, 0], 0.5, [8, 6]);

    expect(tupleInput.shape).toEqual(pointsAndValues.shape);
    expect(tupleInput.dimension).toBe(pointsAndValues.dimension);

    for (let i = 0; i < pointsAndValues.data.length; i++) {
      const a = pointsAndValues.data[i];
      const b = tupleInput.data[i];
      if (Number.isNaN(a) && Number.isNaN(b)) continue;
      expect(Math.abs(a - b)).toBeLessThan(1e-6);
    }
  });

  it("accepts 1D tuple array input", () => {
    const tupleArray: [number, number][] = [
      [0, 3],
      [1, 2],
      [2, 1],
      [4, 2],
      [6, 5],
      [9, 4],
    ];

    const tupleInput = barnes(tupleArray, 1.2, 0, 0.5, 30);
    const pointsAndValues = barnes(
      tupleArray.map(([x]) => x),
      tupleArray.map(([, value]) => value),
      1.2,
      0,
      0.5,
      30,
    );

    expect(tupleInput.dimension).toBe(1);
    expect(tupleInput.shape).toEqual(pointsAndValues.shape);

    for (let i = 0; i < tupleInput.data.length; i++) {
      const a = tupleInput.data[i];
      const b = pointsAndValues.data[i];
      if (Number.isNaN(a) && Number.isNaN(b)) continue;
      expect(Math.abs(a - b)).toBeLessThan(1e-6);
    }
  });

  it("accepts 3D tuple array input", () => {
    const tupleArray: [number, number, number, number][] = [
      [0.2, 0.2, 0.1, 1.0],
      [1.2, 1.1, 0.3, 2.0],
      [2.5, 0.7, 0.9, 0.5],
      [0.4, 1.7, 1.2, 1.4],
    ];

    const tupleInput = barnes(
      tupleArray,
      [0.8, 0.8, 0.8],
      [0, 0, 0],
      0.5,
      [8, 6, 5],
    );
    const pointsAndValues = barnes(
      tupleArray.map(([x, y, z]) => [x, y, z]),
      tupleArray.map(([, , , value]) => value),
      [0.8, 0.8, 0.8],
      [0, 0, 0],
      0.5,
      [8, 6, 5],
    );

    expect(tupleInput.dimension).toBe(3);
    expect(tupleInput.shape).toEqual(pointsAndValues.shape);

    for (let i = 0; i < tupleInput.data.length; i++) {
      const a = tupleInput.data[i];
      const b = pointsAndValues.data[i];
      if (Number.isNaN(a) && Number.isNaN(b)) continue;
      expect(Math.abs(a - b)).toBeLessThan(1e-6);
    }
  });

  it("computes optimized half-kernel size", () => {
    expect(getHalfKernelSizeOpt(1.0, 0.25, 4)).toBeTypeOf("number");
    expect(getHalfKernelSizeOpt([1.0, 0.5], [0.25, 0.25], 4)).toEqual([3, 1]);
  });

  it("rejects invalid tuple array entries", () => {
    const tupleArray = [
      [0.2, 0.2, 1.0],
      [1.2, Number.NaN, 2.0],
    ] as [number, number, number][];

    expect(() => barnes(tupleArray, 0.8, [0, 0], 0.25, [16, 12])).toThrow(
      /tupleArray entries must be/,
    );
  });
});
