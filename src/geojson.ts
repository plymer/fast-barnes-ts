import { contours } from "d3-contour";
import type {
  Feature,
  FeatureCollection,
  GeoJsonProperties,
  LineString,
  MultiPolygon,
  Point,
  Position,
} from "geojson";
import type {
  BarnesObservation,
  BarnesResult,
  GridContourOptions,
  GridContourThresholds,
  ScalarOrVector,
} from "./types";

export interface ContourBandProperties {
  value: number;
}

export interface ContourLineProperties {
  value: number;
}

/**
 * Builds Barnes observations from a GeoJSON `FeatureCollection` of `Point` features.
 *
 * @param featureCollection GeoJSON points with numeric values in `properties`.
 * @param valueProperty Property key to read the observation value from each feature.
 * @returns Observation array compatible with `barnes(observations, ...)`.
 * @throws If a feature is not a `Point`, has inconsistent dimensions, or has a missing/non-numeric property.
 */
export function observationsFromGeoJSON(
  featureCollection: FeatureCollection<Point, GeoJsonProperties>,
  valueProperty: string,
): BarnesObservation[] {
  const observations: BarnesObservation[] = [];
  let dim: 2 | 3 | undefined;

  for (let i = 0; i < featureCollection.features.length; i++) {
    const feature = featureCollection.features[i];

    if (feature.geometry.type !== "Point") {
      throw new Error(`Feature ${i} geometry must be Point, got ${feature.geometry.type}`);
    }

    const coords = feature.geometry.coordinates;
    if (coords.length !== 2 && coords.length !== 3) {
      throw new Error(
        `Feature ${i} Point coordinates must have length 2 or 3, got ${coords.length}`,
      );
    }

    if (dim === undefined) {
      dim = coords.length as 2 | 3;
    } else if (coords.length !== dim) {
      throw new Error(
        `Inconsistent Point coordinate dimensions, expected ${dim} but got ${coords.length}`,
      );
    }

    const rawValue = feature.properties?.[valueProperty];
    if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) {
      throw new Error(
        `Feature ${i} has non-numeric or missing property '${valueProperty}': ${String(rawValue)}`,
      );
    }

    observations.push({
      point: dim === 2 ? [coords[0], coords[1]] : [coords[0], coords[1], coords[2]],
      value: rawValue,
    });
  }

  return observations;
}

/**
 * Converts a 2D Barnes interpolation grid into GeoJSON isobands (`MultiPolygon` features).
 *
 * @param grid 2D interpolation result from `barnes(...)`.
 * @param x0 Grid origin in data coordinates.
 * @param step Grid spacing in data coordinates.
 * @param options Contour generation options (thresholds/smoothing).
 * @returns GeoJSON `FeatureCollection` of `MultiPolygon` contour bands.
 */
export function gridToIsobandsGeoJSON(
  grid: BarnesResult,
  x0: ScalarOrVector,
  step: ScalarOrVector,
  options: GridContourOptions = {},
): FeatureCollection<MultiPolygon, ContourBandProperties> {
  ensure2DGrid(grid);
  const [sx, sy] = grid.shape;
  const [x0x, x0y] = normalize2DVector(x0, "x0");
  const [stepX, stepY] = normalize2DVector(step, "step");

  const generator = contours()
    .size([sx, sy])
    .thresholds(resolveThresholds(options.thresholds))
    .smooth(options.smooth ?? true);

  const res = generator(Array.from(grid.data));

  const features: Array<Feature<MultiPolygon, ContourBandProperties>> = res.map((item) => ({
    type: "Feature",
    properties: {
      value: item.value,
    },
    geometry: {
      type: "MultiPolygon",
      coordinates: transformMultiPolygon(
        item.coordinates as number[][][][],
        x0x,
        x0y,
        stepX,
        stepY,
      ),
    },
  }));

  return {
    type: "FeatureCollection",
    features,
  };
}

/**
 * Converts a 2D Barnes interpolation grid into GeoJSON isolines (`LineString` features).
 *
 * @param grid 2D interpolation result from `barnes(...)`.
 * @param x0 Grid origin in data coordinates.
 * @param step Grid spacing in data coordinates.
 * @param options Contour generation options; `outerRingsOnly` controls whether holes are excluded.
 * @returns GeoJSON `FeatureCollection` of `LineString` contour lines.
 */
export function gridToIsolinesGeoJSON(
  grid: BarnesResult,
  x0: ScalarOrVector,
  step: ScalarOrVector,
  options: GridContourOptions = {},
): FeatureCollection<LineString, ContourLineProperties> {
  const bands = gridToIsobandsGeoJSON(grid, x0, step, options);
  const outerOnly = options.outerRingsOnly ?? true;

  const features: Array<Feature<LineString, ContourLineProperties>> = [];

  for (const band of bands.features) {
    const value = band.properties.value;
    for (const polygon of band.geometry.coordinates) {
      const rings = outerOnly ? polygon.slice(0, 1) : polygon;
      for (const ring of rings) {
        features.push({
          type: "Feature",
          properties: { value },
          geometry: {
            type: "LineString",
            coordinates: ring,
          },
        });
      }
    }
  }

  return {
    type: "FeatureCollection",
    features,
  };
}

function ensure2DGrid(grid: BarnesResult): void {
  if (grid.dimension !== 2) {
    throw new Error(`GeoJSON contour conversion expects 2D BarnesResult, got ${grid.dimension}D`);
  }
  if (grid.shape.length !== 2) {
    throw new Error(`GeoJSON contour conversion expects shape [sx, sy], got ${grid.shape}`);
  }
}

function normalize2DVector(value: ScalarOrVector, name: string): [number, number] {
  if (typeof value === "number") {
    return [value, value];
  }
  const arr = Array.from(value);
  if (arr.length !== 2) {
    throw new Error(`${name} must be scalar or length-2 array, got length ${arr.length}`);
  }
  return [arr[0], arr[1]];
}

function resolveThresholds(thresholds: GridContourThresholds | undefined): number | number[] {
  if (thresholds === undefined) {
    return 10;
  }
  return typeof thresholds === "number" ? thresholds : Array.from(thresholds);
}

function transformMultiPolygon(
  coords: number[][][][],
  x0: number,
  y0: number,
  stepX: number,
  stepY: number,
): Position[][][] {
  return coords.map((polygon) =>
    polygon.map((ring) => ring.map((pos) => transformPosition(pos, x0, y0, stepX, stepY))),
  );
}

function transformPosition(
  pos: readonly number[],
  x0: number,
  y0: number,
  stepX: number,
  stepY: number,
): Position {
  if (pos.length < 2) {
    throw new Error(`Invalid contour coordinate: ${pos}`);
  }
  return [x0 + pos[0] * stepX, y0 + pos[1] * stepY];
}
