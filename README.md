# fast-barnes-ts

Fast Barnes interpolation for irregularly spaced 1D/2D/3D samples, implemented in TypeScript for Node.js and browser bundles.

This package ports the fast convolution-based approach from MeteoSwiss `fast-barnes-py` into an npm-friendly TypeScript API.

## Features

- Fast `O(N + grid)` Barnes interpolation (`optimized_convolution`, default)
- Also supports `convolution` and `naive` methods
- 1D, 2D, and 3D Euclidean grids
- Typed API with ESM + CommonJS builds

## Install

```bash
npm install fast-barnes-ts
```

## Quick start (2D)

```ts
import { barnes, toNestedArray } from "fast-barnes-ts";

const points = [
  [-3.73, 56.33],
  [2.64, 47.05],
  [-8.4, 47.5],
  [2.94, 54.33],
];

const values = [995.1, 1012.5, 1011.3, 1006.0];

const resolution = 32.0;
const step = 1.0 / resolution;
const x0 = [-9.0, 47.0];
const size = [Math.floor(12.0 / step), Math.floor(12.0 / step)];

const field = barnes(points, values, 1.0, x0, step, size, {
  method: "optimized_convolution",
  numIter: 4,
  maxDist: 3.5,
});

const grid = toNestedArray(field); // grid[y][x]
```

## GeoJSON contours

```ts
import { barnes, gridToIsobandsGeoJSON, gridToIsolinesGeoJSON } from "fast-barnes-ts";

const field = barnes(points, values, 1.0, x0, step, size, {
  method: "optimized_convolution",
  numIter: 4,
});

const isobands = gridToIsobandsGeoJSON(field, x0, step, {
  spacing: 1,
});

const isolines = gridToIsolinesGeoJSON(field, x0, step, {
  spacing: 1,
  outerRingsOnly: true,
});
```

Both helpers return GeoJSON `FeatureCollection` objects ready to plot.

### End-to-end GeoJSON file export

Run the built-in example:

```bash
npm run example:geojson
```

It writes:

- `examples/output/isobands.geojson`
- `examples/output/isolines.geojson`

You can load either file directly into MapLibre, Leaflet, or deck.gl.

### CDN MapLibre viewer example

This repo includes a browser viewer that uses MapLibre via CDN (no frontend build step).

```bash
npm run example:maplibre
```

Then open:

- `http://localhost:4173/examples/maplibre-viewer.html`

This command regenerates the sample GeoJSON and starts a local static server.

## API

### `barnes(pts, val, sigma, x0, step, size, options?)`

- `pts`: `number[]` (1D) or `number[][]` (NxM, M in {1,2,3})
- `val`: sample values, length `N`
- `sigma`: scalar or vector (length `M`)
- `x0`: scalar or vector (grid start)
- `step`: scalar or vector (grid spacing)
- `size`: number (1D) or vector (grid extents)
- `options.method`: `'optimized_convolution' | 'convolution' | 'naive'`
- `options.numIter`: convolution iterations (default `4`)
- `options.maxDist`: distance cutoff in sigma units (default `3.5`)

Alternative input form is also supported:

### `barnes(samples, sigma, x0, step, size, options?)`

- `samples`: array of objects like `{ point, value }`
- `point`: scalar (1D) or coordinate array (e.g. `[x, y]`)
- `value`: sample value

Returns:

```ts
{
  data: Float32Array;
  shape: readonly number[];
  dimension: 1 | 2 | 3;
}
```

### Helpers

- `getHalfKernelSize(...)`
- `getHalfKernelSizeOpt(...)`
- `getTailValue(...)`
- `getSigmaEffective(...)`
- `toSamples(points, values)`
- `fromSamples(samples)`
- `samplesFromGeoJSON(featureCollection, propertyKey)`
- `interpolateGeoJSON(featureCollection, propertyKey, mode, options?)`
- `toNestedArray(result)`

Example:

```ts
import { fromSamples, toSamples, barnes } from "fast-barnes-ts";

const samples = toSamples(points, values);
const { points: pointsBack, values: valuesBack } = fromSamples(samples);
const field = barnes(samples, sigma, x0, step, size);
```

GeoJSON input example:

```ts
import type { FeatureCollection, GeoJsonProperties, Point } from "geojson";
import { barnes, samplesFromGeoJSON } from "fast-barnes-ts";

const featureCollection: FeatureCollection<Point, GeoJsonProperties> = data;

const samples = samplesFromGeoJSON(featureCollection, "pressure");
const field = barnes(samples, sigma, x0, step, size);

// For compile-time key checking, use a concrete properties type:
type PressureProps = { pressure: number; stationId: string };
const typedCollection: FeatureCollection<Point, PressureProps> = data;
const typedSamples = samplesFromGeoJSON(typedCollection, "pressure"); // ✅
// samplesFromGeoJSON(typedCollection, "temperature"); // ❌ not a key of PressureProps
```

Single-call interpolation to contours:

```ts
import { interpolateGeoJSON } from "fast-barnes-ts";

const isolines = interpolateGeoJSON(featureCollection, "pressure", "isoline", {
  contourOptions: { spacing: 1 },
});
const isobands = interpolateGeoJSON(featureCollection, "pressure", "isoband", {
  resolution: [96, 96],
  contourOptions: { spacing: 1 },
});

const pressureIsolines = interpolateGeoJSON(featureCollection, "pressure", "isoline", {
  contourOptions: {
    spacing: 4,
    base: 1024,
  },
});
```

`contourOptions.spacing` and `contourOptions.base` generate levels at:

- `base + k * spacing` for integer `k` (with `base` defaulting to `0`)
- covering the interpolated data range (both upward and downward from `base`)

`spacing` is required for contour generation.

## Notes

- 2D output indexing follows `[y, x]`; 3D follows `[z, y, x]`.
- This package focuses on Euclidean interpolation. Spherical `S²` support from `fast-barnes-py` is not included in this initial release.

## Development

```bash
npm install
npm run test
npm run build
npm run benchmark
```

### Benchmark tuning

`npm run benchmark` uses a quick preset workload so it completes fast.

For custom workloads, use:

```bash
npm run benchmark:custom
```

Custom benchmark supports optional environment variables:

- `BENCH_SAMPLES` (default `1200`)
- `BENCH_RESOLUTION` (default `8`)
- `BENCH_SIGMA` (default `1.0`)
- `BENCH_ITER` (default `4`)
- `BENCH_REPS` (default `3`)

Example:

```bash
BENCH_SAMPLES=5000 BENCH_REPS=5 npm run benchmark
```

## License

MIT
