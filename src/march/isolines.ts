import type { Tuple2DWithValue } from "../barnes/types";
import type { ScalarField } from "./types";

export function computeThresholds(data: Tuple2DWithValue[], thresholdStep: number): number[];
export function computeThresholds(data: ScalarField, thresholdStep: number): number[];
export function computeThresholds(data: Tuple2DWithValue[] | ScalarField, thresholdStep: number): number[] {
  const isTuple = !Object.keys(data).includes("xDim");

  switch (isTuple) {
    case true: {
      const tupleMinMax = (data as Tuple2DWithValue[]).reduce(
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
    case false: {
      let min = Infinity;
      let max = -Infinity;

      const field = data as ScalarField;

      for (let i = 0; i <= field.xDim; i++) {
        for (let j = 0; j <= field.yDim; j++) {
          const value = field.get(i, j);
          if (value < min) {
            min = value;
          }
          if (value > max) {
            max = value;
          }
        }
      }

      return min === max
        ? [min]
        : Array.from({
            length: Math.ceil((max - min) / thresholdStep) + 1,
          }).map((_, i) => min - (min % thresholdStep) + i * thresholdStep);
    }
  }
}
