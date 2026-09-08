import type { Position } from "geojson";
import type { PolylinesWithLevels, ScalarField } from "../march/types";
import { computeDomainBoundary, computePolylines } from "../march";
import { computeThresholds } from "../march/isolines";

export class GriddedData {
  field: ScalarField;
  projection: "WGS84" | "EPSG:3857";
  boundaries: Position[][] | undefined;
  polylines: PolylinesWithLevels | undefined;
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

  public computeBoundaries() {
    this.boundaries = computeDomainBoundary(this.field);
  }

  public computeIsoareas() {}

  public computeExtrema() {
    // this will require a different implementation than the one that uses the barnes data
    console.info("not implemented yet");
  }
}
