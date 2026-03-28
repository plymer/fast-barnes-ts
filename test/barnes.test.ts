import { describe, expect, it } from "vitest";
import {
  barnes,
  fromSamples,
  getHalfKernelSizeOpt,
  toSamples,
  toNestedArray,
} from "../src";
import { tupleArrayToBarnesSamples } from "../src/barnes";

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

    const tupleSamples = tupleArrayToBarnesSamples(tupleArray);

    const pointsAndValues = barnes(
      tupleArray.map(([x, y]) => [x, y]),
      tupleArray.map(([_, __, v]) => v),
      0.8,
      [0, 0],
      0.5,
      [8, 6],
    );

    const objectInput = barnes(tupleSamples, 0.8, [0, 0], 0.5, [8, 6]);

    expect(objectInput.shape).toEqual(pointsAndValues.shape);
    expect(objectInput.dimension).toBe(pointsAndValues.dimension);

    for (let i = 0; i < pointsAndValues.data.length; i++) {
      const a = pointsAndValues.data[i];
      const b = objectInput.data[i];
      if (Number.isNaN(a) && Number.isNaN(b)) continue;
      expect(Math.abs(a - b)).toBeLessThan(1e-6);
    }
  });

  it("computes optimized half-kernel size", () => {
    expect(getHalfKernelSizeOpt(1.0, 0.25, 4)).toBeTypeOf("number");
    expect(getHalfKernelSizeOpt([1.0, 0.5], [0.25, 0.25], 4)).toEqual([3, 1]);
  });

  it("accepts sample object input and matches classic API", () => {
    const points = [
      [0.2, 0.2],
      [1.2, 1.1],
      [2.5, 0.7],
      [2.9, 2.4],
      [0.4, 2.0],
    ];
    const values = [1.0, 2.0, 0.5, 1.2, 1.7];

    const samples = points.map((point, i) => ({ point, value: values[i] }));

    const classic = barnes(points, values, 0.8, [0, 0], 0.25, [16, 12], {
      method: "optimized_convolution",
      numIter: 4,
    });

    const objectInput = barnes(samples, 0.8, [0, 0], 0.25, [16, 12], {
      method: "optimized_convolution",
      numIter: 4,
    });

    expect(objectInput.shape).toEqual(classic.shape);
    expect(objectInput.dimension).toBe(classic.dimension);

    for (let i = 0; i < classic.data.length; i++) {
      const a = classic.data[i];
      const b = objectInput.data[i];
      if (Number.isNaN(a) && Number.isNaN(b)) continue;
      expect(Math.abs(a - b)).toBeLessThan(1e-6);
    }
  });

  it("converts point/value arrays to sample objects", () => {
    const points2d = [
      [0.1, 0.2],
      [1.1, 1.2],
    ];
    const values2d = [10, 20];
    const obs2d = toSamples(points2d, values2d);

    expect(obs2d).toEqual([
      { point: [0.1, 0.2], value: 10 },
      { point: [1.1, 1.2], value: 20 },
    ]);

    const points1d = [1, 2, 3];
    const values1d = [5, 6, 7];
    const obs1d = toSamples(points1d, values1d);

    expect(obs1d).toEqual([
      { point: 1, value: 5 },
      { point: 2, value: 6 },
      { point: 3, value: 7 },
    ]);
  });

  it("converts sample objects back to point/value arrays", () => {
    const obs2d = [
      { point: [0.1, 0.2], value: 10 },
      { point: [1.1, 1.2], value: 20 },
    ] as const;

    const back2d = fromSamples(obs2d);
    expect(back2d.points).toEqual([
      [0.1, 0.2],
      [1.1, 1.2],
    ]);
    expect(back2d.values).toEqual([10, 20]);

    const obs1d = [
      { point: 1, value: 5 },
      { point: 2, value: 6 },
      { point: 3, value: 7 },
    ] as const;

    const back1d = fromSamples(obs1d);
    expect(back1d.points).toEqual([1, 2, 3]);
    expect(back1d.values).toEqual([5, 6, 7]);
  });
});
