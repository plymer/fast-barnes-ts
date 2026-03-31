import { contours } from "d3-contour";
import type {
  Feature,
  FeatureCollection,
  GeoJsonProperties,
  LineString,
  MultiPolygon,
  Point,
  Position,
} from "geojson";
import type {
  InterpolateGeoJSONOptions,
  GeoJSONInterpolationMode,
  GeoJSONSphericalOptions,
  BarnesResult,
  GridExtremaGeoJSONProperties,
  GridExtremaOptions2D,
  GridExtremaPoint2D,
  GridContourOptions,
  ScalarOrVector,
  Tuple2DWithValue,
} from "./types";
import { barnes, findGridExtrema2D } from "./barnes";

export interface ContourProperties {
  value: number;
}

export type InterpolatedContourOrExtremaProperties =
  | ContourProperties
  | GridExtremaGeoJSONProperties;

type ExtremaEnabledOptions = InterpolateGeoJSONOptions & {
  extrema: true | GridExtremaOptions2D;
};

type ExtremaDisabledOptions = InterpolateGeoJSONOptions & {
  extrema?: false | undefined;
};

/**
 * End-to-end GeoJSON interpolation helper that converts point features to tuples,
 * interpolates with Barnes, and returns either isobands or isolines.
 *
 * With only the first three arguments, the interpolation grid is derived from point bounds.
 *
 * `valueProperty` is constrained to keys of the feature `properties` type.
 *
 * @param featureCollection GeoJSON points with numeric values in `properties`.
 * @param valueProperty Property key to read the sample value from each feature.
 * @param mode Output contour mode (`"isobands" | "isolines"`).
 * @param options Optional interpolation and contour settings.
 * @returns GeoJSON isobands (`MultiPolygon`) or isolines (`LineString`).
 */
export function geoJSONtoGeoJSON<P extends GeoJsonProperties, K extends string>(
  featureCollection: FeatureCollection<Point, P>,
  valueProperty: K & keyof NonNullable<P>,
  mode: "isolines",
  options: ExtremaDisabledOptions,
): FeatureCollection<LineString, ContourProperties>;

export function geoJSONtoGeoJSON<P extends GeoJsonProperties, K extends string>(
  featureCollection: FeatureCollection<Point, P>,
  valueProperty: K & keyof NonNullable<P>,
  mode: "isolines",
  options: ExtremaEnabledOptions,
): FeatureCollection<
  LineString | Point,
  InterpolatedContourOrExtremaProperties
>;

export function geoJSONtoGeoJSON<P extends GeoJsonProperties, K extends string>(
  featureCollection: FeatureCollection<Point, P>,
  valueProperty: K & keyof NonNullable<P>,
  mode: "isobands",
  options: ExtremaDisabledOptions,
): FeatureCollection<MultiPolygon, ContourProperties>;

export function geoJSONtoGeoJSON<P extends GeoJsonProperties, K extends string>(
  featureCollection: FeatureCollection<Point, P>,
  valueProperty: K & keyof NonNullable<P>,
  mode: "isobands",
  options: ExtremaEnabledOptions,
): FeatureCollection<
  MultiPolygon | Point,
  InterpolatedContourOrExtremaProperties
>;

export function geoJSONtoGeoJSON<P extends GeoJsonProperties, K extends string>(
  featureCollection: FeatureCollection<Point, P>,
  valueProperty: K & keyof NonNullable<P>,
  mode: GeoJSONInterpolationMode,
  options: InterpolateGeoJSONOptions,
):
  | FeatureCollection<
      MultiPolygon | Point,
      InterpolatedContourOrExtremaProperties
    >
  | FeatureCollection<
      LineString | Point,
      InterpolatedContourOrExtremaProperties
    > {
  const tupleArray = samplesFromGeoJSON(featureCollection, valueProperty);
  return tupleArrayToGeoJSON(tupleArray, mode, options);
}

export function tupleArrayToGeoJSON(
  tupleArray: Tuple2DWithValue[],
  mode: "isobands",
  options: ExtremaDisabledOptions,
): FeatureCollection<MultiPolygon, ContourProperties>;
export function tupleArrayToGeoJSON(
  tupleArray: Tuple2DWithValue[],
  mode: "isobands",
  options: ExtremaEnabledOptions,
): FeatureCollection<
  MultiPolygon | Point,
  InterpolatedContourOrExtremaProperties
>;
export function tupleArrayToGeoJSON(
  tupleArray: Tuple2DWithValue[],
  mode: "isolines",
  options: ExtremaDisabledOptions,
): FeatureCollection<LineString, ContourProperties>;
export function tupleArrayToGeoJSON(
  tupleArray: Tuple2DWithValue[],
  mode: "isolines",
  options: ExtremaEnabledOptions,
): FeatureCollection<
  LineString | Point,
  InterpolatedContourOrExtremaProperties
>;
export function tupleArrayToGeoJSON(
  tupleArray: Tuple2DWithValue[],
  mode: GeoJSONInterpolationMode,
  options: InterpolateGeoJSONOptions,
):
  | FeatureCollection<
      MultiPolygon | Point,
      InterpolatedContourOrExtremaProperties
    >
  | FeatureCollection<
      LineString | Point,
      InterpolatedContourOrExtremaProperties
    >;
export function tupleArrayToGeoJSON(
  tupleArray: Tuple2DWithValue[],
  mode: GeoJSONInterpolationMode,
  options: InterpolateGeoJSONOptions,
):
  | FeatureCollection<
      MultiPolygon | Point,
      InterpolatedContourOrExtremaProperties
    >
  | FeatureCollection<
      LineString | Point,
      InterpolatedContourOrExtremaProperties
    > {
  const hasAnyManualGridParam =
    options.x0 !== undefined ||
    options.step !== undefined ||
    options.size !== undefined;
  const hasAllManualGridParams =
    options.x0 !== undefined &&
    options.step !== undefined &&
    options.size !== undefined;

  if (hasAnyManualGridParam && !hasAllManualGridParams) {
    throw new Error(
      "When specifying manual grid parameters, provide x0, step, and size together",
    );
  }

  const coordinateMode = options.coordinateMode ?? "spherical";
  const useSpherical =
    coordinateMode === "spherical" && !hasAllManualGridParams;

  if (useSpherical) return handleSphericalMode(tupleArray, mode, options);
  else
    return handleEuclideanMode(
      tupleArray,
      mode,
      options,
      hasAllManualGridParams,
    );
}

export function handleEuclideanMode(
  tupleArray: Tuple2DWithValue[],
  mode: GeoJSONInterpolationMode,
  options: InterpolateGeoJSONOptions,
  hasAllManualGridParams: boolean,
):
  | FeatureCollection<
      LineString | Point,
      InterpolatedContourOrExtremaProperties
    >
  | FeatureCollection<
      MultiPolygon | Point,
      InterpolatedContourOrExtremaProperties
    > {
  const { points, values } = splitTuple2DArray(tupleArray);

  let x0: [number, number];
  let step: [number, number];
  let size: [number, number];

  if (hasAllManualGridParams) {
    x0 = normalize2DVector(options.x0 as ScalarOrVector, "x0");
    step = normalize2DVector(options.step as ScalarOrVector, "step");
    const sizeVec = normalize2DSize(options.size as number | readonly number[]);
    size = [sizeVec[0], sizeVec[1]];
  } else {
    const [rx, ry] = normalizeResolution(options.resolution);
    const padding = options.padding ?? 0.05;

    if (!(padding >= 0)) {
      throw new Error(`padding must be >= 0, got ${padding}`);
    }

    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (let i = 0; i < points.length; i++) {
      const [px, py] = points[i];
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }

    const extentX = maxX - minX;
    const extentY = maxY - minY;
    const padX = extentX > 0 ? extentX * padding : 1;
    const padY = extentY > 0 ? extentY * padding : 1;

    x0 = [minX - padX, minY - padY];
    size = [rx, ry];

    const spanX = maxX + padX - x0[0];
    const spanY = maxY + padY - x0[1];
    step = [spanX / Math.max(1, size[0] - 1), spanY / Math.max(1, size[1] - 1)];
  }

  const sigma = options.sigma ?? Math.max(step[0], step[1]) * 2.0;

  const grid = barnes(
    points,
    values,
    sigma,
    x0,
    step,
    size,
    options.barnesOptions ?? {},
  );

  if (mode === "isolines") {
    const linesOut = gridToIsolinesGeoJSON(
      grid,
      x0,
      step,
      options.contourOptions,
    );
    return appendExtremaFeatures(linesOut, grid, x0, step, options.extrema);
  }

  const bandsOut = gridToIsobandsGeoJSON(
    grid,
    x0,
    step,
    options.contourOptions,
  );
  return appendExtremaFeatures(bandsOut, grid, x0, step, options.extrema);
}

export function handleSphericalMode(
  tupleArray: Tuple2DWithValue[],
  mode: GeoJSONInterpolationMode,
  options: InterpolateGeoJSONOptions,
):
  | FeatureCollection<
      LineString | Point,
      InterpolatedContourOrExtremaProperties
    >
  | FeatureCollection<
      MultiPolygon | Point,
      InterpolatedContourOrExtremaProperties
    > {
  if (tupleArray.length === 0) {
    return { type: "FeatureCollection", features: [] };
  }

  if (tupleArray.length === 1) {
    const [x, y, value] = tupleArray[0];
    return {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {
            value,
            kind: "max",
            prominence: 0,
            gridIndex: 0,
            i: 0,
            j: 0,
          },
          geometry: {
            type: "Point",
            coordinates: [x, y],
          },
        },
      ],
    };
  }

  const { points, values } = splitTuple2DArray(tupleArray);
  validateSphericalCoordinates(points);

  const [rx, ry] = normalizeResolution(options.resolution);
  const projection = createLambertProjection(points, options.sphericalOptions);

  if (!projection) {
    throw new Error(
      "Failed to create Lambert projection for spherical interpolation",
    );
  }

  const mappedPoints = points.map((p) => lambertToMap(projection, p[0], p[1]));

  const padding =
    options.sphericalOptions?.lambertPadding ?? options.padding ?? 0.05;
  if (!(padding >= 0)) {
    throw new Error(`lambertPadding/padding must be >= 0, got ${padding}`);
  }

  const lambertBounds = getPointBounds(mappedPoints);
  if (!lambertBounds) {
    return { type: "FeatureCollection", features: [] };
  }

  const extentX = lambertBounds.maxX - lambertBounds.minX;
  const extentY = lambertBounds.maxY - lambertBounds.minY;
  const padX = extentX > 0 ? extentX * padding : 1;
  const padY = extentY > 0 ? extentY * padding : 1;

  const x0Lam: [number, number] = [
    lambertBounds.minX - padX,
    lambertBounds.minY - padY,
  ];
  const size: [number, number] = [rx, ry];
  const spanX = lambertBounds.maxX + padX - x0Lam[0];
  const spanY = lambertBounds.maxY + padY - x0Lam[1];
  const stepLam: [number, number] = [
    spanX / Math.max(1, size[0] - 1),
    spanY / Math.max(1, size[1] - 1),
  ];

  const sigma = options.sigma ?? Math.max(stepLam[0], stepLam[1]) * 2.0;

  const grid = barnes(
    mappedPoints,
    values,
    sigma,
    x0Lam,
    stepLam,
    size,
    options.barnesOptions ?? {},
  );

  if (mode === "isolines") {
    const linesLambert = gridToIsolinesGeoJSON(
      grid,
      x0Lam,
      stepLam,
      options.contourOptions,
    );
    const linesLonLat = transformIsolinesFromLambert(linesLambert, projection);
    if (!options.extrema) return linesLonLat;

    const extremaLambert = gridExtremaToGeoJSON(
      findGridExtrema2D(
        grid,
        x0Lam,
        stepLam,
        toExtremaOptions(options.extrema),
      ),
    );
    const extremaLonLat = transformExtremaFromLambert(
      extremaLambert,
      projection,
    );
    return mergeContourWithExtrema(linesLonLat, extremaLonLat);
  }

  const bandsLambert = gridToIsobandsGeoJSON(
    grid,
    x0Lam,
    stepLam,
    options.contourOptions,
  );
  const bandsLonLat = transformIsobandsFromLambert(bandsLambert, projection);
  if (!options.extrema) return bandsLonLat;

  const extremaLambert = gridExtremaToGeoJSON(
    findGridExtrema2D(grid, x0Lam, stepLam, toExtremaOptions(options.extrema)),
  );
  const extremaLonLat = transformExtremaFromLambert(extremaLambert, projection);
  return mergeContourWithExtrema(bandsLonLat, extremaLonLat);
}

function toExtremaOptions(
  extrema: InterpolateGeoJSONOptions["extrema"],
): GridExtremaOptions2D {
  if (extrema && typeof extrema === "object") {
    return extrema;
  }
  return {};
}

function appendExtremaFeatures<TGeom extends LineString | MultiPolygon>(
  contourCollection: FeatureCollection<TGeom, ContourProperties>,
  grid: BarnesResult,
  x0: [number, number],
  step: [number, number],
  extrema: InterpolateGeoJSONOptions["extrema"],
):
  | FeatureCollection<TGeom, ContourProperties>
  | FeatureCollection<TGeom | Point, InterpolatedContourOrExtremaProperties> {
  if (!extrema) {
    return contourCollection;
  }

  const extremaCollection = gridExtremaToGeoJSON(
    findGridExtrema2D(grid, x0, step, toExtremaOptions(extrema)),
  );
  return mergeContourWithExtrema(contourCollection, extremaCollection);
}

function mergeContourWithExtrema<TGeom extends LineString | MultiPolygon>(
  contourCollection: FeatureCollection<TGeom, ContourProperties>,
  extremaCollection: FeatureCollection<Point, GridExtremaGeoJSONProperties>,
): FeatureCollection<TGeom | Point, InterpolatedContourOrExtremaProperties> {
  return {
    type: "FeatureCollection",
    features: [
      ...(contourCollection.features as Array<
        Feature<TGeom | Point, InterpolatedContourOrExtremaProperties>
      >),
      ...(extremaCollection.features as Array<
        Feature<TGeom | Point, InterpolatedContourOrExtremaProperties>
      >),
    ],
  };
}

function validateSphericalCoordinates(points: number[][]): void {
  // check only the first point for validity, since all points will be transformed to the same projection
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

interface LambertProjection {
  centerLon: number;
  centerLat: number;
  n: number;
  nInv: number;
  f: number;
  rho0: number;
}

const RAD_PER_DEGREE = Math.PI / 180.0;
const HALF_RAD_PER_DEGREE = RAD_PER_DEGREE / 2.0;

function createLambertProjection(
  points: number[][],
  options: GeoJSONSphericalOptions | undefined,
): LambertProjection | null {
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

function lambertToMap(
  proj: LambertProjection,
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

function lambertToGeo(
  proj: LambertProjection,
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
  const lat =
    Math.atan((proj.f / rho) ** proj.nInv) / HALF_RAD_PER_DEGREE - 90.0;
  const lon = proj.centerLon + theta / proj.n / RAD_PER_DEGREE;
  return [lon, lat];
}

function getPointBounds(points: number[][]): {
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

function transformIsolinesFromLambert(
  collection: FeatureCollection<LineString, ContourProperties>,
  projection: LambertProjection,
): FeatureCollection<LineString, ContourProperties> {
  return {
    type: "FeatureCollection",
    features: collection.features.map((feature) => ({
      type: "Feature",
      properties: feature.properties,
      geometry: {
        type: "LineString",
        coordinates: feature.geometry.coordinates.map((pos) => {
          return lambertToGeo(projection, pos[0], pos[1]);
        }),
      },
    })),
  };
}

function transformIsobandsFromLambert(
  collection: FeatureCollection<MultiPolygon, ContourProperties>,
  projection: LambertProjection,
): FeatureCollection<MultiPolygon, ContourProperties> {
  return {
    type: "FeatureCollection",
    features: collection.features.map((feature) => ({
      type: "Feature",
      properties: feature.properties,
      geometry: {
        type: "MultiPolygon",
        coordinates: feature.geometry.coordinates.map((polygon) =>
          polygon.map((ring) =>
            ring.map((pos) => {
              return lambertToGeo(projection, pos[0], pos[1]);
            }),
          ),
        ),
      },
    })),
  };
}

function transformExtremaFromLambert(
  collection: FeatureCollection<Point, GridExtremaGeoJSONProperties>,
  projection: LambertProjection,
): FeatureCollection<Point, GridExtremaGeoJSONProperties> {
  return {
    type: "FeatureCollection",
    features: collection.features.map((feature) => ({
      type: "Feature",
      properties: feature.properties,
      geometry: {
        type: "Point",
        coordinates: lambertToGeo(
          projection,
          feature.geometry.coordinates[0],
          feature.geometry.coordinates[1],
        ),
      },
    })),
  };
}

/**
 * Builds tuple samples from a GeoJSON `FeatureCollection` of `Point` features.
 *
 * `valueProperty` is constrained to keys of the feature `properties` type.
 *
 * @param featureCollection GeoJSON points with numeric values in `properties`.
 * @param valueProperty Property key to read the sample value from each feature.
 * @returns Tuple array in `[x, y, value]` format.
 * @throws If a feature is not a `Point` or has a non-numeric property value.
 */
export function samplesFromGeoJSON<
  P extends GeoJsonProperties,
  K extends string,
>(
  featureCollection: FeatureCollection<Point, P>,
  valueProperty: K & keyof NonNullable<P>,
): Tuple2DWithValue[] {
  const tupleArray: Tuple2DWithValue[] = [];

  for (let i = 0; i < featureCollection.features.length; i++) {
    const feature = featureCollection.features[i];

    if (feature.geometry.type !== "Point") {
      console.warn(
        `Feature ${i} geometry must be Point, got ${feature.geometry.type}`,
      );
      continue;
    }

    const coords = feature.geometry.coordinates;
    if (coords.length !== 2) {
      console.warn(
        `Feature ${i} Point coordinates must have length 2, got ${coords.length}`,
      );
      continue;
    }

    const properties = feature.properties as NonNullable<P> | null | undefined;
    const rawValue = properties?.[valueProperty];
    if (rawValue === undefined || rawValue === null) {
      continue;
    }

    if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) {
      throw new Error(
        `Feature ${i} has non-numeric property '${String(valueProperty)}': ${String(rawValue)}`,
      );
    }

    tupleArray.push([coords[0], coords[1], rawValue]);
  }

  return tupleArray;
}

function splitTuple2DArray(tupleArray: Tuple2DWithValue[]): {
  points: number[][];
  values: number[];
} {
  const points = new Array<number[]>(tupleArray.length);
  const values = new Array<number>(tupleArray.length);

  for (let i = 0; i < tupleArray.length; i++) {
    const [x, y, value] = tupleArray[i];
    points[i] = [x, y];
    values[i] = value;
  }

  return { points, values };
}

/**
 * Converts a 2D Barnes interpolation grid into GeoJSON isobands (`MultiPolygon` features).
 *
 * @param grid 2D interpolation result from `barnes(...)`.
 * @param x0 Grid origin in data coordinates.
 * @param step Grid spacing in data coordinates.
 * @param options Contour generation options (`spacing` required, `base` defaults to `0`).
 * @returns GeoJSON `FeatureCollection` of `MultiPolygon` contour bands.
 */
export function gridToIsobandsGeoJSON(
  grid: BarnesResult,
  x0: ScalarOrVector,
  step: ScalarOrVector,
  options: GridContourOptions,
): FeatureCollection<MultiPolygon, ContourProperties> {
  ensure2DGrid(grid);
  const [sx, sy] = grid.shape;
  const [x0x, x0y] = normalize2DVector(x0, "x0");
  const [stepX, stepY] = normalize2DVector(step, "step");

  const generator = contours()
    .size([sx, sy])
    .thresholds(resolveThresholds(grid, options))
    .smooth(options.smooth ?? true);

  const res = generator(Array.from(grid.data));

  const features: Array<Feature<MultiPolygon, ContourProperties>> = res.map(
    (item) => ({
      type: "Feature",
      properties: {
        value: item.value,
      },
      geometry: {
        type: "MultiPolygon",
        coordinates: transformMultiPolygon(
          item.coordinates as number[][][][],
          x0x,
          x0y,
          stepX,
          stepY,
        ),
      },
    }),
  );

  return {
    type: "FeatureCollection",
    features,
  };
}

/**
 * Converts a 2D Barnes interpolation grid into GeoJSON isolines (`LineString` features).
 *
 * @param grid 2D interpolation result from `barnes(...)`.
 * @param x0 Grid origin in data coordinates.
 * @param step Grid spacing in data coordinates.
 * @param options Contour generation options.
 * @returns GeoJSON `FeatureCollection` of `LineString` contour lines.
 */
export function gridToIsolinesGeoJSON(
  grid: BarnesResult,
  x0: ScalarOrVector,
  step: ScalarOrVector,
  options: GridContourOptions,
): FeatureCollection<LineString, ContourProperties> {
  const bands = gridToIsobandsGeoJSON(grid, x0, step, options);

  const features: Array<Feature<LineString, ContourProperties>> = [];

  for (const band of bands.features) {
    const value = band.properties.value;
    for (const polygon of band.geometry.coordinates) {
      const rings = polygon;
      for (const ring of rings) {
        features.push({
          type: "Feature",
          properties: { value },
          geometry: {
            type: "LineString",
            coordinates: ring,
          },
        });
      }
    }
  }

  return {
    type: "FeatureCollection",
    features,
  };
}

/**
 * Converts detected grid extrema into a GeoJSON `FeatureCollection` of points.
 *
 * @param extrema Extrema points from `findGridExtrema2D(...)`.
 * @returns GeoJSON points with extrema metadata in properties.
 */
export function gridExtremaToGeoJSON(
  extrema: ReadonlyArray<GridExtremaPoint2D>,
): FeatureCollection<Point, GridExtremaGeoJSONProperties> {
  const features: Array<Feature<Point, GridExtremaGeoJSONProperties>> =
    new Array(extrema.length);

  for (let i = 0; i < extrema.length; i++) {
    const item = extrema[i];
    features[i] = {
      type: "Feature",
      properties: {
        kind: item.kind,
        value: item.value,
        prominence: item.prominence,
        gridIndex: item.gridIndex,
        i: item.i,
        j: item.j,
      },
      geometry: {
        type: "Point",
        coordinates: [item.x, item.y],
      },
    };
  }

  return {
    type: "FeatureCollection",
    features,
  };
}

function ensure2DGrid(grid: BarnesResult): void {
  if (grid.dimension !== 2) {
    throw new Error(
      `GeoJSON contour conversion expects 2D BarnesResult, got ${grid.dimension}D`,
    );
  }
  if (grid.shape.length !== 2) {
    throw new Error(
      `GeoJSON contour conversion expects shape [sx, sy], got ${grid.shape}`,
    );
  }
}

function normalize2DVector(
  value: ScalarOrVector,
  name: string,
): [number, number] {
  if (typeof value === "number") {
    return [value, value];
  }
  const arr = Array.from(value);
  if (arr.length !== 2) {
    throw new Error(
      `${name} must be scalar or length-2 array, got length ${arr.length}`,
    );
  }
  return [arr[0], arr[1]];
}

function normalize2DSize(size: number | readonly number[]): [number, number] {
  if (typeof size === "number") {
    throw new Error("size must be a length-2 array for GeoJSON interpolation");
  }
  const arr = Array.from(size);
  if (arr.length !== 2) {
    throw new Error(`size must be length-2, got length ${arr.length}`);
  }
  const sx = Math.trunc(arr[0]);
  const sy = Math.trunc(arr[1]);
  if (sx < 2 || sy < 2) {
    throw new Error(`size values must be >= 2, got [${sx}, ${sy}]`);
  }
  return [sx, sy];
}

function normalizeResolution(
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

function resolveThresholds(
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

function buildSpacedThresholds(
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

function transformMultiPolygon(
  coords: number[][][][],
  x0: number,
  y0: number,
  stepX: number,
  stepY: number,
): Position[][][] {
  return coords.map((polygon) =>
    polygon.map((ring) =>
      ring.map((pos) => transformPosition(pos, x0, y0, stepX, stepY)),
    ),
  );
}

function transformPosition(
  pos: readonly number[],
  x0: number,
  y0: number,
  stepX: number,
  stepY: number,
): Position {
  if (pos.length < 2) {
    throw new Error(`Invalid contour coordinate: ${pos}`);
  }
  return [x0 + pos[0] * stepX, y0 + pos[1] * stepY];
}
