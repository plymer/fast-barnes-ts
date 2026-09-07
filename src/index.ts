export {
  barnes,
  getHalfKernelSize,
  getHalfKernelSizeOpt,
  getSigmaEffective,
  getTailValue,
  toNestedArray,
} from "./barnes";

export {
  get2DTupleDataProfile,
  getBarnesParams,
  buildSpacedThresholds,
  normalizeResolution,
  resolveThresholds,
} from "./helpers";

export type {
  BarnesMethod,
  BarnesOptions,
  BarnesResult,
  GridExtremaKind,
  GridExtremaOptions2D,
  GridExtremaPoint2D,
  GridContourOptions,
  LambertProjectionParams,
  PointInput,
  ScalarOrVector,
  SizeInput,
  Tuple1DWithValue,
  Tuple2DWithValue,
  Tuple3DWithValue,
  TupleWithValue,
  ValueInput,
} from "./types";

export * from "./extrema";
export * from "./march";
