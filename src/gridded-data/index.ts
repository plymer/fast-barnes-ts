import type { Position } from "geojson";
import type { PolygonsWithLevels, PolylinesWithLevels, ScalarField } from "../march/types";
import { computeDomainBoundary, computePolylines } from "../march";
import { computeThresholds } from "../march/isolines";
import { generateIsoareas } from "../march/isoareas";

export class GriddedData {
  field: ScalarField;
  projection: "WGS84" | "EPSG:3857";
  boundaries: Position[][] | undefined;
  polylines: PolylinesWithLevels | undefined;
  contourBands: PolygonsWithLevels | undefined;
  thresholdStep: number | undefined;
  thresholds: number[] | undefined;

  constructor(field: ScalarField, projection: "WGS84" | "EPSG:3857") {
    this.field = field;
    this.projection = projection;
  }

  public computeIsolines(thresholdStep: number) {
    this.thresholdStep = thresholdStep;
    this.thresholds = computeThresholds(this.field, this.thresholdStep);
    // store the raw polylines for helping with isoarea generation
    // we'll project the lines to the correct coordinate space when we
    // do the getIsolines function
    this.polylines = computePolylines(this.thresholds, this.field);
  }

  public getIsolines(format: "wkt" | "geojson" = "wkt") {
    // we'll have to implement some reprojection functions
    console.info("not implemented yet for", format);
  }

  public computeIsoareas(thresholdStep?: number) {
    // if no threshold step is provided, use the default value
    const threshold = thresholdStep ?? this.thresholdStep;

    if (!threshold) throw new Error("No threshold step was initialized for isoarea generation. Please specify one.");
    // check if thresholded isolines already exist, and then skip generating them
    // generate the boundary isolines

    this.boundaries = computeDomainBoundary(this.field);

    this.contourBands = generateIsoareas(this.polylines!, this.boundaries!, { thresholdStep: threshold });
  }

  public computeExtrema() {
    // this will require a different implementation than the one that uses the barnes data
    // due to the necessity of the projection functionality
    console.info("not implemented yet");
  }
}
