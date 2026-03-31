# fast-barnes-ts

Fast Barnes interpolation for irregularly spaced 1D/2D/3D samples, implemented in TypeScript for Node.js and browser bundles.

This package ports the [fast convolution-based approach from MeteoSwiss `fast-barnes-py`](https://github.com/MeteoSwiss/fast-barnes-py) into an npm-friendly TypeScript API.

It includes built-in support for reading GeoJSON `FeatureCollection` point data and generating contour outputs as GeoJSON `FeatureCollection` isolines or isobands.

> This project was created with extensive help from GPT-5.3-Codex but ground-truthed by a professional operational meteorologist

## Acknowledgements

This is a mostly vibe-coded port of Bruno Zürcher's [incredible work](https://gmd.copernicus.org/articles/16/1697/2023/gmd-16-1697-2023.pdf) building the `fast-barnes-py` package and would be impossible without him. This package was created to fill a need for a fast, browser-capable solution to interpolating weather data.

## Features

- Fast `O(N + grid)` interpolation with `optimized_convolution` (default)
- Alternative methods available: `convolution`, `naive`
- Supports 1D, 2D, and 3D interpolation domains
- Typed TypeScript API, published for Node.js and browser usage
- GeoJSON-first helpers for common weather and geospatial workflows

## Install

```bash
npm install fast-barnes-ts
```

## Quick start

```ts
import { barnes, toNestedArray } from "fast-barnes-ts";

const points = [
  [-3.73, 56.33],
  [2.64, 47.05],
  [-8.4, 47.5],
  [2.94, 54.33],
];

const values = [995.1, 1012.5, 1011.3, 1006.0];

const resolution = 32;
const step = 1 / resolution;
const x0 = [-9, 47];
const size = [Math.floor(12 / step), Math.floor(12 / step)];

const result = barnes(points, values, 1.0, x0, step, size, {
  method: "optimized_convolution",
  numIter: 4,
  maxDist: 3.5,
});

const grid = toNestedArray(result); // grid[y][x]
```

## GeoJSON workflow

Read station samples from a GeoJSON `FeatureCollection<Point>` and generate contour outputs in one call.

```ts
import { geoJSONtoGeoJSON } from "@plymer/fast-barnes-ts";
import type { FeatureCollection, Point } from "geojson";

type PressureProps = { pressure: number; stationId: string };

declare const stations: FeatureCollection<Point, PressureProps>;

const isolines = geoJSONtoGeoJSON(stations, "pressure", "isoline", {
  contourOptions: { spacing: 4, base: 1024 },
  extrema: {
    minProminence: 1.5,
    minSeparation: 3,
  },
});

const isobands = geoJSONtoGeoJSON(stations, "pressure", "isoband", {
  contourOptions: { spacing: 4, base: 1024 },
});
```

Or, convert a tuple array in the form of `[x, y, value][]` directly to contours.

```ts
import {
  tupleArrayToGeoJSON,
  type Tuple2DWithValue,
} from "@plymer/fast-barnes-ts";

const samples: Tuple2DWithValue[] = [
  [0.2, 0.2, 1.0],
  [1.2, 1.1, 2.0],
  [2.5, 0.7, 0.5],
  [0.4, 1.7, 1.4],
];

const isolines = tupleArrayToGeoJSON(samples, "isolines", {
  resolution: 64,
  contourOptions: { spacing: 0.25, base: 0 },
});

const isobands = tupleArrayToGeoJSON(samples, "isobands", {
  resolution: 64,
  contourOptions: { spacing: 0.25, base: 0 },
});
```

Both `isolines` and `isobands` are returned as GeoJSON `FeatureCollection` objects.

Isoline output is clipped at the interpolation domain edge, so contours end at
the boundary instead of tracing the rectangular grid frame. Interior no-data
(NaN) void boundaries are also excluded from isoline output. Isobands keep
their full polygon geometry.

Set `extrema: true` (or pass extrema options) to append local max/min `Point`
features to the same output collection.

## Core API

### `barnes(pts, val, sigma, x0, step, size, options?)`

- `pts`: `number[]` (1D) or `number[][]` (NxM, M in `{1,2,3}`)
- `val`: values for each sample point
- `sigma`: scalar or per-axis vector
- `x0`: grid origin (scalar or vector)
- `step`: grid spacing (scalar or vector)
- `size`: grid size (scalar or vector)
- `options.method`: `'optimized_convolution' | 'convolution' | 'naive'`
- `options.numIter`: iteration count (default `4`)
- `options.maxDist`: cutoff distance in sigma units (default `3.5`)

Alternative overload:

### `barnes(tupleArray, sigma, x0, step, size, options?)`

- `tupleArray`: `[x, value][]` (1D), `[x, y, value][]` (2D), or `[x, y, z, value][]` (3D)
- optimized for direct tuple ingestion without object-sample conversion

Return shape:

```ts
{
  data: Float32Array;
  shape: readonly number[];
  dimension: 1 | 2 | 3;
}
```

## GeoJSON helpers

- `samplesFromGeoJSON(featureCollection, propertyKey)`
- `geoJSONtoGeoJSON(featureCollection, propertyKey, mode, options?)`
- `tupleArrayToGeoJSON(samples, mode, options?)`
- `gridToIsolinesGeoJSON(field, x0, step, contourOptions)`
- `gridToIsobandsGeoJSON(field, x0, step, contourOptions)`

Additional utility helpers:

- `toNestedArray(result)`
- `findGridExtrema2D(grid, x0, step, options?)`
- `gridExtremaToGeoJSON(extrema)`
- `getHalfKernelSize(...)`
- `getHalfKernelSizeOpt(...)`
- `getTailValue(...)`
- `getSigmaEffective(...)`

## Finding High/Low Pressure Centres

After interpolation, you can detect local maxima/minima (for highs/lows) and
export them as GeoJSON points.

```ts
import {
  barnes,
  findGridExtrema2D,
  gridExtremaToGeoJSON,
  type Tuple2DWithValue,
} from "fast-barnes-ts";

const samples: Tuple2DWithValue[] = [
  [-4.0, 51.0, 1008.2],
  [-1.8, 52.2, 1015.4],
  [1.2, 50.5, 1002.7],
  [2.8, 53.0, 1012.3],
];

const x0: [number, number] = [-6, 49];
const step: [number, number] = [0.1, 0.1];
const size: [number, number] = [160, 120];

const grid = barnes(samples, 0.5, x0, step, size, {
  method: "optimized_convolution",
  numIter: 4,
});

const extrema = findGridExtrema2D(grid, x0, step, {
  radius: 1,
  minSeparation: 3,
  minProminence: 0.8,
});

const centresGeoJSON = gridExtremaToGeoJSON(extrema);
```

`findGridExtrema2D` returns both maxima and minima, each with:

- `kind`: `"max"` or `"min"`
- `value`: interpolated field value at that grid cell
- `prominence`: local strength relative to nearby cells
- `gridIndex`, `i`, `j`: grid coordinates
- `x`, `y`: map/data coordinates

## Examples

Generate example contour files:

```bash
npm run example:geojson
```

This writes:

- `examples/output/isobands.geojson`
- `examples/output/isolines.geojson`

Run the CDN-based MapLibre viewer:

```bash
npm run example:maplibre
```

Open:

- `http://localhost:4173/examples/maplibre-viewer.html`

## Development

```bash
npm install
npm run test
npm run build
npm run benchmark
```

## License

[BSD 3-Clause](./LICENSE)
