import { describe, expect, it } from "vitest";
import { getBarnesParams, type Tuple2DWithValue } from "../src";

describe("getBarnesParams", () => {
  it("returns euclidean params", () => {
    const samples: Tuple2DWithValue[] = [
      [0.2, 0.2, 1.0],
      [1.2, 1.1, 2.0],
      [2.5, 0.7, 0.5],
      [0.4, 1.7, 1.4],
    ];

    const params = getBarnesParams(samples, {
      mode: "euclidean",
      resolution: 32,
    });

    expect(params.size).toEqual([32, 32]);
    expect(params.step[0]).toBeGreaterThan(0);
    expect(params.step[1]).toBeGreaterThan(0);
  });

  it("returns spherical params with projection helpers", () => {
    const samples: Tuple2DWithValue[] = [
      [-128.1540069580078, 52.180999755859375, 1022.9],
      [-93.73300170898438, 49.66400146484375, 1014.1],
      [-122.95500183105469, 50.12900161743164, 1016.8],
      [-105.48300170898438, 49.04999923706055, 1016],
    ];

    const params = getBarnesParams(samples, {
      mode: "spherical",
      resolution: 64,
    });

    expect(params.size).toEqual([64, 64]);
    expect(params.step[0]).toBeGreaterThan(0);
    expect(params.step[1]).toBeGreaterThan(0);

    const [mx, my] = params.project(samples[0][0], samples[0][1]);
    expect(Number.isFinite(mx)).toBe(true);
    expect(Number.isFinite(my)).toBe(true);

    const [lon, lat] = params.unproject(mx, my);
    expect(lon).toBeCloseTo(samples[0][0], 6);
    expect(lat).toBeCloseTo(samples[0][1], 6);
  });

  it("throws a clear error for swapped spherical coordinates", () => {
    const swappedSamples: Tuple2DWithValue[] = [
      [52.180999755859375, -128.1540069580078, 1022.9],
      [49.66400146484375, -93.73300170898438, 1014.1],
      [50.12900161743164, -122.95500183105469, 1016.8],
      [49.04999923706055, -105.48300170898438, 1016],
    ];

    expect(() =>
      getBarnesParams(swappedSamples, {
        mode: "spherical",
        resolution: 64,
      }),
    ).toThrow(/Coordinates appear swapped; expected \[longitude, latitude\]/i);
  });

  it("throws for negative spherical padding", () => {
    const samples: Tuple2DWithValue[] = [
      [-128.1540069580078, 52.180999755859375, 1022.9],
      [-93.73300170898438, 49.66400146484375, 1014.1],
      [-122.95500183105469, 50.12900161743164, 1016.8],
      [-105.48300170898438, 49.04999923706055, 1016],
    ];

    expect(() =>
      getBarnesParams(samples, {
        mode: "spherical",
        resolution: 64,
        sphericalOptions: {
          lambertPadding: -1,
        },
      }),
    ).toThrow(/lambertPadding\/padding must be >= 0/i);
  });

  it("throws for empty input", () => {
    expect(() =>
      getBarnesParams([], {
        mode: "spherical",
        resolution: 64,
      }),
    ).toThrow(/empty tupleData/i);
  });
});
