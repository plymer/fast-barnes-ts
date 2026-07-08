import { describe, expect, it } from "vitest";
import { barnes, findGridExtrema2D } from "../src/barnes";
import {
  gridToIsobandsGeoJSON,
  gridToIsolinesGeoJSON,
  geoJSONtoGeoJSON,
  gridExtremaToGeoJSON,
  samplesFromGeoJSON,
  tupleArrayToGeoJSON,
} from "../src/geojson";
import { FeatureCollection, GeoJsonProperties, Point } from "geojson";
import { Tuple2DWithValue } from "../src/types";

function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const OUTPUT_PRECISION_SCALE = 1e3;

function expectRoundedToFiveDecimals(value: number): void {
  const rounded =
    Math.round(value * OUTPUT_PRECISION_SCALE) / OUTPUT_PRECISION_SCALE;
  expect(Math.abs(value - rounded)).toBeLessThanOrEqual(1e-10);
}

function assertLineStringCoordinatesRounded(
  coordinates: ReadonlyArray<ReadonlyArray<number>>,
): void {
  for (const position of coordinates) {
    expectRoundedToFiveDecimals(position[0]);
    expectRoundedToFiveDecimals(position[1]);
  }
}

function assertMultiPolygonCoordinatesRounded(
  coordinates: ReadonlyArray<
    ReadonlyArray<ReadonlyArray<ReadonlyArray<number>>>
  >,
): void {
  for (const polygon of coordinates) {
    for (const ring of polygon) {
      for (const position of ring) {
        expectRoundedToFiveDecimals(position[0]);
        expectRoundedToFiveDecimals(position[1]);
      }
    }
  }
}

describe("geojson", () => {
  it("builds samples from GeoJSON FeatureCollection and property key", () => {
    const fc: FeatureCollection<Point, GeoJsonProperties> = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [0.2, 0.2] },
          properties: { slp: 1.0 },
        },
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [1.2, 1.1] },
          properties: { slp: 2.0 },
        },
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [2.5, 0.7] },
          properties: { slp: 0.5 },
        },
      ],
    };

    const samples = samplesFromGeoJSON(fc, "slp");
    expect(samples).toEqual([
      [0.2, 0.2, 1.0],
      [1.2, 1.1, 2.0],
      [2.5, 0.7, 0.5],
    ]);

    const result = barnes(samples, 0.8, [0, 0], 0.5, [8, 6]);
    expect(result.dimension).toBe(2);
    expect(result.shape).toEqual([8, 6]);
  });

  it("skips features when GeoJSON property key is missing", () => {
    const fc: FeatureCollection<Point, GeoJsonProperties> = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [0.2, 0.2] },
          properties: {},
        },
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [0.4, 0.6] },
          properties: { slp: 1012 },
        },
      ],
    };

    const samples = samplesFromGeoJSON(fc, "slp");
    expect(samples).toEqual([[0.4, 0.6, 1012]]);
  });

  it("throws when GeoJSON property value is non-numeric", () => {
    const fc: FeatureCollection<Point, GeoJsonProperties> = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [0.2, 0.2] },
          properties: { slp: "bad" },
        },
      ],
    };

    expect(() => samplesFromGeoJSON(fc, "slp")).toThrow();
  });

  it("interpolates GeoJSON directly to isolines", () => {
    const fc: FeatureCollection<Point, GeoJsonProperties> = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [0.2, 0.2] },
          properties: { slp: 1.0 },
        },
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [1.2, 1.1] },
          properties: { slp: 2.0 },
        },
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [2.5, 0.7] },
          properties: { slp: 0.5 },
        },
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [0.4, 1.7] },
          properties: { slp: 1.4 },
        },
      ],
    };

    const lines = geoJSONtoGeoJSON(fc, "slp", "isolines", {
      resolution: 64,
      contourOptions: { spacing: 0.25, base: 0 },
    });

    expect(lines.type).toBe("FeatureCollection");
    for (const feature of lines.features) {
      expect(feature.geometry.type).toBe("LineString");
    }
  });

  it("interpolates GeoJSON directly to isobands", () => {
    const fc: FeatureCollection<Point, GeoJsonProperties> = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [0.2, 0.2] },
          properties: { slp: 1.0 },
        },
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [1.2, 1.1] },
          properties: { slp: 2.0 },
        },
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [2.5, 0.7] },
          properties: { slp: 0.5 },
        },
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [0.4, 1.7] },
          properties: { slp: 1.4 },
        },
      ],
    };

    const bands = geoJSONtoGeoJSON(fc, "slp", "isobands", {
      resolution: [48, 40],
      contourOptions: { spacing: 0.25, base: 0 },
    });

    expect(bands.type).toBe("FeatureCollection");
    expect(bands.features.length).toBeGreaterThan(0);
    expect(bands.features[0].geometry.type).toBe("MultiPolygon");
  });

  it("uses spherical coordinate mode by default and supports euclidean override", () => {
    const fc: FeatureCollection<Point, GeoJsonProperties> = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [-123.1, 49.3] },
          properties: { slp: 1012 },
        },
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [-74.0, 40.7] },
          properties: { slp: 1008 },
        },
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [-97.0, 35.5] },
          properties: { slp: 1016 },
        },
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [-80.2, 25.8] },
          properties: { slp: 1010 },
        },
      ],
    };

    const sphericalDefault = geoJSONtoGeoJSON(fc, "slp", "isolines", {
      resolution: [96, 64],
      contourOptions: { spacing: 1, base: 1006 },
    });

    const euclidean = geoJSONtoGeoJSON(fc, "slp", "isolines", {
      coordinateMode: "euclidean",
      resolution: [96, 64],
      contourOptions: { spacing: 1, base: 1006 },
    });

    expect(sphericalDefault.type).toBe("FeatureCollection");
    expect(euclidean.type).toBe("FeatureCollection");
    for (const feature of sphericalDefault.features) {
      expect(feature.geometry.type).toBe("LineString");
    }
    for (const feature of euclidean.features) {
      expect(feature.geometry.type).toBe("LineString");
    }
  });

  it("supports contour spacing and base in contourOptions", () => {
    const fc: FeatureCollection<Point, GeoJsonProperties> = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [0.0, 0.0] },
          properties: { slp: 1018 },
        },
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [1.0, 0.0] },
          properties: { slp: 1023 },
        },
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [0.0, 1.0] },
          properties: { slp: 1029 },
        },
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [1.0, 1.0] },
          properties: { slp: 1034 },
        },
      ],
    };

    const lines = geoJSONtoGeoJSON(fc, "slp", "isolines", {
      resolution: [64, 64],
      sigma: 0.35,
      contourOptions: {
        spacing: 4,
        base: 1024,
      },
    });

    expect(lines.features.length).toBeGreaterThan(0);
    for (const feature of lines.features) {
      const value = feature.properties.value;
      const idx = Math.round((value - 1024) / 4);
      expect(Math.abs(value - (1024 + idx * 4))).toBeLessThan(1e-6);
    }
  });

  it("converts interpolated grid to GeoJSON isobands and isolines", () => {
    const rand = lcg(7);
    const points: number[][] = [];
    const values: number[] = [];

    for (let i = 0; i < 200; i++) {
      const x = -2 + rand() * 8;
      const y = 1 + rand() * 6;
      points.push([x, y]);
      values.push(Math.sin(x) + Math.cos(y));
    }

    const x0 = [-2, 1] as const;
    const step = 0.2;
    const size = [40, 30] as const;

    const grid = barnes(points, values, 0.8, x0, step, size, {
      method: "optimized_convolution",
      numIter: 4,
    });

    const bands = gridToIsobandsGeoJSON(grid, x0, step, {
      spacing: 0.25,
      base: 0,
    });

    expect(bands.type).toBe("FeatureCollection");
    expect(bands.features.length).toBeGreaterThan(0);
    expect(bands.features[0].geometry.type).toBe("MultiPolygon");
    expect(typeof bands.features[0].properties.value).toBe("number");

    const lines = gridToIsolinesGeoJSON(grid, x0, step, {
      spacing: 0.25,
      base: 0,
    });

    expect(lines.type).toBe("FeatureCollection");
    expect(lines.features.length).toBeGreaterThan(0);
    expect(lines.features[0].geometry.type).toBe("LineString");
  });

  it("caps isoline and isoband output coordinates and contour values at 5 decimals", () => {
    const samples: Tuple2DWithValue[] = [
      [0.1234567, 0.7654321, 1.1111111],
      [1.2345678, 1.8765432, 2.2222222],
      [2.3456789, 0.6543219, 0.3333333],
      [0.8765432, 2.1234567, 1.4444444],
      [1.7654321, 2.3456789, 2.5555555],
    ];

    const grid = barnes(
      samples,
      0.45,
      [0.1234567, 0.7654321],
      [0.137913, 0.091357],
      [28, 24],
    );

    const isolines = gridToIsolinesGeoJSON(
      grid,
      [0.1234567, 0.7654321],
      [0.137913, 0.091357],
      {
        spacing: 0.2,
        base: 0,
      },
    );

    const isobands = gridToIsobandsGeoJSON(
      grid,
      [0.1234567, 0.7654321],
      [0.137913, 0.091357],
      {
        spacing: 0.2,
        base: 0,
      },
    );

    expect(isolines.features.length).toBeGreaterThan(0);
    for (const feature of isolines.features) {
      expectRoundedToFiveDecimals(feature.properties.value);
      assertLineStringCoordinatesRounded(feature.geometry.coordinates);
    }

    expect(isobands.features.length).toBeGreaterThan(0);
    for (const feature of isobands.features) {
      expectRoundedToFiveDecimals(feature.properties.value);
      assertMultiPolygonCoordinatesRounded(feature.geometry.coordinates);
    }
  });

  it("clips domain-edge segments from isolines while keeping isobands unchanged", () => {
    const sx = 8;
    const sy = 6;
    const data = new Float32Array(sx * sy);

    for (let y = 0; y < sy; y++) {
      for (let x = 0; x < sx; x++) {
        data[y * sx + x] = x;
      }
    }

    const grid = {
      data,
      shape: [sx, sy] as const,
      dimension: 2 as const,
    };

    const xMin = 0;
    const xMax = sx;
    const yMin = 0;
    const yMax = sy;
    const eps = 0.02;

    const isClose = (a: number, b: number): boolean => Math.abs(a - b) <= eps;

    const isBoundarySegment = (
      a: readonly number[],
      b: readonly number[],
    ): boolean => {
      return (
        (isClose(a[0], xMin) && isClose(b[0], xMin)) ||
        (isClose(a[0], xMax) && isClose(b[0], xMax)) ||
        (isClose(a[1], yMin) && isClose(b[1], yMin)) ||
        (isClose(a[1], yMax) && isClose(b[1], yMax))
      );
    };

    const hasBoundarySegment = (
      coords: readonly (readonly number[])[],
    ): boolean => {
      for (let i = 0; i + 1 < coords.length; i++) {
        if (isBoundarySegment(coords[i], coords[i + 1])) {
          return true;
        }
      }
      return false;
    };

    const lines = gridToIsolinesGeoJSON(grid, [0, 0], [1, 1], {
      spacing: 1,
      base: 0,
      smooth: true,
    });

    expect(lines.features.length).toBeGreaterThan(0);

    let openLineCount = 0;
    for (const feature of lines.features) {
      const coords = feature.geometry.coordinates;
      expect(hasBoundarySegment(coords)).toBe(false);

      const first = coords[0];
      const last = coords[coords.length - 1];
      const isClosed = isClose(first[0], last[0]) && isClose(first[1], last[1]);
      if (!isClosed) {
        openLineCount++;
      }
    }

    expect(openLineCount).toBeGreaterThan(0);

    const bands = gridToIsobandsGeoJSON(grid, [0, 0], [1, 1], {
      spacing: 1,
      base: 0,
      smooth: false,
    });

    let bandHasBoundarySegments = false;
    for (const feature of bands.features) {
      for (const polygon of feature.geometry.coordinates) {
        for (const ring of polygon) {
          if (hasBoundarySegment(ring)) {
            bandHasBoundarySegments = true;
            break;
          }
        }
        if (bandHasBoundarySegments) break;
      }
      if (bandHasBoundarySegments) break;
    }

    expect(bandHasBoundarySegments).toBe(true);
  });

  it("removes interior no-data (NaN) void boundaries from isolines", () => {
    const sx = 25;
    const sy = 25;
    const data = new Float32Array(sx * sy);

    for (let y = 0; y < sy; y++) {
      for (let x = 0; x < sx; x++) {
        data[y * sx + x] = 2;
      }
    }

    // Create a finite-data island with an internal no-data void.
    for (let y = 9; y <= 15; y++) {
      for (let x = 9; x <= 15; x++) {
        data[y * sx + x] = Number.NaN;
      }
    }

    const grid = {
      data,
      shape: [sx, sy] as const,
      dimension: 2 as const,
    };

    const lines = gridToIsolinesGeoJSON(grid, [0, 0], [1, 1], {
      spacing: 1,
      base: 1,
      smooth: false,
    });

    // Without no-data boundary clipping, this emits rings around the NaN void.
    expect(lines.features.length).toBe(0);
  });

  it("can transform tuple array samples directly to GeoJSON via Euclidian interpolation", () => {
    const samples: Tuple2DWithValue[] = [
      [0.2, 0.2, 1.0],
      [1.2, 1.1, 2.0],
      [2.5, 0.7, 0.5],
      [0.4, 1.7, 1.4],
    ];

    const lines = tupleArrayToGeoJSON(samples, "isolines", {
      resolution: 64,
      coordinateMode: "euclidean",
      contourOptions: { spacing: 0.25, base: 0 },
    });

    expect(lines.type).toBe("FeatureCollection");
    for (const feature of lines.features) {
      expect(feature.geometry.type).toBe("LineString");
    }
  });

  it("can transform tuple array samples directly to GeoJSON via Spherical interpolation", () => {
    const samples: Tuple2DWithValue[] = [
      [-128.1540069580078, 52.180999755859375, 1022.9],
      [-93.73300170898438, 49.66400146484375, 1014.1],
      [-122.95500183105469, 50.12900161743164, 1016.8],
      [-105.48300170898438, 49.04999923706055, 1016],
    ];

    const lines = tupleArrayToGeoJSON(samples, "isolines", {
      resolution: 64,
      contourOptions: { spacing: 0.25, base: 0 },
    });

    expect(lines.type).toBe("FeatureCollection");
    expect(lines.features.length).toBeGreaterThan(0);
    expect(lines.features[0].geometry.type).toBe("LineString");
  });

  it("throws a clear error when spherical tuple coordinates are lat/lon instead of lon/lat", () => {
    const swappedSamples: Tuple2DWithValue[] = [
      [52.180999755859375, -128.1540069580078, 1022.9],
      [49.66400146484375, -93.73300170898438, 1014.1],
      [50.12900161743164, -122.95500183105469, 1016.8],
      [49.04999923706055, -105.48300170898438, 1016],
    ];

    expect(() =>
      tupleArrayToGeoJSON(swappedSamples, "isolines", {
        resolution: 64,
        contourOptions: { spacing: 0.25, base: 0 },
      }),
    ).toThrow(/Coordinates appear swapped; expected \[longitude, latitude\]/i);
  });

  it("can interpolate tuple arrays the same was as GeoJSON feature collections", () => {
    const samples: Tuple2DWithValue[] = [
      [0.2, 0.2, 1.0],
      [1.2, 1.1, 2.0],
      [2.5, 0.7, 0.5],
      [0.4, 1.7, 1.4],
    ];

    const featureCollection: FeatureCollection<Point> = {
      type: "FeatureCollection",
      features: samples.map(([x, y, v]) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [x, y] },
        properties: { value: v },
      })),
    };

    const linesFromFC = geoJSONtoGeoJSON(
      featureCollection,
      "value",
      "isobands",
      {
        resolution: 64,
        coordinateMode: "euclidean",
        contourOptions: { spacing: 0.25, base: 0 },
      },
    );

    const tupleLines = tupleArrayToGeoJSON(samples, "isobands", {
      resolution: 64,
      coordinateMode: "euclidean",
      contourOptions: { spacing: 0.25, base: 0 },
    });

    expect(tupleLines.features.length).toBe(linesFromFC.features.length);
    expect(tupleLines.features[0]).toStrictEqual(linesFromFC.features[0]);
    expect(tupleLines.features[0].properties.value).toBeCloseTo(
      linesFromFC.features[0].properties.value,
    );
  });

  it("handles empty input gracefully", () => {
    const emptyFC: FeatureCollection<Point> = {
      type: "FeatureCollection",
      features: [],
    };

    const emptyLines = geoJSONtoGeoJSON(emptyFC, "value", "isolines", {
      resolution: 64,
      contourOptions: { spacing: 0.25, base: 0 },
    });

    expect(emptyLines.type).toBe("FeatureCollection");
    expect(emptyLines.features.length).toBe(0);

    const emptyTupleLines = tupleArrayToGeoJSON([], "isolines", {
      resolution: 64,
      contourOptions: { spacing: 0.25, base: 0 },
    });

    expect(emptyTupleLines.type).toBe("FeatureCollection");
    expect(emptyTupleLines.features.length).toBe(0);
  });

  it("handles single-point input by creating a single Point feature", () => {
    const singlePointFC: FeatureCollection<Point, GeoJsonProperties> = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [0.5, 0.5] },
          properties: { value: 1.0 },
        },
      ],
    };

    const result = geoJSONtoGeoJSON(singlePointFC, "value", "isolines", {
      resolution: 64,
      contourOptions: { spacing: 0.25, base: 0 },
    });

    expect(result.type).toBe("FeatureCollection");
    expect(result.features.length).toBe(1);
    expect(result.features[0].geometry.type).toBe("Point");
    expect(result.features[0].properties.value).toBe(1.0);
  });

  it("optionally appends extrema points to tupleArrayToGeoJSON output", () => {
    const samples: Tuple2DWithValue[] = Array.from({ length: 5 }, (_, y) =>
      Array.from({ length: 5 }, (_, x) => {
        const dx = x - 2;
        const dy = y - 2;
        const slp = 10 - 1.5 * (dx * dx + dy * dy);
        return [x, y, slp] as Tuple2DWithValue;
      }),
    ).flat();

    const withoutExtrema = tupleArrayToGeoJSON(samples, "isolines", {
      coordinateMode: "euclidean",
      x0: [0, 0],
      step: [0.25, 0.25],
      size: [17, 17],
      sigma: 0.35,
      contourOptions: { spacing: 1, base: 0 },
    });

    const withExtrema = tupleArrayToGeoJSON(samples, "isolines", {
      coordinateMode: "euclidean",
      x0: [0, 0],
      step: [0.25, 0.25],
      size: [17, 17],
      sigma: 0.35,
      contourOptions: { spacing: 1, base: 0 },
      extrema: { minProminence: 0.1, minSeparation: 1 },
    });

    const pointCountWithout = withoutExtrema.features.filter(
      // @ts-expect-error -- without extrema the geometries are all isolines and no points
      (f) => f.geometry.type === "Point",
    ).length;
    const pointCountWith = withExtrema.features.filter(
      (f) => f.geometry.type === "Point",
    ).length;

    expect(pointCountWithout).toBe(0);
    expect(pointCountWith).toBeGreaterThan(0);
  });

  it("optionally appends extrema points to geoJSONtoGeoJSON output", () => {
    const features = Array.from({ length: 5 }, (_, y) =>
      Array.from({ length: 5 }, (_, x) => {
        const dx = x - 2;
        const dy = y - 2;
        const slp = 10 - 1.5 * (dx * dx + dy * dy);
        return {
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: [x, y] as [number, number] },
          properties: { slp },
        };
      }),
    ).flat();

    const fc: FeatureCollection<Point, GeoJsonProperties> = {
      type: "FeatureCollection",
      features,
    };

    const out = geoJSONtoGeoJSON(fc, "slp", "isobands", {
      coordinateMode: "euclidean",
      x0: [0, 0],
      step: [0.25, 0.25],
      size: [17, 17],
      sigma: 0.35,
      contourOptions: { spacing: 1, base: 0 },
      extrema: { minProminence: 0.001, minSeparation: 0.5 },
    });

    const pointFeatures = out.features.filter(
      (f) => f.geometry.type === "Point",
    );
    expect(pointFeatures.length).toBeGreaterThan(0);
  });

  it("converts detected extrema to GeoJSON points", () => {
    const samples: Tuple2DWithValue[] = [
      [0, 0, 2],
      [1, 0, 3],
      [2, 0, 2],
      [0, 1, 1],
      [1, 1, 0],
      [2, 1, 1],
      [0, 2, 2],
      [1, 2, 3],
      [2, 2, 2],
    ];

    const grid = barnes(samples, 0.45, [0, 0], [0.1, 0.1], [32, 32]);
    const extrema = findGridExtrema2D(grid, [0, 0], [0.1, 0.1], {
      radius: 1,
      minSeparation: 2,
      minProminence: 0.01,
      maxCountPerKind: 5,
    });
    const fc = gridExtremaToGeoJSON(extrema);

    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features.length).toBe(extrema.length);

    if (fc.features.length > 0) {
      const first = fc.features[0];
      expect(first.geometry.type).toBe("Point");
      expect(first.geometry.coordinates.length).toBe(2);
      expect(typeof first.properties.kind).toBe("string");
      expect(typeof first.properties.value).toBe("number");
      expect(typeof first.properties.prominence).toBe("number");
      expect(typeof first.properties.gridIndex).toBe("number");
      expect(typeof first.properties.i).toBe("number");
      expect(typeof first.properties.j).toBe("number");
    }
  });

  it("caps extrema GeoJSON numeric fields at 5 decimals", () => {
    const fc = gridExtremaToGeoJSON([
      {
        kind: "max",
        value: 12.123456789,
        prominence: 0.987654321,
        gridIndex: 7,
        i: 3,
        j: 4,
        x: -123.123456789,
        y: 49.987654321,
      },
    ]);

    expect(fc.features.length).toBe(1);
    const feature = fc.features[0];

    expectRoundedToFiveDecimals(feature.properties.value);
    expectRoundedToFiveDecimals(feature.properties.prominence);
    expectRoundedToFiveDecimals(feature.geometry.coordinates[0]);
    expectRoundedToFiveDecimals(feature.geometry.coordinates[1]);
  });
});
