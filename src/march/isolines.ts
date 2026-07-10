import type { Feature, LineString } from "geojson";
import { barnes } from "../barnes.js";
import { getBarnesParams, lonLatToWebMercator } from "../helpers.js";
import type { Tuple2DWithValue, BarnesOptions, GridExtremaOptions2D } from "../types.js";
import { marchingSquares, type PolylinesWithLevels, type Point } from "./march.js";
import { getExtremaAsGeoJson, getExtremaLocations } from "../extrema/index.js";

export type LineGeometryData = { value: number; geometry: string };
export type ExtremaGeometryData = { field: string; kind: "max" | "min"; geometry: string; value: number };

export function convertToGeographicCoordinates(
  lines: Point[],
  x0: Point,
  step: number[],
  projectionFn: ReturnType<typeof getBarnesParams>["unproject"],
): Point[] {
  return lines.map((point) => projectionFn(x0[0] + point[0] * step[0]!, x0[1] + point[1] * step[1]!));
}

/**
 * Extracts the values of the isolines from the polylines data structure
 * @param polylines the polylines data structure containing the isolines and their corresponding threshold values
 * @param index the index of the isoline to extract the threshold value for
 * @returns The threshold value of the isoline at the given index
 */
export function getIsolineThreshold(polylines: PolylinesWithLevels, index: number) {
  return polylines.levelValues[polylines.polylineLevelIndex[index]!];
}

/**
 * Generate a GeoJSON Feature Collection of isolines from a 2-D array of points using Barnes Interpolation and Marching Squares
 * @param tupleData A 2-D array of points in the format `[lon,lat,value]`
 * @param options Includes options for `thresholdStep`, `sigma`, `resolution`, and custom `barnesOptions` pertaining for interpolation method, number of iterations, and maximum search distance
 * @returns a GeoJSON Feature Collection of isolines with their corresponding threshold values
 */
export function tupleArrayToGeoJson(
  tupleData: Tuple2DWithValue[],
  options: {
    thresholdStep: number;
    sigma: number | readonly number[];
    resolution: [number, number];
    barnesOptions?: BarnesOptions;
    extrema?: boolean;
    extremaOptions?: GridExtremaOptions2D;
  },
) {
  const { barnesParams, barnesResult, ...marched } = generateMarchedIsolines(tupleData, options);

  const lines: Feature<LineString>[] = marched.polylines.map((line, i) => ({
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates: line,
    },
    properties: {
      value: getIsolineThreshold(marched, i),
    },
  }));

  const extrema = options.extrema
    ? getExtremaAsGeoJson(
        barnesResult,
        barnesParams.x0,
        barnesParams.step,
        options.extremaOptions ?? {},
        barnesParams.unproject,
      )
    : [];

  return { features: [...lines, ...extrema], type: "FeatureCollection" };
}

/**
 * Convert a 2-D array of points into WKT geometries for isolines and extrema points
 * @param tupleData Tuple2DWithValue array (lng, lat, value) to interpolate and extract isolines from
 * @param fieldName The name of the data field you are interpolating
 * @param options Specify the step between thresholds (e.g. 5 degrees C), the sigma for the Barnes interpolation, the resolution of the grid, and any custom Barnes options, and whether you want to extract extrema points from the grid (with optional extremaOptions object)
 * @returns An object containing the line data and extrema point data in geometries in WKT format, along with their corresponding values and field names
 */
export function tupleArrayToWKTGeometries(
  tupleData: Tuple2DWithValue[],
  fieldName: string,
  options: {
    thresholdStep: number;
    sigma: number | readonly number[];
    resolution: [number, number];
    barnesOptions?: BarnesOptions;
    extrema?: boolean;
    extremaOptions?: GridExtremaOptions2D;
  },
): { lineData: LineGeometryData[]; extremaPointData: ExtremaGeometryData[] } {
  const { barnesParams, barnesResult, ...marched } = generateMarchedIsolines(tupleData, options);

  const lineData = marched.polylines.map((line, idx) => {
    const coords = line.map(([lon, lat]) => {
      const { x, y } = lonLatToWebMercator(lon, lat);
      return `${x} ${y}`;
    });

    const value = getIsolineThreshold(marched, idx);

    return { value, geometry: `LINESTRING(${coords.join(",")})` };
  });

  const extremaPointData = getExtremaLocations(
    fieldName,
    barnesResult,
    barnesParams.x0,
    barnesParams.step,
    options.extremaOptions ?? {},
    barnesParams.unproject,
  );

  return { lineData, extremaPointData };
}

/**
 * Generate isolines from a 2-D array of points using Barnes Interpolation and Marching Squares
 * @param tupleData A 2-D array of points in the format `[lon,lat,value]`
 * @param options Includes options for `thresholdStep`, `sigma`, `resolution`, and custom `barnesOptions` pertaining for interpolation method, number of iterations, and maximum search distance
 * @returns a data package containing the polylines (in geographic coordinates), their corresponding threshold values, and the parameters used for the Barnes interpolation
 */
export function generateMarchedIsolines(
  tupleData: Tuple2DWithValue[],
  options: {
    thresholdStep: number;
    sigma: number | readonly number[];
    resolution: [number, number];
    barnesOptions?: BarnesOptions;
  },
) {
  const barnesParams = getBarnesParams(tupleData, {
    mode: "spherical",
    resolution: options.resolution,
    sphericalOptions: { standardParallels: [42.5, 65.5] },
  });

  if (!barnesParams) {
    throw new Error("Failed to compute Barnes parameters");
  }

  const projectedPoints = tupleData.map(([lon, lat]) => barnesParams.project(lon, lat));
  const values = tupleData.map(([, , value]) => value);

  // find the min/max values
  // then use the step value (5 degrees C) to create an array of thresholds for the isolines

  const { data, shape, dimension } = barnes(
    projectedPoints,
    values,
    options.sigma,
    barnesParams.x0,
    barnesParams.step,
    barnesParams.size,
    options.barnesOptions,
  );

  if (shape.length !== 2) {
    throw new Error(`Expected shape to be a tuple of length 2, got ${shape.length}`);
  }

  const tupleMinMax = tupleData.reduce(
    (acc, tuple) => {
      const value = tuple[2]!;
      if (value < acc.min) {
        acc.min = value;
      }
      if (value > acc.max) {
        acc.max = value;
      }
      return acc;
    },
    { min: Infinity, max: -Infinity } as { min: number; max: number },
  );

  const thresholds =
    tupleMinMax.min === tupleMinMax.max
      ? [tupleMinMax.min]
      : Array.from({
          length: Math.ceil((tupleMinMax.max - tupleMinMax.min) / options.thresholdStep) + 1,
        }).map((_, i) => tupleMinMax.min - (tupleMinMax.min % options.thresholdStep) + i * options.thresholdStep);

  const polylineOutput = marchingSquares(thresholds, data, shape as [number, number]);

  return {
    ...polylineOutput,
    polylines: polylineOutput.polylines.map((line) =>
      convertToGeographicCoordinates(line, barnesParams.x0, barnesParams.step, barnesParams.unproject),
    ),
    barnesParams,
    barnesResult: { data, shape, dimension },
  };
}
