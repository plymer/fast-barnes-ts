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
