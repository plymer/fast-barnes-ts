# fast-barnes-ts

Fast Barnes interpolation for irregularly spaced 1D/2D/3D samples, implemented in TypeScript for Node.js and browser
bundles. One peer dependency (`@types/geojson`) for typesafety.

This package ports the
[fast convolution-based approach from MeteoSwiss `fast-barnes-py`](https://github.com/MeteoSwiss/fast-barnes-py) into an
npm-friendly TypeScript API.

## AI Disclosure and Acknowledgements

Bruno Zürcher's [incredible work](https://gmd.copernicus.org/articles/16/1697/2023/gmd-16-1697-2023.pdf) of building
`fast-barnes-py` package makes this possible. The initial port of the Barnes logic was done via `gpt-5.3-codex`, but
iterations of the API surface have been human-generated and battle-tested in public and private projects. This package
was created to fill the gap of a weather-focused interpolation and feature extraction package in the npm ecosystem.

## Features

- A single peer dependency
- Fast `O(N + grid)` interpolation with `optimized_convolution` (default)
- Alternative methods available: `convolution`, `naive`
- Supports 1D, 2D, and 3D interpolation domains
- Typed TypeScript API, published for Node.js and browser usage
- Custom implementation of isoline, isoarea, and extrema extraction algorithms optimized for weather applications

## Install

```bash
pnpm i @plymer/fast-barnes-ts
pnpm i -D @types/geojson
```

## Quick start

```ts
// need to rework the whole example sections
```

## Core API

## Finding High/Low Pressure Centres

After interpolation, you can detect local maxima/minima (for highs/lows) and export them as GeoJSON points.

## License

[BSD 3-Clause](./LICENSE)
