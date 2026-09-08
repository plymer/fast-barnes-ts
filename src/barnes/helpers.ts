import {
  createLambertProjection,
  getPointBounds,
  validateSphericalCoordinates,
  wgs84ToLcc,
  lccToWgs84,
} from "./spherical";
import type { SphericalBarnesParams2D, Tuple2DWithValue } from "./types";

function normalizeResolution(resolution: number | readonly [number, number] | undefined): [number, number] {
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
    throw new Error(`resolution values must be >= 2, got [${resolution[0]}, ${resolution[1]}]`);
  }
  return [rx, ry];
}

export function getBarnesParams(
  tupleData: Tuple2DWithValue[],
  options: {
    resolution: number | [number, number];
    padding?: number;
  },
): SphericalBarnesParams2D {
  if (tupleData.length === 0) {
    throw new Error("Cannot derive Barnes params from empty tupleData");
  }

  validateSphericalCoordinates(tupleData);

  const size = normalizeResolution(options.resolution);
  const points = tupleData.map(([lon, lat]) => [lon, lat]);
  const projection = createLambertProjection(points);

  const mappedPoints = points.map((p) => wgs84ToLcc(projection, p[0], p[1]));
  const bounds = getPointBounds(mappedPoints);
  if (!bounds) {
    throw new Error("Cannot derive projected bounds from empty tupleData");
  }

  const padding = options.padding ?? 0.05;
  if (!(padding >= 0)) {
    throw new Error(`lambertPadding/padding must be >= 0, got ${padding}`);
  }

  const extentX = bounds.maxX - bounds.minX;
  const extentY = bounds.maxY - bounds.minY;
  const padX = extentX > 0 ? extentX * padding : 1;
  const padY = extentY > 0 ? extentY * padding : 1;

  const x0: [number, number] = [bounds.minX - padX, bounds.minY - padY];
  const spanX = bounds.maxX + padX - x0[0];
  const spanY = bounds.maxY + padY - x0[1];
  const step: [number, number] = [spanX / Math.max(1, size[0] - 1), spanY / Math.max(1, size[1] - 1)];

  return {
    x0,
    step,
    size,
    projection,
    project: (lon: number, lat: number): [number, number] => {
      return wgs84ToLcc(projection, lon, lat);
    },
    unproject: (mapX: number, mapY: number): [number, number] => {
      return lccToWgs84(projection, mapX, mapY);
    },
  };
}
