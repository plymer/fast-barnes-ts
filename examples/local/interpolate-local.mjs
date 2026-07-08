import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { geoJSONtoGeoJSON } from "../../dist/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const defaultInputPath = path.join(__dirname, "data", "input.geojson");
const fallbackInputPath = path.join(__dirname, "output", "grid.geojson");
const envInputPath = process.env.INPUT_GEOJSON;
const inputPath = envInputPath ?? defaultInputPath;
const valueField = process.env.VALUE_FIELD ?? "slp";
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

function normalizeMode(value) {
  if (value === "isoline") return "isolines";
  if (value === "isoband") return "isobands";
  return value;
}

async function main() {
  if (!isMode(mode)) {
    throw new Error(`Invalid MODE '${mode}'. Use isoline|isolines|isoband|isobands.`);
  }

  if (!(spacing > 0)) {
    throw new Error(`SPACING must be > 0, got ${spacing}`);
  }

  let selectedInputPath = inputPath;
  let raw;
  try {
    raw = await fs.readFile(selectedInputPath, "utf8");
  } catch (err) {
    if (err?.code !== "ENOENT" || envInputPath) {
      throw err;
    }

    raw = await fs.readFile(fallbackInputPath, "utf8");
    selectedInputPath = fallbackInputPath;
    console.log(`- default input missing; using bundled sample: ${fallbackInputPath}`);
  }

  const selectedValueField = selectedInputPath === fallbackInputPath && !process.env.VALUE_FIELD ? "value" : valueField;

  const featureCollection = JSON.parse(raw);
  console.log(
    `- input features: ${Array.isArray(featureCollection?.features) ? featureCollection.features.length : 0}`,
  );

  const result = geoJSONtoGeoJSON(featureCollection, selectedValueField, normalizeMode(mode), {
    debug,
    resolution: [resolutionX, resolutionY],
    contourOptions: {
      spacing,
      base,
      smooth: true,
    },
  });

  await fs.mkdir(outputDir, { recursive: true });

  const fileName = mode.startsWith("iso") && mode.includes("line") ? "isolines.geojson" : "isobands.geojson";
  const outputPath = path.join(outputDir, fileName);

  await fs.writeFile(outputPath, JSON.stringify(result, null, 2), "utf8");

  console.log("Local interpolation complete:");
  console.log(`- input: ${selectedInputPath}`);
  console.log(`- output: ${outputPath}`);
  console.log(`- features: ${result.features.length}`);
  console.log(`- field: ${selectedValueField}`);
  console.log(`- mode: ${mode}`);
  console.log(`- spacing/base: ${spacing}/${base}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
