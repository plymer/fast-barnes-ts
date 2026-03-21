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
import { interpolateGeoJSON } from "fast-barnes-ts";
import type { FeatureCollection, Point } from "geojson";

type PressureProps = { pressure: number; stationId: string };

declare const stations: FeatureCollection<Point, PressureProps>;

const isolines = interpolateGeoJSON(stations, "pressure", "isoline", {
  contourOptions: { spacing: 4, base: 1024 },
});

const isobands = interpolateGeoJSON(stations, "pressure", "isoband", {
  contourOptions: { spacing: 4, base: 1024 },
});
```

Both `isolines` and `isobands` are returned as GeoJSON `FeatureCollection` objects.

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

### `barnes(samples, sigma, x0, step, size, options?)`

- `samples`: `{ point, value }[]`
- `point`: scalar (1D) or coordinate array
- `value`: numeric sample value

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
- `interpolateGeoJSON(featureCollection, propertyKey, mode, options?)`
- `gridToIsolinesGeoJSON(field, x0, step, contourOptions)`
- `gridToIsobandsGeoJSON(field, x0, step, contourOptions)`

Additional utility helpers:

- `toSamples(points, values)`
- `fromSamples(samples)`
- `toNestedArray(result)`
- `getHalfKernelSize(...)`
- `getHalfKernelSizeOpt(...)`
- `getTailValue(...)`
- `getSigmaEffective(...)`

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
