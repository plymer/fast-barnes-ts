import type { FeatureCollection, Point } from "geojson";
import { interpolateGeoJSON } from "../src";

type PressureProps = { slp: number; stationId: string };

const featureCollection: FeatureCollection<Point, PressureProps> = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [0, 0] },
      properties: { slp: 1024, stationId: "A" },
    },
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [1, 1] },
      properties: { slp: 1020, stationId: "B" },
    },
  ],
};

interpolateGeoJSON(featureCollection, "slp", "isolines", {
  coordinateMode: "spherical",
  sphericalOptions: {
    standardParallels: [42.5, 65.5],
  },
  contourOptions: { spacing: 4, base: 1024 },
});

// @ts-expect-error contourOptions is required
interpolateGeoJSON(featureCollection, "slp", "isolines");

// @ts-expect-error spacing is required in contourOptions
interpolateGeoJSON(featureCollection, "slp", "isolines", {
  contourOptions: { base: 1024 },
});
