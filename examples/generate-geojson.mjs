import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { BarnesInterpolation } from "../dist/index.js";

function lcg(seed) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function makeSyntheticTupleData(count, x0, y0, width, height, seed = 123) {
  const rand = lcg(seed);
  const points = [];
  const values = [];

  for (let i = 0; i < count; i++) {
    const x = x0 + rand() * width;
    const y = y0 + rand() * height;

    const v = 1.8 * Math.sin(0.6 * x) + 1.2 * Math.cos(0.5 * y) + 0.5 * Math.sin(0.18 * x * y) + (rand() - 0.5) * 0.1;

    points.push([x, y]);
    values.push(v);
  }

  // generate the tuple 2d [x,y,value]
  const tuples = [];
  for (let i = 0; i < points.length; i++) {
    tuples.push([points[i][0], points[i][1], values[i]]);
  }

  return tuples;
}

async function main() {
  const resolution = [8, 8];
  const x0 = [10, 45.0];

  const tuples = makeSyntheticTupleData(600, x0[0], x0[1], 40.0, 20.0);

  const interpolation = new BarnesInterpolation(tuples, { resolution, sigma: 1.0, barnesOptions: {} });

  interpolation.computeIsolines(0.5);
  interpolation.computeIsoareas();

  const isolines = interpolation.getIsolines("geojson");
  const isoareas = interpolation.getIsoareas("geojson");

  const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "output");

  await fs.mkdir(outDir, { recursive: true });

  const areasPath = path.join(outDir, "isoareas.json");
  const linesPath = path.join(outDir, "isolines.json");

  await fs.writeFile(areasPath, JSON.stringify(isoareas, null, 2), "utf8");
  await fs.writeFile(linesPath, JSON.stringify(isolines, null, 2), "utf8");

  console.log("GeoJSON written:");
  console.log(`- ${areasPath} (${isoareas.features.length} features)`);
  console.log(`- ${linesPath} (${isolines.features.length} features)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
