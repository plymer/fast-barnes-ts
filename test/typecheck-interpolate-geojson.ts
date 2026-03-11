import type { FeatureCollection, Point } from "geojson";
import { interpolateGeoJSON } from "../src";

type PressureProps = { pressure: number; stationId: string };

const featureCollection: FeatureCollection<Point, PressureProps> = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [0, 0] },
      properties: { pressure: 1024, stationId: "A" },
    },
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [1, 1] },
      properties: { pressure: 1020, stationId: "B" },
    },
  ],
};

interpolateGeoJSON(featureCollection, "pressure", "isoline", {
  contourOptions: { spacing: 4, base: 1024 },
});

// @ts-expect-error contourOptions is required
interpolateGeoJSON(featureCollection, "pressure", "isoline");

// @ts-expect-error spacing is required in contourOptions
interpolateGeoJSON(featureCollection, "pressure", "isoline", {
  contourOptions: { base: 1024 },
});
