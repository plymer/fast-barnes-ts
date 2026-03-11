import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  barnes,
  fromObservations,
  gridToIsobandsGeoJSON,
  gridToIsolinesGeoJSON,
  toObservations,
} from "../dist/index.js";

function lcg(seed) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function makeSyntheticData(count, x0, y0, width, height, seed = 123) {
  const rand = lcg(seed);
  const points = [];
  const values = [];

  for (let i = 0; i < count; i++) {
    const x = x0 + rand() * width;
    const y = y0 + rand() * height;

    const v =
      1.8 * Math.sin(0.6 * x) +
      1.2 * Math.cos(0.5 * y) +
      0.5 * Math.sin(0.18 * x * y) +
      (rand() - 0.5) * 0.1;

    points.push([x, y]);
    values.push(v);
  }

  return { points, values };
}

async function main() {
  const resolution = 8;
  const step = 1 / resolution;
  const x0 = [-10.0, 45.0];
  const size = [Math.floor(20.0 / step), Math.floor(12.0 / step)];

  const { points, values } = makeSyntheticData(600, x0[0], x0[1], 20.0, 12.0);

  const observations = toObservations(points, values);
  const { points: pointsRoundTrip, values: valuesRoundTrip } = fromObservations(observations);

  const field = barnes(pointsRoundTrip, valuesRoundTrip, 0.9, x0, step, size, {
    method: "optimized_convolution",
    numIter: 4,
    maxDist: 3.5,
  });

  const isobands = gridToIsobandsGeoJSON(field, x0, step, {
    thresholds: 12,
    smooth: true,
  });

  const isolines = gridToIsolinesGeoJSON(field, x0, step, {
    thresholds: 12,
    smooth: true,
    outerRingsOnly: true,
  });

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const outDir = path.join(__dirname, "output");

  await fs.mkdir(outDir, { recursive: true });

  const bandsPath = path.join(outDir, "isobands.geojson");
  const linesPath = path.join(outDir, "isolines.geojson");

  await fs.writeFile(bandsPath, JSON.stringify(isobands, null, 2), "utf8");
  await fs.writeFile(linesPath, JSON.stringify(isolines, null, 2), "utf8");

  console.log("GeoJSON written:");
  console.log(`- ${bandsPath} (${isobands.features.length} features)`);
  console.log(`- ${linesPath} (${isolines.features.length} features)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
