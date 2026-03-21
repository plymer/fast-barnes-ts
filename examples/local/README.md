# Local private-data workflow (gitignored)

## Interactive browser workflow (recommended)

Start server:

```bash
node examples/serve.mjs
```

Open:

- `http://localhost:4173/examples/local/maplibre-local.html`

Then:

- Choose your local GeoJSON file in the page
- Set field/mode/spacing/base/resolution
- Interpolation runs in-browser (auto-run on changes by default)

## CLI workflow

Put your private source file at:

- `examples/local/data/input.geojson`

This path is gitignored by default.

## Generate interpolation output

```bash
npm run example:local:interpolate
```

Optional environment variables:

- `INPUT_GEOJSON` (default: `examples/local/data/input.geojson`)
- `VALUE_FIELD` (default: `slp`)
- `MODE` (`isoline|isolines|isoband|isobands`, default: `isoline`)
- `SPACING` (default: `4`)
- `BASE` (default: `1024`)
- `RESOLUTION_X` (default: `128`)
- `RESOLUTION_Y` (default: `RESOLUTION_X`)
- `DEBUG` (`true|1` to enable verbose interpolation logs)

Output is written to gitignored files under:

- `examples/local/output/isolines.geojson` or
- `examples/local/output/isobands.geojson`

## View in MapLibre

Start server:

```bash
node examples/serve.mjs
```

Open:

- `http://localhost:4173/examples/local/maplibre-local.html`
