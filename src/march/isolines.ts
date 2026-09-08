import type { Tuple2DWithValue } from "../types.js";
import type { PolylinesWithLevels } from "./algorithm.js";

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
