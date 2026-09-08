import { getBarnesParams, lonLatToWebMercator } from "../helpers.js";
import type { Tuple2DWithValue } from "../types.js";
import { type PolylinesWithLevels, type Point } from "./algorithm.js";

export function convertToWgs84(
  lines: Point[],
  x0: Point,
  step: number[],
  projToWgs84Fn: ReturnType<typeof getBarnesParams>["unproject"],
  paddingOffset?: { x: number; y: number },
): Point[] {
  if (!paddingOffset) paddingOffset = { x: 0, y: 0 };
  return lines.map((point) =>
    projToWgs84Fn(x0[0] + paddingOffset.x + point[0] * step[0]!, x0[1] + paddingOffset.y + point[1] * step[1]!),
  );
}

export function convertToWebMercator(
  lines: Point[],
  x0: Point,
  step: number[],
  projToWgs84Fn: ReturnType<typeof getBarnesParams>["unproject"],
  paddingOffset?: { x: number; y: number },
): Point[] {
  return convertToWgs84(lines, x0, step, projToWgs84Fn, paddingOffset).map(([lon, lat]) => {
    const { x, y } = lonLatToWebMercator(lon, lat);
    return [x, y] as Point;
  });
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

export function computeThresholds(tupleData: Tuple2DWithValue[], thresholdStep: number) {
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

  return tupleMinMax.min === tupleMinMax.max
    ? [tupleMinMax.min]
    : Array.from({
        length: Math.ceil((tupleMinMax.max - tupleMinMax.min) / thresholdStep) + 1,
      }).map((_, i) => tupleMinMax.min - (tupleMinMax.min % thresholdStep) + i * thresholdStep);
}
