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

export interface BarnesSample {
  point: number | ReadonlyArray<number>;
  value: number;
}

export interface GridContourOptions {
  spacing: number;
  base?: number;
  smooth?: boolean;
  outerRingsOnly?: boolean;
}

export type GeoJSONInterpolationMode = "isoband" | "isobands" | "isoline" | "isolines";

export interface InterpolateGeoJSONOptions {
  debug?: boolean;
  sigma?: ScalarOrVector;
  x0?: ScalarOrVector;
  step?: ScalarOrVector;
  size?: SizeInput;
  resolution?: number | readonly [number, number];
  padding?: number;
  barnesOptions?: BarnesOptions;
  contourOptions: GridContourOptions;
}
