export type PointInput = number[] | ArrayLike<number> | ReadonlyArray<ReadonlyArray<number>>;
export type ValueInput = ArrayLike<number>;
export type ScalarOrVector = number | ArrayLike<number>;
export type SizeInput = number | ReadonlyArray<number>;

export type Tuple1DWithValue = [number, number];
export type Tuple2DWithValue = [number, number, number];
export type Tuple3DWithValue = [number, number, number, number];
export type TupleWithValue = Tuple1DWithValue | Tuple2DWithValue | Tuple3DWithValue;

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
export interface LambertProjectionParams {
  centerLon: number;
  centerLat: number;
  n: number;
  nInv: number;
  f: number;
  rho0: number;
}

export interface BarnesGridParams2D {
  x0: [number, number];
  step: [number, number];
  size: [number, number];
}

export interface SphericalBarnesParams2D extends BarnesGridParams2D {
  projection: LambertProjectionParams;
  project: (lon: number, lat: number) => [number, number];
  unproject: (mapX: number, mapY: number) => [number, number];
}
