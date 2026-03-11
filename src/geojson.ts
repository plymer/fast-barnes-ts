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
  BarnesSample,
  InterpolateGeoJSONOptions,
  GeoJSONInterpolationMode,
  BarnesResult,
  GridContourOptions,
  ScalarOrVector,
} from "./types";
import { barnes } from "./barnes";

export interface ContourBandProperties {
  value: number;
}

export interface ContourLineProperties {
  value: number;
}

/**
 * End-to-end GeoJSON interpolation helper that converts point features to samples,
 * interpolates with Barnes, and returns either isobands or isolines.
 *
 * With only the first three arguments, the interpolation grid is derived from point bounds.
 *
 * `valueProperty` is constrained to keys of the feature `properties` type.
 *
 * @param featureCollection GeoJSON points with numeric values in `properties`.
 * @param valueProperty Property key to read the sample value from each feature.
 * @param mode Output contour mode (`"isoband" | "isobands" | "isoline" | "isolines"`).
 * @param options Optional interpolation and contour settings.
 * @returns GeoJSON isobands (`MultiPolygon`) or isolines (`LineString`).
 */
export function interpolateGeoJSON<P extends GeoJsonProperties, K extends string>(
  featureCollection: FeatureCollection<Point, P>,
  valueProperty: K & keyof NonNullable<P>,
  mode: "isoline" | "isolines",
  options: InterpolateGeoJSONOptions,
): FeatureCollection<LineString, ContourLineProperties>;

export function interpolateGeoJSON<P extends GeoJsonProperties, K extends string>(
  featureCollection: FeatureCollection<Point, P>,
  valueProperty: K & keyof NonNullable<P>,
  mode: "isoband" | "isobands",
  options: InterpolateGeoJSONOptions,
): FeatureCollection<MultiPolygon, ContourBandProperties>;

export function interpolateGeoJSON<P extends GeoJsonProperties, K extends string>(
  featureCollection: FeatureCollection<Point, P>,
  valueProperty: K & keyof NonNullable<P>,
  mode: GeoJSONInterpolationMode,
  options: InterpolateGeoJSONOptions,
):
  | FeatureCollection<MultiPolygon, ContourBandProperties>
  | FeatureCollection<LineString, ContourLineProperties> {
  const debug = options.debug ?? false;
  const inputFeatureCount = featureCollection.features.length;

  const logDebug = (...args: unknown[]) => {
    if (debug) {
      console.info("[fast-barnes-ts][interpolateGeoJSON]", ...args);
    }
  };

  logDebug("start", {
    mode,
    valueProperty: String(valueProperty),
    inputFeatureCount,
  });

  const samples = samplesFromGeoJSON(featureCollection, valueProperty);
  const skippedFeatureCount = inputFeatureCount - samples.length;

  logDebug("samples extracted", {
    sampleCount: samples.length,
    skippedFeatureCount,
  });

  if (samples.length === 0) {
    logDebug("no samples after extraction; returning empty FeatureCollection");
    return { type: "FeatureCollection", features: [] };
  }

  const points: number[][] = [];
  const values: number[] = [];

  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    if (typeof sample.point === "number" || sample.point.length !== 2) {
      throw new Error("interpolateGeoJSON currently supports only 2D Point geometries");
    }
    points.push([sample.point[0], sample.point[1]]);
    values.push(sample.value);
  }

  const hasAnyManualGridParam =
    options.x0 !== undefined || options.step !== undefined || options.size !== undefined;
  const hasAllManualGridParams =
    options.x0 !== undefined && options.step !== undefined && options.size !== undefined;

  if (hasAnyManualGridParam && !hasAllManualGridParams) {
    throw new Error("When specifying manual grid parameters, provide x0, step, and size together");
  }

  let x0: [number, number];
  let step: [number, number];
  let size: [number, number];

  if (hasAllManualGridParams) {
    x0 = normalize2DVector(options.x0 as ScalarOrVector, "x0");
    step = normalize2DVector(options.step as ScalarOrVector, "step");
    const sizeVec = normalize2DSize(options.size as number | readonly number[]);
    size = [sizeVec[0], sizeVec[1]];
  } else {
    const [rx, ry] = normalizeResolution(options.resolution);
    const padding = options.padding ?? 0.05;

    if (!(padding >= 0)) {
      throw new Error(`padding must be >= 0, got ${padding}`);
    }

    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (let i = 0; i < points.length; i++) {
      const [px, py] = points[i];
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }

    const extentX = maxX - minX;
    const extentY = maxY - minY;
    const padX = extentX > 0 ? extentX * padding : 1;
    const padY = extentY > 0 ? extentY * padding : 1;

    x0 = [minX - padX, minY - padY];
    size = [rx, ry];

    const spanX = maxX + padX - x0[0];
    const spanY = maxY + padY - x0[1];
    step = [spanX / Math.max(1, size[0] - 1), spanY / Math.max(1, size[1] - 1)];
  }

  const sigma = options.sigma ?? Math.max(step[0], step[1]) * 2.0;
  logDebug("interpolation grid", {
    x0,
    step,
    size,
    sigma,
    hasManualGridParams: hasAllManualGridParams,
  });

  const grid = barnes(points, values, sigma, x0, step, size, options.barnesOptions ?? {});

  logDebug("barnes complete", {
    gridShape: grid.shape,
    gridDimension: grid.dimension,
  });

  if (mode === "isoline" || mode === "isolines") {
    const lines = gridToIsolinesGeoJSON(grid, x0, step, options.contourOptions);
    logDebug("contours complete", {
      outputMode: "isolines",
      outputFeatureCount: lines.features.length,
      contourOptions: options.contourOptions,
    });
    return lines;
  }

  const bands = gridToIsobandsGeoJSON(grid, x0, step, options.contourOptions);
  logDebug("contours complete", {
    outputMode: "isobands",
    outputFeatureCount: bands.features.length,
    contourOptions: options.contourOptions,
  });
  return bands;
}

/**
 * Builds Barnes samples from a GeoJSON `FeatureCollection` of `Point` features.
 *
 * `valueProperty` is constrained to keys of the feature `properties` type.
 *
 * @param featureCollection GeoJSON points with numeric values in `properties`.
 * @param valueProperty Property key to read the sample value from each feature.
 * @returns Sample array compatible with `barnes(samples, ...)`.
 * @throws If a feature is not a `Point`, has inconsistent dimensions, or has a non-numeric property value.
 */
export function samplesFromGeoJSON<P extends GeoJsonProperties, K extends string>(
  featureCollection: FeatureCollection<Point, P>,
  valueProperty: K & keyof NonNullable<P>,
): BarnesSample[] {
  const samples: BarnesSample[] = [];
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

    const properties = feature.properties as NonNullable<P> | null | undefined;
    const rawValue = properties?.[valueProperty];
    if (rawValue === undefined || rawValue === null) {
      continue;
    }

    if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) {
      throw new Error(
        `Feature ${i} has non-numeric property '${String(valueProperty)}': ${String(rawValue)}`,
      );
    }

    samples.push({
      point: dim === 2 ? [coords[0], coords[1]] : [coords[0], coords[1], coords[2]],
      value: rawValue,
    });
  }

  return samples;
}

/**
 * Converts a 2D Barnes interpolation grid into GeoJSON isobands (`MultiPolygon` features).
 *
 * @param grid 2D interpolation result from `barnes(...)`.
 * @param x0 Grid origin in data coordinates.
 * @param step Grid spacing in data coordinates.
 * @param options Contour generation options (`spacing` required, `base` defaults to `0`).
 * @returns GeoJSON `FeatureCollection` of `MultiPolygon` contour bands.
 */
export function gridToIsobandsGeoJSON(
  grid: BarnesResult,
  x0: ScalarOrVector,
  step: ScalarOrVector,
  options: GridContourOptions,
): FeatureCollection<MultiPolygon, ContourBandProperties> {
  ensure2DGrid(grid);
  const [sx, sy] = grid.shape;
  const [x0x, x0y] = normalize2DVector(x0, "x0");
  const [stepX, stepY] = normalize2DVector(step, "step");

  const generator = contours()
    .size([sx, sy])
    .thresholds(resolveThresholds(grid, options))
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
  options: GridContourOptions,
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

function normalize2DSize(size: number | readonly number[]): [number, number] {
  if (typeof size === "number") {
    throw new Error("size must be a length-2 array for GeoJSON interpolation");
  }
  const arr = Array.from(size);
  if (arr.length !== 2) {
    throw new Error(`size must be length-2, got length ${arr.length}`);
  }
  const sx = Math.trunc(arr[0]);
  const sy = Math.trunc(arr[1]);
  if (sx < 2 || sy < 2) {
    throw new Error(`size values must be >= 2, got [${sx}, ${sy}]`);
  }
  return [sx, sy];
}

function normalizeResolution(
  resolution: number | readonly [number, number] | undefined,
): [number, number] {
  if (resolution === undefined) {
    return [128, 128];
  }

  if (typeof resolution === "number") {
    const r = Math.trunc(resolution);
    if (r < 2) {
      throw new Error(`resolution must be >= 2, got ${resolution}`);
    }
    return [r, r];
  }

  const rx = Math.trunc(resolution[0]);
  const ry = Math.trunc(resolution[1]);
  if (rx < 2 || ry < 2) {
    throw new Error(`resolution values must be >= 2, got [${resolution[0]}, ${resolution[1]}]`);
  }
  return [rx, ry];
}

function resolveThresholds(grid: BarnesResult, options: GridContourOptions): number[] {
  const { spacing, base } = options;
  if (!(spacing > 0)) {
    throw new Error(`spacing must be > 0, got ${spacing}`);
  }

  const baseValue = base ?? 0;
  return buildSpacedThresholds(grid.data, spacing, baseValue);
}

function buildSpacedThresholds(data: Float32Array, spacing: number, base: number): number[] {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < data.length; i++) {
    const value = data[i];
    if (!Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return [];
  }

  const startK = Math.ceil((min - base) / spacing);
  const endK = Math.floor((max - base) / spacing);

  if (startK > endK) {
    return [];
  }

  const levels: number[] = [];
  for (let k = startK; k <= endK; k++) {
    levels.push(base + k * spacing);
  }

  return levels;
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
