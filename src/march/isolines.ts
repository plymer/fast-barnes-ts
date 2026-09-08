import type { Tuple2DWithValue } from "../types.js";

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
