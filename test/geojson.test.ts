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
    expect(lines.features.length).toBeGreaterThan(0);
    expect(lines.features[0].geometry.type).toBe("LineString");
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

    expect(sphericalDefault.features.length).toBeGreaterThan(0);
    expect(euclidean.features.length).toBeGreaterThan(0);
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
    expect(lines.features.length).toBeGreaterThan(0);
    expect(lines.features[0].geometry.type).toBe("LineString");
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
});
