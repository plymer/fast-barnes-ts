import { beforeEach, describe, expect, it, vi } from "vitest";

// `barnes` and `getBarnesParams` are wrapped (delegating to their real implementations) so that
// the two unreachable-in-practice defensive branches in generateMarchedIsolines can still be
// exercised, while every other code path runs through the real interpolation/marching-squares/
// extrema logic instead of mocks.
const mocks = vi.hoisted(() => ({
  barnes: vi.fn(),
  getBarnesParams: vi.fn(),
}));

vi.mock("../src/barnes/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/barnes/index.js")>();
  mocks.barnes.mockImplementation(actual.barnes);
  return { ...actual, barnes: mocks.barnes };
});

vi.mock("../src/helpers.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/helpers.js")>();
  mocks.getBarnesParams.mockImplementation(actual.getBarnesParams);
  return { ...actual, getBarnesParams: mocks.getBarnesParams };
});

import {
  convertToGeographicCoordinates,
  generateMarchedIsolines,
  getIsolineThreshold,
  tupleArrayToGeoJson,
  tupleArrayToWKTGeometries,
} from "../src/march/isolines";

// Four corners with contrasting values so Barnes interpolation + marching squares
// produce a couple of real, deterministic isolines.
const tupleData: [number, number, number][] = [
  [-100, 40, 0],
  [-95, 40, 20],
  [-100, 45, 10],
  [-95, 45, 30],
];

const identicalValueTupleData: [number, number, number][] = [
  [-100, 40, 7],
  [-95, 45, 7],
];

// A sharp, isolated peak far above its surrounding samples so a real strict local maximum
// is detectable in the interpolated grid.
const peakTupleData: [number, number, number][] = [
  [-100, 40, 0],
  [-95, 40, 5],
  [-100, 45, 5],
  [-95, 45, 0],
  [-97.5, 42.5, 40],
];
const peakOptions = {
  thresholdStep: 10,
  sigma: 3,
  resolution: [24, 24] as [number, number],
  extrema: true,
  extremaOptions: { minProminence: 0.001 },
  barnesOptions: { method: "naive" as const },
};

describe("march/isolines", () => {
  beforeEach(() => {
    mocks.barnes.mockClear();
    mocks.getBarnesParams.mockClear();
  });

  it("convertToGeographicCoordinates projects line points using x0 and step", () => {
    const lines: [number, number][] = [
      [0, 0],
      [2, 3],
    ];

    const result = convertToGeographicCoordinates(lines, [10, 20], [2, 4], (x, y) => [x + 0.5, y - 0.5]);

    expect(result).toEqual([
      [10.5, 19.5],
      [14.5, 31.5],
    ]);
  });

  it("getIsolineThreshold returns threshold from level index", () => {
    const polylines = {
      polylines: [],
      levelValues: [1, 5, 9],
      polylineLevelIndex: Uint8Array.from([2, 0]),
    };

    expect(getIsolineThreshold(polylines, 0)).toBe(9);
    expect(getIsolineThreshold(polylines, 1)).toBe(1);
  });

  it("generateMarchedIsolines computes thresholds and returns converted polylines", () => {
    const result = generateMarchedIsolines(tupleData, {
      thresholdStep: 10,
      sigma: 1,
      resolution: [8, 8],
    });

    expect(result.levelValues).toEqual([0, 10, 20, 30]);
    expect(Array.from(result.polylineLevelIndex)).toEqual([1, 2]);
    expect(result.polylines).toEqual([
      [
        [-97.5, 39.778510987947044],
        [-97.5, 40.56348389345413],
        [-97.50410891656452, 41.34881565772329],
        [-97.65135244668356, 42.13426243654004],
        [-97.90825112461825, 42.459870422847644],
        [-98.66691467281478, 42.91409872389869],
        [-98.73832079924904, 43.143351564611805],
        [-99.57810668997627, 43.687104548105054],
        [-99.58575111997772, 43.78847685504141],
        [-100.4517582904279, 44.43984013072469],
      ],
      [
        [-97.5, 45.27575515482147],
        [-97.5, 44.49082534946834],
        [-97.49715197872165, 43.70551603216717],
        [-97.39276087686811, 42.919928970884826],
        [-97.09130471076898, 42.52786202964256],
        [-96.46195449491593, 42.12965088016742],
        [-96.29094767547936, 41.64554767915985],
        [-95.52466656552176, 41.33154104509245],
        [-95.5081211794247, 40.903562702632286],
        [-94.72700580167637, 40.53662733709544],
      ],
    ]);

    expect(result.barnesParams.x0).toEqual([-2.1078025714295903, -2.7218587996561654]);
    expect(result.barnesParams.step).toEqual([0.6022293061227401, 0.7854352832521546]);
    expect(result.barnesParams.size).toEqual([8, 8]);
    expect(result.barnesResult.shape).toEqual([8, 8]);
    expect(result.barnesResult.dimension).toBe(2);
    expect(result.barnesResult.data.length).toBe(64);
  });

  it("generateMarchedIsolines uses a single threshold when all values are identical", () => {
    const result = generateMarchedIsolines(identicalValueTupleData, {
      thresholdStep: 5,
      sigma: 1,
      resolution: [8, 8],
    });

    expect(result.levelValues).toEqual([7]);
  });

  it("generateMarchedIsolines throws when Barnes params cannot be computed", () => {
    mocks.getBarnesParams.mockReturnValueOnce(undefined);

    expect(() =>
      generateMarchedIsolines(tupleData, {
        thresholdStep: 5,
        sigma: 1,
        resolution: [64, 64],
      }),
    ).toThrow("Failed to compute Barnes parameters");
  });

  it("generateMarchedIsolines throws when Barnes shape is not 2D", () => {
    mocks.barnes.mockReturnValueOnce({
      data: new Float32Array([1, 2, 3]),
      shape: [3],
      dimension: 1,
    });

    expect(() =>
      generateMarchedIsolines(tupleData, {
        thresholdStep: 5,
        sigma: 1,
        resolution: [64, 64],
      }),
    ).toThrow("Expected shape to be a tuple of length 2, got 1");
  });

  it("tupleArrayToGeoJson returns isolines as GeoJSON features", () => {
    const result = tupleArrayToGeoJson(tupleData, {
      thresholdStep: 10,
      sigma: 1,
      resolution: [8, 8],
    });

    expect(result.type).toBe("FeatureCollection");
    expect(result.features).toHaveLength(2);
    expect(result.features.every((f) => f.geometry.type === "LineString")).toBe(true);
    expect(result.features.map((f) => f.properties?.value)).toEqual([10, 20]);
  });

  it("tupleArrayToGeoJson appends extrema features when extrema is enabled", () => {
    const result = tupleArrayToGeoJson(peakTupleData, peakOptions);

    expect(result.features).toHaveLength(1);
    expect(result.features[0]).toEqual({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [-97.37585390975204, 42.40755289496434],
      },
      properties: { kind: "max", value: 14 },
    });
  });

  it("tupleArrayToWKTGeometries converts lines to WKT", () => {
    const result = tupleArrayToWKTGeometries(tupleData, {
      thresholdStep: 10,
      sigma: 1,
      resolution: [8, 8],
    });

    expect(result.lineData).toEqual([
      {
        value: 10,
        geometry:
          "LINESTRING(-10853650.350833334 4833808.108210536,-10853650.350833334 4948167.29005794,-10854107.753332943 5063928.837708414,-10870498.828126118 5181112.570903674,-10899096.658135291 5230116.670976003,-10983550.697992193 5298905.922674839,-10991499.591625266 5333816.932298632,-11084984.129343385 5417147.883746073,-11085835.103398431 5432766.625937542,-11182238.580622852 5533762.681015923)",
      },
      {
        value: 20,
        geometry:
          "LINESTRING(-10853650.350833334 5665038.4632564355,-10853650.350833334 5541715.395955089,-10853333.310554903 5419982.633498841,-10841712.546254836 5299792.149674827,-10808154.599352859 5240381.532642701,-10738095.653803213 5180420.344819117,-10719059.261744006 5108031.197676286,-10633757.238790896 5061367.572104634,-10631915.41483585 4998127.573153958,-10544962.048746215 4944232.692044132)",
      },
    ]);
    expect(result.extremaPointData).toEqual([]);
  });

  it("tupleArrayToWKTGeometries includes extrema point data when enabled", () => {
    const result = tupleArrayToWKTGeometries(peakTupleData, peakOptions);

    expect(result.lineData).toEqual([]);
    expect(result.extremaPointData).toEqual([
      {
        kind: "max",
        geometry: "POINT(-10839830.471284878 5222225.74991436)",
        value: 14,
      },
    ]);
  });
});
