import type { Feature, FeatureCollection, LineString } from "geojson";
import { barnes } from "../barnes";
import type { BarnesOptions, SphericalBarnesParams2D } from "../barnes/types";
import { getBarnesParams, lonLatToWebMercator } from "../helpers";
import { type PolylinesWithLevels } from "../march";
import { computeThresholds } from "../march/isolines";
import { computePolylines, fieldFromTypedArray, type ScalarField } from "../march/march";
import type { Tuple2DWithValue } from "../types";

export class BarnesInterpolation {
  tupleData: Tuple2DWithValue[];
  barnesParams: SphericalBarnesParams2D;
  resolution: [number, number];
  sigma: number | readonly number[];
  shape: [number, number];
  dimension: 1 | 2 | 3;
  thresholdStep: number | undefined;
  thresholds: number[] | undefined;
  polylines: PolylinesWithLevels | undefined;
  field: ScalarField;

  constructor(
    tupleData: Tuple2DWithValue[],
    options: { resolution: [number, number]; sigma: number | readonly number[]; barnesOptions: BarnesOptions },
  ) {
    this.tupleData = tupleData;
    this.resolution = options.resolution;
    this.sigma = options.sigma;
    this.barnesParams = getBarnesParams(tupleData, { resolution: this.resolution });
    const projectedPoints = tupleData.map(([lon, lat]) => this.barnesParams.project(lon, lat));
    const values = tupleData.map(([, , value]) => value);

    const { data, shape, dimension } = barnes(
      projectedPoints,
      values,
      this.sigma,
      this.barnesParams.x0,
      this.barnesParams.step,
      this.barnesParams.size,
      options.barnesOptions,
    );

    this.shape = shape as [number, number];
    this.dimension = dimension;
    this.field = fieldFromTypedArray(data, this.shape[0], this.shape[1]);
  }

  public computeIsolines(thresholdStep: number) {
    this.thresholdStep = thresholdStep;
    this.thresholds = computeThresholds(this.tupleData, this.thresholdStep);
    this.polylines = computePolylines(this.thresholds, this.field);
  }

  public getIsolines(format: "wkt"): { value: number; geometry: string }[];
  public getIsolines(format: "geojson"): FeatureCollection<LineString>;
  public getIsolines(format: "wkt" | "geojson"): { value: number; geometry: string }[] | FeatureCollection<LineString> {
    if (!this.polylines) {
      if (!this.thresholdStep) {
        throw new Error("No threshold step was initialized for isoline generation. Please specify one.");
      }
      this.computeIsolines(this.thresholdStep);
    }

    switch (format) {
      case "wkt": {
        if (!this.polylines) throw new Error("No isolines have been computed.");
        const lineData = this.polylines.polylines.map((line, idx) => {
          const coords = line.map(([lon, lat]) => {
            const { x, y } = lonLatToWebMercator(lon, lat);
            return `${x} ${y}`;
          });

          const value = this.polylines!.levelValues[this.polylines!.polylineLevelIndex[idx]!];

          return { value, geometry: `LINESTRING(${coords.join(",")})` };
        });
        return lineData;
      }
      case "geojson": {
        const lines: Feature<LineString>[] = this.polylines!.polylines.map((line, idx) => ({
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: line,
          },
          properties: {
            value: this.polylines!.levelValues[this.polylines!.polylineLevelIndex[idx]!],
          },
        }));

        return { features: lines, type: "FeatureCollection" };
      }
    }
  }

  public isoareas(format: "wkt" | "geojson", thresholdStep?: number) {
    // if no threshold step is provided, use the default value
    const threshold = thresholdStep ?? this.thresholdStep;

    if (!threshold) throw new Error("No threshold step was initialized for isoarea generation. Please specify one.");
    // check if thresholded isolines already exist, and then skip generating them
    // generate the boundary isolines
  }

  public extrema(format: "wkt" | "geojson") {}
}
