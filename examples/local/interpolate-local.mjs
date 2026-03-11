import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { interpolateGeoJSON } from "../../dist/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const inputPath = process.env.INPUT_GEOJSON ?? path.join(__dirname, "data", "input.geojson");
const valueField = process.env.VALUE_FIELD ?? "pressure";
const mode = process.env.MODE ?? "isoline";
const spacing = Number(process.env.SPACING ?? "4");
const base = Number(process.env.BASE ?? "1024");
const resolutionX = Number(process.env.RESOLUTION_X ?? "128");
const resolutionY = Number(process.env.RESOLUTION_Y ?? String(resolutionX));
const debug = process.env.DEBUG === "1" || process.env.DEBUG === "true";
const outputDir = path.join(__dirname, "output");

function isMode(value) {
  return value === "isoline" || value === "isolines" || value === "isoband" || value === "isobands";
}

async function main() {
  if (!isMode(mode)) {
    throw new Error(`Invalid MODE '${mode}'. Use isoline|isolines|isoband|isobands.`);
  }

  if (!(spacing > 0)) {
    throw new Error(`SPACING must be > 0, got ${spacing}`);
  }

  const raw = await fs.readFile(inputPath, "utf8");
  const featureCollection = JSON.parse(raw);
  console.log(
    `- input features: ${Array.isArray(featureCollection?.features) ? featureCollection.features.length : 0}`,
  );

  const result = interpolateGeoJSON(featureCollection, valueField, mode, {
    debug,
    resolution: [resolutionX, resolutionY],
    contourOptions: {
      spacing,
      base,
      outerRingsOnly: true,
      smooth: true,
    },
  });

  await fs.mkdir(outputDir, { recursive: true });

  const fileName =
    mode.startsWith("iso") && mode.includes("line") ? "isolines.geojson" : "isobands.geojson";
  const outputPath = path.join(outputDir, fileName);

  await fs.writeFile(outputPath, JSON.stringify(result, null, 2), "utf8");

  console.log("Local interpolation complete:");
  console.log(`- input: ${inputPath}`);
  console.log(`- output: ${outputPath}`);
  console.log(`- features: ${result.features.length}`);
  console.log(`- field: ${valueField}`);
  console.log(`- mode: ${mode}`);
  console.log(`- spacing/base: ${spacing}/${base}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
