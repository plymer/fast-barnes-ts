export type BarnesMethod = "optimized_convolution" | "convolution" | "naive";

export type CoordinateMode = "euclidean" | "spherical";

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

export type GridExtremaKind = "max" | "min";

export type GridExtremaPoint2D = {
  kind: GridExtremaKind;
  value: number;
  prominence: number;
  gridIndex: number;
  i: number; // grid-space x coordinate
  j: number; // grid-space y coordinate
  x: number; // data-space x coordinate (project to geo coords)
  y: number; // data-space y coordinate (project to geo coords)
};

export interface GridExtremaOptions2D {
  radius?: number;
  minSeparation?: number;
  minProminence?: number;
  maxCountPerKind?: number;
}

export type GridExtremaGeoJSONProperties = Pick<GridExtremaPoint2D, "kind" | "value" | "prominence">;

export type PointInput = number[] | ArrayLike<number> | ReadonlyArray<ReadonlyArray<number>>;
export type ValueInput = ArrayLike<number>;
export type ScalarOrVector = number | ArrayLike<number>;
export type SizeInput = number | ReadonlyArray<number>;

export type Tuple1DWithValue = [number, number];
export type Tuple2DWithValue = [number, number, number];
export type Tuple3DWithValue = [number, number, number, number];
export type TupleWithValue = Tuple1DWithValue | Tuple2DWithValue | Tuple3DWithValue;

export interface GridContourOptions {
  spacing: number;
  base?: number;
  smooth?: boolean;
  maskThreshold?: number;
}

export interface GeoJSONSphericalOptions {
  center?: readonly [number, number];
  standardParallels?: readonly [number, number];
  lambertPadding?: number;
}

export interface LambertProjectionParams {
  centerLon: number;
  centerLat: number;
  n: number;
  nInv: number;
  f: number;
  rho0: number;
}

export type GeoJSONInterpolationMode = "isobands" | "isolines";

export interface InterpolateGeoJSONOptions {
  debug?: boolean;
  coordinateMode?: CoordinateMode;
  sigma?: ScalarOrVector;
  x0?: ScalarOrVector;
  step?: ScalarOrVector;
  size?: SizeInput;
  resolution?: number | readonly [number, number];
  padding?: number;
  barnesOptions?: BarnesOptions;
  extrema?: boolean | GridExtremaOptions2D;
  sphericalOptions?: GeoJSONSphericalOptions;
  contourOptions: GridContourOptions;
}
