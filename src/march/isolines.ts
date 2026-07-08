import { barnes } from "../barnes.js";
import { getBarnesParams } from "../helpers.js";
import type { Tuple2DWithValue, BarnesOptions } from "../types.js";
import { marchingSquares, type PolylinesWithLevels, type Point } from "./march.js";

export function convertToGeographicCoordinates(
  lines: Point[],
  x0: Point,
  step: number[],
  projectionFn: ReturnType<typeof getBarnesParams>["unproject"],
): Point[] {
  return lines.map((point) => projectionFn(x0[0] + point[0] * step[0]!, x0[1] + point[1] * step[1]!));
}

function getIsolineThreshold(polylines: PolylinesWithLevels, index: number) {
  return polylines.levelValues[polylines.polylineLevelIndex[index]!];
}

export function generateGeoJson(
  polylines: PolylinesWithLevels,
  x0: Point,
  step: number[],
  projectionFn: ReturnType<typeof getBarnesParams>["unproject"],
) {
  const geoJson = polylines.polylines.map((line, i) => ({
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates: convertToGeographicCoordinates(line, x0, step, projectionFn),
    },
    properties: {
      value: getIsolineThreshold(polylines, i),
    },
  }));

  return geoJson;
}

export function generateMarchedIsolines(
  tupleData: Tuple2DWithValue[],
  options: {
    thresholdStep: number;
    sigma: number | readonly number[];
    resolution: [number, number];
    barnesOptions?: BarnesOptions;
  },
) {
  const params = getBarnesParams(tupleData, {
    mode: "spherical",
    resolution: options.resolution,
    sphericalOptions: { standardParallels: [42.5, 65.5] },
  });

  if (!params) {
    throw new Error("Failed to compute Barnes parameters");
  }

  const projectedPoints = tupleData.map(([lon, lat]) => params.project(lon, lat));
  const values = tupleData.map(([, , value]) => value);

  // find the min/max values
  // then use the step value (5 degrees C) to create an array of thresholds for the isolines

  const { data, shape } = barnes(
    projectedPoints,
    values,
    options.sigma,
    params.x0,
    params.step,
    params.size,
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
      convertToGeographicCoordinates(line, params.x0, params.step, params.unproject),
    ),
    params,
  };
}
