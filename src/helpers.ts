import {
  BarnesResult,
  CoordinateMode,
  GridContourOptions,
  Tuple2DWithValue,
} from "./types";

export function get2DTupleDataProfile(tupleData: Tuple2DWithValue[]) {
  const { bounds, maxValue, minValue } = tupleData.reduce<{
    maxValue: number;
    minValue: number;
    bounds: [number, number, number, number];
  }>(
    (acc, d) => {
      return {
        maxValue: Math.max(acc.maxValue, d[2]),
        minValue: Math.min(acc.minValue, d[2]),
        bounds: [
          Math.min(acc.bounds[0], d[0]),
          Math.min(acc.bounds[1], d[1]),
          Math.max(acc.bounds[2], d[0]),
          Math.max(acc.bounds[3], d[1]),
        ],
      };
    },
    {
      maxValue: -Infinity,
      minValue: Infinity,
      bounds: [Infinity, Infinity, -Infinity, -Infinity],
    },
  );

  return { bounds, maxValue, minValue };
}

export function resolveThresholds(
  grid: BarnesResult,
  options: GridContourOptions,
): number[] {
  const { spacing, base } = options;
  if (!(spacing > 0)) {
    throw new Error(`spacing must be > 0, got ${spacing}`);
  }

  const baseValue = base ?? 0;
  return buildSpacedThresholds(grid.data, spacing, baseValue);
}

export function buildSpacedThresholds(
  data: Float32Array,
  spacing: number,
  base: number,
): number[] {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < data.length; i++) {
    const value = data[i];
    if (!Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return [];
  }

  const startK = Math.ceil((min - base) / spacing);
  const endK = Math.floor((max - base) / spacing);

  if (startK > endK) {
    return [];
  }

  const levels: number[] = [];
  for (let k = startK; k <= endK; k++) {
    levels.push(base + k * spacing);
  }

  return levels;
}

export function normalizeResolution(
  resolution: number | readonly [number, number] | undefined,
): [number, number] {
  if (resolution === undefined) {
    return [128, 128];
  }

  if (typeof resolution === "number") {
    const r = Math.trunc(resolution);
    if (r < 2) {
      throw new Error(`resolution must be >= 2, got ${resolution}`);
    }
    return [r, r];
  }

  const rx = Math.trunc(resolution[0]);
  const ry = Math.trunc(resolution[1]);
  if (rx < 2 || ry < 2) {
    throw new Error(
      `resolution values must be >= 2, got [${resolution[0]}, ${resolution[1]}]`,
    );
  }
  return [rx, ry];
}

export function getBarnesParams(
  tupleData: Tuple2DWithValue[],
  options: {
    mode: CoordinateMode;
    resolution: number | [number, number];
    padding?: number;
  },
) {
  switch (options.mode) {
    case "euclidean": {
      const padding = options.padding ?? 0.05;

      const bounds = tupleData.reduce<[number, number, number, number]>(
        (acc, d) => {
          return [
            Math.min(acc[0], d[0]),
            Math.min(acc[1], d[1]),
            Math.max(acc[2], d[0]),
            Math.max(acc[3], d[1]),
          ];
        },
        [Infinity, Infinity, -Infinity, -Infinity],
      );

      const x0: [number, number] = [bounds[0] - padding, bounds[1] - padding];

      const size = normalizeResolution(options.resolution);

      const spanX = bounds[2] + padding - x0[0];
      const spanY = bounds[3] + padding - x0[1];
      const step = [
        spanX / Math.max(1, size[0] - 1),
        spanY / Math.max(1, size[1] - 1),
      ];

      return { x0, step, size };
    }
    case "spherical": {
      console.log("not implemented yet");
    }
  }
}
