import type { GeoJSONSphericalOptions, LambertProjectionParams } from "./types";

const RAD_PER_DEGREE = Math.PI / 180.0;
const HALF_RAD_PER_DEGREE = RAD_PER_DEGREE / 2.0;

export function validateSphericalCoordinates(
  points: ReadonlyArray<ReadonlyArray<number>>,
): void {
  const [lon, lat] = points[0];

  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    throw new Error(
      `Invalid spherical coordinates: [${lon}, ${lat}]. Coordinates must be finite numbers in degrees as [longitude, latitude].`,
    );
  }

  if (lat < -90 || lat > 90) {
    const looksSwapped = lon >= -90 && lon <= 90 && lat >= -180 && lat <= 180;
    if (looksSwapped) {
      throw new Error(
        `Invalid spherical coordinates: [${lon}, ${lat}] interpreted as [longitude, latitude]. Latitude must be within [-90, 90]. Coordinates appear swapped; expected [longitude, latitude] (lon, lat).`,
      );
    }

    throw new Error(
      `Invalid spherical coordinates: latitude ${lat} is out of range [-90, 90]. Expected [longitude, latitude] (lon, lat).`,
    );
  }

  if (lon < -180 || lon > 180) {
    throw new Error(
      `Invalid spherical coordinates: longitude ${lon} is out of range [-180, 180]. Expected [longitude, latitude] (lon, lat).`,
    );
  }
}

export function createLambertProjection(
  points: number[][],
  options: GeoJSONSphericalOptions | undefined,
): LambertProjectionParams {
  const bounds = getPointBounds(points);
  if (!bounds) {
    throw new Error("Cannot determine projection bounds from empty points");
  }

  const centerLon = options?.center?.[0] ?? (bounds.minX + bounds.maxX) / 2;
  const centerLat = options?.center?.[1] ?? (bounds.minY + bounds.maxY) / 2;

  const spanLat = Math.max(0.1, bounds.maxY - bounds.minY);
  const lat1Default = bounds.minY + spanLat * 0.25;
  const lat2Default = bounds.minY + spanLat * 0.75;

  let lat1 = options?.standardParallels?.[0] ?? lat1Default;
  let lat2 = options?.standardParallels?.[1] ?? lat2Default;

  lat1 = Math.max(-89.0, Math.min(89.0, lat1));
  lat2 = Math.max(-89.0, Math.min(89.0, lat2));
  if (Math.abs(lat1 - lat2) < 1e-8) {
    lat2 = Math.min(89.0, lat1 + 0.5);
  }

  const lat1Rad = lat1 * RAD_PER_DEGREE;
  const lat2Rad = lat2 * RAD_PER_DEGREE;

  const n =
    Math.abs(lat1 - lat2) > 1e-8
      ? Math.log(Math.cos(lat1Rad) / Math.cos(lat2Rad)) /
        Math.log(
          Math.tan((90.0 + lat2) * HALF_RAD_PER_DEGREE) /
            Math.tan((90.0 + lat1) * HALF_RAD_PER_DEGREE),
        )
      : Math.sin(lat1Rad);

  const nInv = 1.0 / n;
  const f =
    (Math.cos(lat1Rad) * Math.tan((90.0 + lat1) * HALF_RAD_PER_DEGREE) ** n) /
    n;
  const rho0 = f / Math.tan((90.0 + centerLat) * HALF_RAD_PER_DEGREE) ** n;

  return {
    centerLon,
    centerLat,
    n,
    nInv,
    f,
    rho0,
  };
}

export function lambertToMap(
  proj: LambertProjectionParams,
  lon: number,
  lat: number,
): [number, number] {
  const rho = proj.f / Math.tan((90.0 + lat) * HALF_RAD_PER_DEGREE) ** proj.n;
  const arg = proj.n * (lon - proj.centerLon) * RAD_PER_DEGREE;
  return [
    (rho * Math.sin(arg)) / RAD_PER_DEGREE,
    (proj.rho0 - rho * Math.cos(arg)) / RAD_PER_DEGREE,
  ];
}

export function lambertToGeo(
  proj: LambertProjectionParams,
  mapX: number,
  mapY: number,
): [number, number] {
  const x = mapX * RAD_PER_DEGREE;
  const arg = proj.rho0 - mapY * RAD_PER_DEGREE;
  let rho = Math.sqrt(x * x + arg * arg);
  if (proj.n < 0.0) {
    rho = -rho;
  }
  const theta = Math.atan2(x, arg);
  const lat = Math.atan((proj.f / rho) ** proj.nInv) / HALF_RAD_PER_DEGREE - 90.0;
  const lon = proj.centerLon + theta / proj.n / RAD_PER_DEGREE;
  return [lon, lat];
}

export function getPointBounds(points: number[][]): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} | null {
  if (points.length === 0) return null;

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < points.length; i++) {
    const [x, y] = points[i];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  return { minX, maxX, minY, maxY };
}