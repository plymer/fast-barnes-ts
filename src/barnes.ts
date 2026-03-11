import type {
  BarnesSample,
  BarnesMethod,
  BarnesOptions,
  BarnesResult,
  PointInput,
  ScalarOrVector,
  SizeInput,
  ValueInput,
} from "./types";

const SQRT_2_PI = Math.sqrt(2.0 * Math.PI);

interface NormalizedInput {
  points: Float64Array;
  values: Float64Array;
  sampleCount: number;
  dim: 1 | 2 | 3;
  sigma: Float64Array;
  x0: Float64Array;
  step: Float64Array;
  size: number[];
}

/**
 * Converts parallel coordinate/value arrays into sample objects accepted by `barnes(...)`.
 *
 * @param pts Input coordinates as 1D points (`number[]`) or multi-dimensional points (`number[][]`).
 * @param val Sample values aligned by index with `pts`.
 * @returns Array of `{ point, value }` samples.
 * @throws If the number of points and values differ.
 */
export function toSamples(pts: PointInput, val: ValueInput): BarnesSample[] {
  const values = Array.from(val);

  if (isPointMatrix(pts)) {
    const points = pts as ReadonlyArray<ReadonlyArray<number>>;

    if (points.length !== values.length) {
      throw new Error(
        `pts and val arrays have inconsistent lengths: ${points.length} vs ${values.length}`,
      );
    }

    return points.map((point, i) => ({
      point: Array.from(point),
      value: values[i],
    }));
  }

  const points1d = Array.from(pts as ArrayLike<number>);
  if (points1d.length !== values.length) {
    throw new Error(
      `pts and val arrays have inconsistent lengths: ${points1d.length} vs ${values.length}`,
    );
  }

  return points1d.map((point, i) => ({
    point,
    value: values[i],
  }));
}

/**
 * Converts sample objects back into parallel point/value arrays.
 *
 * @param samples Sample objects with scalar or vector `point` values.
 * @returns Object containing `points` and `values` arrays.
 * @throws If point dimensionality is inconsistent or outside 1D/2D/3D.
 */
export function fromSamples(samples: ReadonlyArray<BarnesSample>): {
  points: number[] | number[][];
  values: number[];
} {
  return unpackSamples(samples);
}

/**
 * Interpolates irregular samples onto a regular grid using Barnes interpolation.
 *
 * Overload accepting sample objects.
 *
 * @param samples Sample array in `{ point, value }` format.
 * @param sigma Gaussian width per dimension (scalar or vector).
 * @param x0 Grid origin per dimension (scalar or vector).
 * @param step Grid spacing per dimension (scalar or vector).
 * @param size Grid size per dimension.
 * @param options Interpolation options such as method, iterations, and distance cutoff.
 * @returns Flat grid result with metadata (`shape`, `dimension`).
 */
export function barnes(
  samples: ReadonlyArray<BarnesSample>,
  sigma: ScalarOrVector,
  x0: ScalarOrVector,
  step: ScalarOrVector,
  size: SizeInput,
  options?: BarnesOptions,
): BarnesResult;

/**
 * Interpolates irregular samples onto a regular grid using Barnes interpolation.
 *
 * Overload accepting separate point and value arrays.
 *
 * @param pts Input coordinates as 1D points (`number[]`) or multi-dimensional points (`number[][]`).
 * @param val Sample values aligned by index with `pts`.
 * @param sigma Gaussian width per dimension (scalar or vector).
 * @param x0 Grid origin per dimension (scalar or vector).
 * @param step Grid spacing per dimension (scalar or vector).
 * @param size Grid size per dimension.
 * @param options Interpolation options such as method, iterations, and distance cutoff.
 * @returns Flat grid result with metadata (`shape`, `dimension`).
 */
export function barnes(
  pts: PointInput,
  val: ValueInput,
  sigma: ScalarOrVector,
  x0: ScalarOrVector,
  step: ScalarOrVector,
  size: SizeInput,
  options?: BarnesOptions,
): BarnesResult;

export function barnes(
  ptsOrSamples: PointInput | ReadonlyArray<BarnesSample>,
  valOrSigma: ValueInput | ScalarOrVector,
  sigmaOrX0: ScalarOrVector,
  x0OrStep: ScalarOrVector,
  stepOrSize: ScalarOrVector | SizeInput,
  sizeOrOptions?: SizeInput | BarnesOptions,
  maybeOptions: BarnesOptions = {},
): BarnesResult {
  let pts: PointInput;
  let val: ValueInput;
  let sigma: ScalarOrVector;
  let x0: ScalarOrVector;
  let step: ScalarOrVector;
  let size: SizeInput;
  let options: BarnesOptions;

  if (isSampleArray(ptsOrSamples)) {
    const unpacked = unpackSamples(ptsOrSamples);
    pts = unpacked.points;
    val = unpacked.values;
    sigma = valOrSigma as ScalarOrVector;
    x0 = sigmaOrX0;
    step = x0OrStep;
    size = stepOrSize as SizeInput;
    options = (sizeOrOptions as BarnesOptions | undefined) ?? {};
  } else {
    pts = ptsOrSamples;
    val = valOrSigma as ValueInput;
    sigma = sigmaOrX0;
    x0 = x0OrStep;
    step = stepOrSize as ScalarOrVector;
    size = sizeOrOptions as SizeInput;
    options = maybeOptions;
  }

  const method = options.method ?? "optimized_convolution";
  const numIter = options.numIter ?? 4;
  const maxDist = options.maxDist ?? 3.5;

  if (!Number.isInteger(numIter) || numIter < 1) {
    throw new Error(`numIter must be a positive integer, got ${numIter}`);
  }

  const normalized = normalizeInput(pts, val, sigma, x0, step, size);
  const maxDistWeight = Math.exp(-(maxDist ** 2) / 2.0);

  if (method === "optimized_convolution") {
    const kernelSize = getKernelSizeOpt(normalized.sigma, normalized.step, numIter);
    assertKernelFits(kernelSize, normalized.size);
    return interpolateFast(normalized, numIter, maxDistWeight, true);
  }

  if (method === "convolution") {
    const kernelSize = getKernelSize(normalized.sigma, normalized.step, numIter);
    assertKernelFits(kernelSize, normalized.size);
    return interpolateFast(normalized, numIter, maxDistWeight, false);
  }

  if (method === "naive") {
    return interpolateNaive(normalized);
  }

  throw new Error(`Unsupported Barnes method: ${String(method satisfies never)}`);
}

function isSampleArray(
  value: PointInput | ReadonlyArray<BarnesSample>,
): value is ReadonlyArray<BarnesSample> {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    typeof value[0] === "object" &&
    value[0] !== null &&
    "point" in value[0] &&
    "value" in value[0]
  );
}

function unpackSamples(samples: ReadonlyArray<BarnesSample>): {
  points: number[] | number[][];
  values: number[];
} {
  if (samples.length === 0) {
    return { points: [], values: [] };
  }

  const firstPoint = samples[0].point;
  const dim = typeof firstPoint === "number" ? 1 : firstPoint.length;

  if (dim < 1 || dim > 3) {
    throw new Error(`Barnes interpolation supports dimensions 1, 2 or 3, got ${dim}`);
  }

  const values = new Array<number>(samples.length);

  if (dim === 1) {
    const points = new Array<number>(samples.length);
    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i];
      const point = sample.point;

      if (typeof point === "number") {
        points[i] = point;
      } else {
        if (point.length !== 1) {
          throw new Error(
            `Inconsistent point dimension in samples, expected 1 but got ${point.length}`,
          );
        }
        points[i] = point[0];
      }

      values[i] = sample.value;
    }

    return { points, values };
  }

  const points = new Array<number[]>(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    const point = sample.point;

    if (typeof point === "number") {
      throw new Error(`Inconsistent point dimension in samples, expected ${dim} but got scalar`);
    }

    if (point.length !== dim) {
      throw new Error(
        `Inconsistent point dimension in samples, expected ${dim} but got ${point.length}`,
      );
    }

    points[i] = Array.from(point);
    values[i] = sample.value;
  }

  return { points, values };
}

/**
 * Computes the half kernel size used by the standard rectangular convolution approximation.
 *
 * @param sigma Gaussian width per dimension (scalar or vector).
 * @param step Grid spacing per dimension (scalar or vector).
 * @param numIter Number of convolution passes.
 * @returns Half kernel size (scalar for 1D, vector for 2D/3D).
 */
export function getHalfKernelSize(
  sigma: ScalarOrVector,
  step: ScalarOrVector,
  numIter: number,
): number | number[] {
  const dim = inferDimFromVectors(sigma, step);
  const sigmaVec = Float64Array.from(toVector(sigma, dim, "sigma"));
  const stepVec = Float64Array.from(toVector(step, dim, "step"));
  const values = getHalfKernelSizeVector(sigmaVec, stepVec, numIter);
  return dim === 1 ? values[0] : values;
}

/**
 * Computes the half kernel size used by the optimized rectangular convolution approximation.
 *
 * @param sigma Gaussian width per dimension (scalar or vector).
 * @param step Grid spacing per dimension (scalar or vector).
 * @param numIter Number of convolution passes.
 * @returns Half kernel size (scalar for 1D, vector for 2D/3D).
 */
export function getHalfKernelSizeOpt(
  sigma: ScalarOrVector,
  step: ScalarOrVector,
  numIter: number,
): number | number[] {
  const dim = inferDimFromVectors(sigma, step);
  const sigmaVec = Float64Array.from(toVector(sigma, dim, "sigma"));
  const stepVec = Float64Array.from(toVector(step, dim, "step"));
  const values = getHalfKernelSizeOptVector(sigmaVec, stepVec, numIter);
  return dim === 1 ? values[0] : values;
}

/**
 * Computes the tail correction value used by the optimized convolution method.
 *
 * @param sigma Gaussian width per dimension (scalar or vector).
 * @param step Grid spacing per dimension (scalar or vector).
 * @param numIter Number of convolution passes.
 * @returns Tail value (scalar for 1D, vector for 2D/3D).
 */
export function getTailValue(
  sigma: ScalarOrVector,
  step: ScalarOrVector,
  numIter: number,
): number | number[] {
  const dim = inferDimFromVectors(sigma, step);
  const sigmaVec = Float64Array.from(toVector(sigma, dim, "sigma"));
  const stepVec = Float64Array.from(toVector(step, dim, "step"));
  const values = getTailValueVector(sigmaVec, stepVec, numIter);
  return dim === 1 ? values[0] : values;
}

/**
 * Computes the effective sigma implied by a chosen rectangular kernel and iteration count.
 *
 * @param sigma Target Gaussian width per dimension (scalar or vector).
 * @param step Grid spacing per dimension (scalar or vector).
 * @param numIter Number of convolution passes.
 * @returns Effective sigma estimate (scalar for 1D, vector for 2D/3D).
 */
export function getSigmaEffective(
  sigma: ScalarOrVector,
  step: ScalarOrVector,
  numIter: number,
): number | number[] {
  const dim = inferDimFromVectors(sigma, step);
  const sigmaVec = Float64Array.from(toVector(sigma, dim, "sigma"));
  const stepVec = Float64Array.from(toVector(step, dim, "step"));
  const half = getHalfKernelSizeVector(sigmaVec, stepVec, numIter);
  const out = half.map((h, i) => Math.sqrt((numIter / 3.0) * h * (h + 1.0)) * stepVec[i]);
  return dim === 1 ? out[0] : out;
}

/**
 * Reshapes the flat `BarnesResult.data` array into nested arrays.
 *
 * Output indexing order is `[x]` for 1D, `[y][x]` for 2D, and `[z][y][x]` for 3D.
 *
 * @param result Barnes interpolation result.
 * @returns Nested array representation of the interpolated field.
 */
export function toNestedArray(result: BarnesResult): number[] | number[][] | number[][][] {
  const { data, shape, dimension } = result;

  if (dimension === 1) {
    return Array.from(data);
  }

  if (dimension === 2) {
    const [sx, sy] = shape;
    const rows: number[][] = [];
    for (let y = 0; y < sy; y++) {
      const row: number[] = [];
      for (let x = 0; x < sx; x++) {
        row.push(data[y * sx + x]);
      }
      rows.push(row);
    }
    return rows;
  }

  const [sx, sy, sz] = shape;
  const out: number[][][] = [];
  for (let z = 0; z < sz; z++) {
    const slab: number[][] = [];
    for (let y = 0; y < sy; y++) {
      const row: number[] = [];
      for (let x = 0; x < sx; x++) {
        row.push(data[(z * sy + y) * sx + x]);
      }
      slab.push(row);
    }
    out.push(slab);
  }
  return out;
}

function normalizeInput(
  pts: PointInput,
  val: ValueInput,
  sigma: ScalarOrVector,
  x0: ScalarOrVector,
  step: ScalarOrVector,
  size: SizeInput,
): NormalizedInput {
  const { points, sampleCount, dim } = normalizePoints(pts);
  const values = Float64Array.from(val);

  if (values.length !== sampleCount) {
    throw new Error(
      `pts and val arrays have inconsistent lengths: ${sampleCount} vs ${values.length}`,
    );
  }

  const sigmaVec = Float64Array.from(toVector(sigma, dim, "sigma"));
  const x0Vec = Float64Array.from(toVector(x0, dim, "x0"));
  const stepVec = Float64Array.from(toVector(step, dim, "step"));
  const sizeVec = normalizeSize(size, dim);

  for (const s of sigmaVec) {
    if (!(s > 0.0)) throw new Error("sigma must be > 0 in all dimensions");
  }
  for (const s of stepVec) {
    if (!(s > 0.0)) throw new Error("step must be > 0 in all dimensions");
  }
  for (const s of sizeVec) {
    if (!Number.isInteger(s) || s < 2) throw new Error("size values must be integer and >= 2");
  }

  return {
    points,
    values,
    sampleCount,
    dim,
    sigma: sigmaVec,
    x0: x0Vec,
    step: stepVec,
    size: sizeVec,
  };
}

function normalizePoints(pts: PointInput): {
  points: Float64Array;
  sampleCount: number;
  dim: 1 | 2 | 3;
} {
  if (isPointMatrix(pts)) {
    const rows = pts as ReadonlyArray<ReadonlyArray<number>>;
    const dim = rows[0].length;
    if (dim < 1 || dim > 3) {
      throw new Error(`Barnes interpolation supports dimensions 1, 2, or 3, got ${dim}`);
    }

    const sampleCount = rows.length;
    const flat = new Float64Array(sampleCount * dim);
    for (let i = 0; i < sampleCount; i++) {
      const row = rows[i];
      if (row.length !== dim) {
        throw new Error(`All point rows must have equal length ${dim}`);
      }
      for (let d = 0; d < dim; d++) {
        flat[i * dim + d] = row[d];
      }
    }

    return { points: flat, sampleCount, dim: dim as 1 | 2 | 3 };
  }

  const oneDim = Float64Array.from(pts as ArrayLike<number>);
  return {
    points: oneDim,
    sampleCount: oneDim.length,
    dim: 1,
  };
}

function isPointMatrix(value: PointInput): value is ReadonlyArray<ReadonlyArray<number>> {
  return Array.isArray(value) && value.length > 0 && Array.isArray(value[0]);
}

function normalizeSize(size: SizeInput, dim: number): number[] {
  if (typeof size === "number") {
    if (dim !== 1) {
      throw new Error(`array size should be array-like of length ${dim}`);
    }
    return [Math.trunc(size)];
  }

  const arr = Array.from(size);
  if (arr.length !== dim) {
    throw new Error(`specified size with invalid length: ${arr.length}`);
  }
  return arr.map((v) => Math.trunc(v));
}

function toVector(value: ScalarOrVector, dim: number, name: string): number[] {
  if (typeof value === "number") {
    return Array.from({ length: dim }, () => value);
  }

  const arr = Array.from(value);
  if (arr.length !== dim) {
    throw new Error(`specified ${name} with invalid length: ${arr.length}`);
  }
  return arr;
}

function inferDimFromVectors(a: ScalarOrVector, b: ScalarOrVector): 1 | 2 | 3 {
  const la = typeof a === "number" ? 1 : Array.from(a).length;
  const lb = typeof b === "number" ? 1 : Array.from(b).length;
  const dim = Math.max(la, lb);
  if (dim < 1 || dim > 3) {
    throw new Error(`Barnes interpolation supports dimensions 1, 2 or 3, got ${dim}`);
  }
  return dim as 1 | 2 | 3;
}

function getKernelSize(sigma: Float64Array, step: Float64Array, numIter: number): number[] {
  const half = getHalfKernelSizeVector(sigma, step, numIter);
  return half.map((h) => 2 * h + 1);
}

function getKernelSizeOpt(sigma: Float64Array, step: Float64Array, numIter: number): number[] {
  const half = getHalfKernelSizeOptVector(sigma, step, numIter);
  return half.map((h) => 2 * h + 1);
}

function getHalfKernelSizeVector(
  sigma: Float64Array,
  step: Float64Array,
  numIter: number,
): number[] {
  return Array.from(sigma, (s, i) => Math.trunc(Math.sqrt(3.0 / numIter) * (s / step[i]) + 0.5));
}

function getHalfKernelSizeOptVector(
  sigma: Float64Array,
  step: Float64Array,
  numIter: number,
): number[] {
  return Array.from(sigma, (s, i) => {
    const ratio = s / step[i];
    return Math.trunc((Math.sqrt(1.0 + (12.0 * ratio * ratio) / numIter) - 1.0) / 2.0);
  });
}

function getTailValueVector(sigma: Float64Array, step: Float64Array, numIter: number): number[] {
  const half = getHalfKernelSizeOptVector(sigma, step, numIter);
  return Array.from(sigma, (s, i) => {
    const h = half[i];
    const kernel = 2.0 * h + 1.0;
    const sigmaRectSq = ((h + 1.0) * h * step[i] * step[i]) / 3.0;
    return (
      (0.5 * kernel * ((s * s) / numIter - sigmaRectSq)) /
      (((h + 1.0) * step[i]) ** 2 - (s * s) / numIter)
    );
  });
}

function assertKernelFits(kernel: number[], size: number[]): void {
  for (let i = 0; i < kernel.length; i++) {
    if (kernel[i] >= size[i]) {
      throw new Error(
        `resulting rectangular kernel size should be smaller than grid: ${kernel} vs ${size}`,
      );
    }
  }
}

function normalizeValues(values: Float64Array): { centered: Float64Array; offset: number } {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const offset = (min + max) / 2.0;
  const centered = new Float64Array(values.length);
  for (let i = 0; i < values.length; i++) {
    centered[i] = values[i] - offset;
  }
  return { centered, offset };
}

function interpolateFast(
  input: NormalizedInput,
  numIter: number,
  maxDistWeight: number,
  optimized: boolean,
): BarnesResult {
  const { centered, offset } = normalizeValues(input.values);
  const shape = input.size;

  const total = shape.reduce((a, b) => a * b, 1);
  const vg = new Float64Array(total);
  const wg = new Float64Array(total);

  injectData(
    vg,
    wg,
    input.points,
    centered,
    input.sampleCount,
    input.dim,
    input.x0,
    input.step,
    shape,
  );

  const kernel = optimized
    ? getKernelSizeOpt(input.sigma, input.step, numIter)
    : getKernelSize(input.sigma, input.step, numIter);

  const tail = optimized ? getTailValueVector(input.sigma, input.step, numIter) : undefined;

  convolve(vg, wg, input.dim, shape, kernel, numIter, input.sigma, input.step, maxDistWeight, tail);

  const result = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    const w = wg[i];
    result[i] = Number.isNaN(w) || w === 0.0 ? Number.NaN : vg[i] / w + offset;
  }

  return {
    data: result,
    shape,
    dimension: input.dim,
  };
}

function injectData(
  vg: Float64Array,
  wg: Float64Array,
  points: Float64Array,
  values: Float64Array,
  sampleCount: number,
  dim: 1 | 2 | 3,
  x0: Float64Array,
  step: Float64Array,
  size: number[],
): void {
  if (dim === 1) {
    const sx = size[0];
    for (let k = 0; k < sampleCount; k++) {
      const xc = (points[k] - x0[0]) / step[0];
      if (xc < 0.0 || xc >= sx - 1) continue;
      const xi = Math.trunc(xc);
      const xw = xc - xi;
      const w0 = 1.0 - xw;
      vg[xi] += w0 * values[k];
      wg[xi] += w0;
      vg[xi + 1] += xw * values[k];
      wg[xi + 1] += xw;
    }
    return;
  }

  if (dim === 2) {
    const sx = size[0];
    const sy = size[1];
    for (let k = 0; k < sampleCount; k++) {
      const px = points[k * 2];
      const py = points[k * 2 + 1];
      const xc = (px - x0[0]) / step[0];
      const yc = (py - x0[1]) / step[1];
      if (xc < 0.0 || yc < 0.0 || xc >= sx - 1 || yc >= sy - 1) continue;

      const xi = Math.trunc(xc);
      const yi = Math.trunc(yc);
      const xw = xc - xi;
      const yw = yc - yi;

      const idx00 = yi * sx + xi;
      const idx10 = idx00 + 1;
      const idx01 = idx00 + sx;
      const idx11 = idx01 + 1;

      const v = values[k];

      const w00 = (1.0 - xw) * (1.0 - yw);
      const w10 = xw * (1.0 - yw);
      const w11 = xw * yw;
      const w01 = (1.0 - xw) * yw;

      vg[idx00] += w00 * v;
      wg[idx00] += w00;
      vg[idx10] += w10 * v;
      wg[idx10] += w10;
      vg[idx11] += w11 * v;
      wg[idx11] += w11;
      vg[idx01] += w01 * v;
      wg[idx01] += w01;
    }
    return;
  }

  const sx = size[0];
  const sy = size[1];
  const sz = size[2];

  for (let k = 0; k < sampleCount; k++) {
    const base = k * 3;
    const px = points[base];
    const py = points[base + 1];
    const pz = points[base + 2];

    const xc = (px - x0[0]) / step[0];
    const yc = (py - x0[1]) / step[1];
    const zc = (pz - x0[2]) / step[2];

    if (xc < 0.0 || yc < 0.0 || zc < 0.0 || xc >= sx - 1 || yc >= sy - 1 || zc >= sz - 1) {
      continue;
    }

    const xi = Math.trunc(xc);
    const yi = Math.trunc(yc);
    const zi = Math.trunc(zc);
    const xw = xc - xi;
    const yw = yc - yi;
    const zw = zc - zi;

    const v = values[k];

    for (let dz = 0; dz <= 1; dz++) {
      const wz = dz === 0 ? 1.0 - zw : zw;
      for (let dy = 0; dy <= 1; dy++) {
        const wy = dy === 0 ? 1.0 - yw : yw;
        for (let dx = 0; dx <= 1; dx++) {
          const wx = dx === 0 ? 1.0 - xw : xw;
          const w = wx * wy * wz;
          const idx = ((zi + dz) * sy + (yi + dy)) * sx + (xi + dx);
          vg[idx] += w * v;
          wg[idx] += w;
        }
      }
    }
  }
}

function convolve(
  vg: Float64Array,
  wg: Float64Array,
  dim: 1 | 2 | 3,
  size: number[],
  kernelSize: number[],
  numIter: number,
  sigma: Float64Array,
  step: Float64Array,
  maxDistWeight: number,
  tailValue?: number[],
): void {
  if (dim === 1) {
    const sx = size[0];
    const convV = convolveLine(vg, sx, kernelSize[0], numIter, tailValue?.[0]);
    const convW = convolveLine(wg, sx, kernelSize[0], numIter, tailValue?.[0]);
    vg.set(convV);
    wg.set(convW);
    applyWeightThreshold(
      wg,
      computeScaleFactor(kernelSize, numIter, sigma, step, maxDistWeight, tailValue),
    );
    return;
  }

  if (dim === 2) {
    const sx = size[0];
    const sy = size[1];

    for (let y = 0; y < sy; y++) {
      const rowOffset = y * sx;
      vg.set(
        convolveLine(
          vg.subarray(rowOffset, rowOffset + sx),
          sx,
          kernelSize[0],
          numIter,
          tailValue?.[0],
        ),
        rowOffset,
      );
      wg.set(
        convolveLine(
          wg.subarray(rowOffset, rowOffset + sx),
          sx,
          kernelSize[0],
          numIter,
          tailValue?.[0],
        ),
        rowOffset,
      );
    }

    const colV = new Float64Array(sy);
    const colW = new Float64Array(sy);
    for (let x = 0; x < sx; x++) {
      for (let y = 0; y < sy; y++) {
        const idx = y * sx + x;
        colV[y] = vg[idx];
        colW[y] = wg[idx];
      }

      const convV = convolveLine(colV, sy, kernelSize[1], numIter, tailValue?.[1]);
      const convW = convolveLine(colW, sy, kernelSize[1], numIter, tailValue?.[1]);
      for (let y = 0; y < sy; y++) {
        const idx = y * sx + x;
        vg[idx] = convV[y];
        wg[idx] = convW[y];
      }
    }

    applyWeightThreshold(
      wg,
      computeScaleFactor(kernelSize, numIter, sigma, step, maxDistWeight, tailValue),
    );
    return;
  }

  const sx = size[0];
  const sy = size[1];
  const sz = size[2];

  for (let z = 0; z < sz; z++) {
    for (let y = 0; y < sy; y++) {
      const rowOffset = (z * sy + y) * sx;
      vg.set(
        convolveLine(
          vg.subarray(rowOffset, rowOffset + sx),
          sx,
          kernelSize[0],
          numIter,
          tailValue?.[0],
        ),
        rowOffset,
      );
      wg.set(
        convolveLine(
          wg.subarray(rowOffset, rowOffset + sx),
          sx,
          kernelSize[0],
          numIter,
          tailValue?.[0],
        ),
        rowOffset,
      );
    }
  }

  const lineYV = new Float64Array(sy);
  const lineYW = new Float64Array(sy);
  for (let z = 0; z < sz; z++) {
    for (let x = 0; x < sx; x++) {
      for (let y = 0; y < sy; y++) {
        const idx = (z * sy + y) * sx + x;
        lineYV[y] = vg[idx];
        lineYW[y] = wg[idx];
      }
      const convV = convolveLine(lineYV, sy, kernelSize[1], numIter, tailValue?.[1]);
      const convW = convolveLine(lineYW, sy, kernelSize[1], numIter, tailValue?.[1]);
      for (let y = 0; y < sy; y++) {
        const idx = (z * sy + y) * sx + x;
        vg[idx] = convV[y];
        wg[idx] = convW[y];
      }
    }
  }

  const lineZV = new Float64Array(sz);
  const lineZW = new Float64Array(sz);
  for (let y = 0; y < sy; y++) {
    for (let x = 0; x < sx; x++) {
      for (let z = 0; z < sz; z++) {
        const idx = (z * sy + y) * sx + x;
        lineZV[z] = vg[idx];
        lineZW[z] = wg[idx];
      }
      const convV = convolveLine(lineZV, sz, kernelSize[2], numIter, tailValue?.[2]);
      const convW = convolveLine(lineZW, sz, kernelSize[2], numIter, tailValue?.[2]);
      for (let z = 0; z < sz; z++) {
        const idx = (z * sy + y) * sx + x;
        vg[idx] = convV[z];
        wg[idx] = convW[z];
      }
    }
  }

  applyWeightThreshold(
    wg,
    computeScaleFactor(kernelSize, numIter, sigma, step, maxDistWeight, tailValue),
  );
}

function convolveLine(
  values: Float64Array,
  lineLength: number,
  rectLength: number,
  numIter: number,
  alpha?: number,
): Float64Array {
  const inArr = Float64Array.from(values);
  const hArr = new Float64Array(lineLength);
  return alpha === undefined
    ? accumulateArray(inArr, hArr, lineLength, rectLength, numIter)
    : accumulateTailArray(inArr, hArr, lineLength, rectLength, numIter, alpha);
}

function accumulateArray(
  inArr: Float64Array,
  hArr: Float64Array,
  arrLen: number,
  rectLen: number,
  numIter: number,
): Float64Array {
  let src = inArr;
  let dst = hArr;
  const h0 = (rectLen - 1) >> 1;
  const h1 = rectLen - h0;

  for (let iter = 0; iter < numIter; iter++) {
    let accu = 0.0;

    for (let k = -h0; k < 0; k++) {
      accu += src[k + h0];
    }

    for (let k = 0; k < h1; k++) {
      accu += src[k + h0];
      dst[k] = accu;
    }

    for (let k = h1; k < arrLen - h0; k++) {
      accu += src[k + h0] - src[k - h1];
      dst[k] = accu;
    }

    for (let k = arrLen - h0; k < arrLen; k++) {
      accu -= src[k - h1];
      dst[k] = accu;
    }

    const tmp = src;
    src = dst;
    dst = tmp;
  }

  return src;
}

function accumulateTailArray(
  inArr: Float64Array,
  hArr: Float64Array,
  arrLen: number,
  rectLen: number,
  numIter: number,
  alpha: number,
): Float64Array {
  let src = inArr;
  let dst = hArr;
  const h0 = (rectLen - 1) >> 1;
  const h0_1 = h0 + 1;
  const h1 = rectLen - h0;

  for (let iter = 0; iter < numIter; iter++) {
    let accu = 0.0;

    for (let k = -h0; k < 0; k++) {
      accu += src[k + h0];
    }

    for (let k = 0; k < h1; k++) {
      accu += src[k + h0];
      dst[k] = accu + alpha * src[k + h0_1];
    }

    for (let k = h1; k < arrLen - h0_1; k++) {
      accu += src[k + h0] - src[k - h1];
      dst[k] = accu + alpha * (src[k - h1] + src[k + h0_1]);
    }

    const kLast = arrLen - h0_1;
    accu += src[kLast + h0] - src[kLast - h1];
    dst[kLast] = accu + alpha * src[kLast - h1];

    for (let k = arrLen - h0; k < arrLen; k++) {
      accu -= src[k - h1];
      dst[k] = accu + alpha * src[k - h1];
    }

    const tmp = src;
    src = dst;
    dst = tmp;
  }

  return src;
}

function computeScaleFactor(
  kernelSize: number[],
  numIter: number,
  sigma: Float64Array,
  step: Float64Array,
  maxDistWeight: number,
  tailValue?: number[],
): number {
  let factor = maxDistWeight;
  for (let d = 0; d < sigma.length; d++) {
    const base = tailValue ? kernelSize[d] + 2.0 * tailValue[d] : kernelSize[d];
    factor *= base ** numIter / SQRT_2_PI / (sigma[d] / step[d]);
  }
  return factor;
}

function applyWeightThreshold(weights: Float64Array, threshold: number): void {
  for (let i = 0; i < weights.length; i++) {
    if (weights[i] < threshold) {
      weights[i] = Number.NaN;
    }
  }
}

function interpolateNaive(input: NormalizedInput): BarnesResult {
  const { centered, offset } = normalizeValues(input.values);
  const { dim, size, sampleCount, points, sigma, x0, step } = input;
  const out = new Float32Array(size.reduce((a, b) => a * b, 1));

  if (dim === 1) {
    const sx = size[0];
    const scale = 2.0 * sigma[0] * sigma[0];

    for (let x = 0; x < sx; x++) {
      const xc = x0[0] + x * step[0];
      let weightedSum = 0.0;
      let weightTotal = 0.0;

      for (let k = 0; k < sampleCount; k++) {
        const dist = points[k] - xc;
        const w = Math.exp(-(dist * dist) / scale);
        weightedSum += w * centered[k];
        weightTotal += w;
      }

      out[x] = weightTotal > 0.0 ? weightedSum / weightTotal + offset : Number.NaN;
    }

    return { data: out, shape: size, dimension: dim };
  }

  if (dim === 2) {
    const sx = size[0];
    const sy = size[1];
    const scaleX = 2.0 * sigma[0] * sigma[0];
    const scaleY = 2.0 * sigma[1] * sigma[1];

    for (let y = 0; y < sy; y++) {
      const yc = x0[1] + y * step[1];
      for (let x = 0; x < sx; x++) {
        const xc = x0[0] + x * step[0];
        let weightedSum = 0.0;
        let weightTotal = 0.0;

        for (let k = 0; k < sampleCount; k++) {
          const base = k * 2;
          const dx = points[base] - xc;
          const dy = points[base + 1] - yc;
          const w = Math.exp(-(dx * dx) / scaleX - (dy * dy) / scaleY);
          weightedSum += w * centered[k];
          weightTotal += w;
        }

        out[y * sx + x] = weightTotal > 0.0 ? weightedSum / weightTotal + offset : Number.NaN;
      }
    }

    return { data: out, shape: size, dimension: dim };
  }

  const sx = size[0];
  const sy = size[1];
  const sz = size[2];
  const scaleX = 2.0 * sigma[0] * sigma[0];
  const scaleY = 2.0 * sigma[1] * sigma[1];
  const scaleZ = 2.0 * sigma[2] * sigma[2];

  for (let z = 0; z < sz; z++) {
    const zc = x0[2] + z * step[2];
    for (let y = 0; y < sy; y++) {
      const yc = x0[1] + y * step[1];
      for (let x = 0; x < sx; x++) {
        const xc = x0[0] + x * step[0];
        let weightedSum = 0.0;
        let weightTotal = 0.0;

        for (let k = 0; k < sampleCount; k++) {
          const base = k * 3;
          const dx = points[base] - xc;
          const dy = points[base + 1] - yc;
          const dz = points[base + 2] - zc;
          const w = Math.exp(-(dx * dx) / scaleX - (dy * dy) / scaleY - (dz * dz) / scaleZ);
          weightedSum += w * centered[k];
          weightTotal += w;
        }

        out[(z * sy + y) * sx + x] =
          weightTotal > 0.0 ? weightedSum / weightTotal + offset : Number.NaN;
      }
    }
  }

  return { data: out, shape: size, dimension: dim };
}
