import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Feature, Point as GeoJsonPoint } from "geojson";

const mocks = vi.hoisted(() => ({
  barnes: vi.fn(),
  getBarnesParams: vi.fn(),
  lonLatToWebMercator: vi.fn(),
  marchingSquares: vi.fn(),
  getExtremaAsGeoJson: vi.fn(),
  getExtremaLocations: vi.fn(),
}));

vi.mock("../src/barnes.js", () => ({
  barnes: mocks.barnes,
}));

vi.mock("../src/helpers.js", () => ({
  getBarnesParams: mocks.getBarnesParams,
  lonLatToWebMercator: mocks.lonLatToWebMercator,
}));

vi.mock("../src/march/march.js", () => ({
  marchingSquares: mocks.marchingSquares,
}));

vi.mock("../src/extrema/index.js", () => ({
  getExtremaAsGeoJson: mocks.getExtremaAsGeoJson,
  getExtremaLocations: mocks.getExtremaLocations,
}));

import {
  convertToGeographicCoordinates,
  generateMarchedIsolines,
  getIsolineThreshold,
  tupleArrayToGeoJson,
  tupleArrayToWKTGeometries,
} from "../src/march/isolines";

const tupleData: [number, number, number][] = [
  [1, 2, 10],
  [3, 4, 20],
];

const defaultBarnesParams = {
  x0: [100, 200] as [number, number],
  step: [10, 20] as [number, number],
  size: [3, 3] as [number, number],
  project: (lon: number, lat: number): [number, number] => [lon + 1, lat + 2],
  unproject: (x: number, y: number): [number, number] => [x / 10, y / 10],
};

describe("march/isolines", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.getBarnesParams.mockReturnValue(defaultBarnesParams);

    mocks.barnes.mockReturnValue({
      data: new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9]),
      shape: [3, 3],
      dimension: 2,
    });

    mocks.marchingSquares.mockReturnValue({
      polylines: [
        [
          [0, 0],
          [1, 1],
        ],
        [
          [2, 2],
          [3, 3],
        ],
      ],
      levelValues: [0, 5, 10],
      polylineLevelIndex: Uint8Array.from([1, 2]),
    });

    mocks.lonLatToWebMercator.mockImplementation((lon: number, lat: number) => ({
      x: lon * 2,
      y: lat * 3,
    }));

    const extremaGeoJson: Feature<GeoJsonPoint, { kind: "max" | "min"; value: number }> = {
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [50, 60],
      },
      properties: {
        kind: "max",
        value: 999,
      },
    };

    mocks.getExtremaAsGeoJson.mockReturnValue([extremaGeoJson]);
    mocks.getExtremaLocations.mockReturnValue([
      {
        field: "temp",
        kind: "max",
        geometry: "POINT(1000 2000)",
        value: 999,
      },
    ]);
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
      thresholdStep: 5,
      sigma: 1,
      resolution: [64, 64],
    });

    expect(mocks.getBarnesParams).toHaveBeenCalledWith(tupleData, {
      mode: "spherical",
      resolution: [64, 64],
      sphericalOptions: { standardParallels: [42.5, 65.5] },
    });

    expect(mocks.barnes).toHaveBeenCalledWith(
      [
        [2, 4],
        [4, 6],
      ],
      [10, 20],
      1,
      [100, 200],
      [10, 20],
      [3, 3],
      undefined,
    );

    expect(mocks.marchingSquares).toHaveBeenCalledWith([10, 15, 20], expect.any(Float32Array), [3, 3]);

    expect(result.polylines).toEqual([
      [
        [10, 20],
        [11, 22],
      ],
      [
        [12, 24],
        [13, 26],
      ],
    ]);

    expect(result.levelValues).toEqual([0, 5, 10]);
    expect(Array.from(result.polylineLevelIndex)).toEqual([1, 2]);
    expect(result.barnesParams).toBe(defaultBarnesParams);
    expect(result.barnesResult.shape).toEqual([3, 3]);
  });

  it("generateMarchedIsolines uses a single threshold when all values are identical", () => {
    generateMarchedIsolines(
      [
        [1, 2, 7],
        [3, 4, 7],
      ],
      {
        thresholdStep: 5,
        sigma: 1,
        resolution: [64, 64],
      },
    );

    expect(mocks.marchingSquares).toHaveBeenCalledWith([7], expect.any(Float32Array), [3, 3]);
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
      thresholdStep: 5,
      sigma: 1,
      resolution: [64, 64],
    });

    expect(result.type).toBe("FeatureCollection");
    expect(result.features).toHaveLength(2);

    expect(result.features[0]).toEqual({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [10, 20],
          [11, 22],
        ],
      },
      properties: { value: 5 },
    });

    expect(mocks.getExtremaAsGeoJson).not.toHaveBeenCalled();
  });

  it("tupleArrayToGeoJson appends extrema features when extrema is enabled", () => {
    const result = tupleArrayToGeoJson(tupleData, {
      thresholdStep: 5,
      sigma: 1,
      resolution: [64, 64],
      extrema: true,
      extremaOptions: { radius: 2 },
    });

    expect(mocks.getExtremaAsGeoJson).toHaveBeenCalledWith(
      {
        data: expect.any(Float32Array),
        shape: [3, 3],
        dimension: 2,
      },
      [100, 200],
      [10, 20],
      { radius: 2 },
      defaultBarnesParams.unproject,
    );

    expect(result.features).toHaveLength(3);
    expect(result.features[2]?.geometry.type).toBe("Point");
  });

  it("tupleArrayToWKTGeometries converts lines and includes extrema point data", () => {
    const result = tupleArrayToWKTGeometries(tupleData, "temp", {
      thresholdStep: 5,
      sigma: 1,
      resolution: [64, 64],
      extremaOptions: { minProminence: 2 },
    });

    expect(result.lineData).toEqual([
      {
        value: 5,
        geometry: "LINESTRING(20 60,22 66)",
      },
      {
        value: 10,
        geometry: "LINESTRING(24 72,26 78)",
      },
    ]);

    expect(mocks.getExtremaLocations).toHaveBeenCalledWith(
      "temp",
      {
        data: expect.any(Float32Array),
        shape: [3, 3],
        dimension: 2,
      },
      [100, 200],
      [10, 20],
      { minProminence: 2 },
      defaultBarnesParams.unproject,
    );

    expect(result.extremaPointData).toEqual([
      {
        field: "temp",
        kind: "max",
        geometry: "POINT(1000 2000)",
        value: 999,
      },
    ]);
  });
});
