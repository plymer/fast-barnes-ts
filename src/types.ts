export type BarnesMethod = "optimized_convolution" | "convolution" | "naive";

export interface BarnesOptions {
  method?: BarnesMethod;
  numIter?: number;
  maxDist?: number;
}

export interface BarnesResult {
  data: Float32Array;
  shape: readonly number[];
  dimension: 1 | 2 | 3;
}

export type PointInput = number[] | ArrayLike<number> | ReadonlyArray<ReadonlyArray<number>>;
export type ValueInput = ArrayLike<number>;
export type ScalarOrVector = number | ArrayLike<number>;
export type SizeInput = number | ReadonlyArray<number>;

export interface BarnesObservation {
  point: number | ReadonlyArray<number>;
  value: number;
}

export type GridContourThresholds = number | readonly number[];

export interface GridContourOptions {
  thresholds?: GridContourThresholds;
  smooth?: boolean;
  outerRingsOnly?: boolean;
}
