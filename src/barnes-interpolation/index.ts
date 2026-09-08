import type { Feature, FeatureCollection, LineString, Point } from "geojson";
import { barnes } from "../barnes";
import type { BarnesOptions, SphericalBarnesParams2D } from "../barnes/types";
import { getBarnesParams, lonLatToWebMercator } from "../helpers";
import { type PolylinesWithLevels } from "../march";
import { computeThresholds, convertToWgs84 } from "../march/isolines";
import { computePolylines, fieldFromTypedArray, type ScalarField } from "../march/algorithm";
import type { Tuple2DWithValue } from "../types";
import { findGridExtrema2D } from "../extrema";
import type { GridExtremaKind, GridExtremaPoint2D } from "../extrema/types";

export class BarnesInterpolation {
  tupleData: Tuple2DWithValue[];
  barnesData: Float32Array;
  barnesParams: SphericalBarnesParams2D;
  resolution: [number, number];
  sigma: number | readonly number[];
  shape: [number, number];
  dimension: 1 | 2 | 3;
  thresholdStep: number | undefined;
  thresholds: number[] | undefined;
  polylines: PolylinesWithLevels | undefined;
  field: ScalarField;
  extrema: GridExtremaPoint2D[] | undefined;

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

    this.barnesData = data;
    this.shape = shape as [number, number];
    this.dimension = dimension;
    this.field = fieldFromTypedArray(data, this.shape[0], this.shape[1]);
  }

  public computeIsolines(thresholdStep: number) {
    this.thresholdStep = thresholdStep;
    this.thresholds = computeThresholds(this.tupleData, this.thresholdStep);
    // store the raw polylines for helping with isoarea generation
    // we'll project the lines to the correct coordinate space when we
    // do the getIsolines function
    this.polylines = computePolylines(this.thresholds, this.field);
  }

  public getIsolines(format: "wkt"): { value: number; geometry: string }[];
  public getIsolines(format: "geojson"): FeatureCollection<LineString>;
  public getIsolines(
    format: "wkt" | "geojson" = "wkt",
  ): { value: number; geometry: string }[] | FeatureCollection<LineString> {
    if (!this.polylines) {
      if (!this.thresholdStep) {
        throw new Error("No threshold step was initialized for isoline generation. Please specify one.");
      }
      this.computeIsolines(this.thresholdStep);
    }

    // convert the polyline data into geographic (WGS 84) coordinates
    const polylineOutput = {
      ...this.polylines,
      polylines: this.polylines?.polylines.map((line) =>
        convertToWgs84(line, this.barnesParams.x0, this.barnesParams.step, this.barnesParams.unproject),
      ),
    };

    switch (format) {
      case "wkt": {
        if (!polylineOutput.polylines) throw new Error("No isolines have been computed.");
        const lineData = polylineOutput.polylines.map((line, idx) => {
          const coords = line.map(([lon, lat]) => {
            // since the WKT format expects coordinates in the Web Mercator projection, we convert them here
            // we couldn't do the conversion from internal Lambert Conformal Conic coordinates directly to
            // Web Mercator, so we had to do the conversion to WGS 84 and then to Web Mercator
            const { x, y } = lonLatToWebMercator(lon, lat);
            return `${x} ${y}`;
          });

          const value = polylineOutput.levelValues![polylineOutput.polylineLevelIndex![idx]];

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

  public computeExtrema() {
    this.extrema = findGridExtrema2D(
      { data: this.barnesData, shape: this.shape, dimension: this.dimension },
      this.barnesParams.x0,
      this.barnesParams.step,
    );
  }

  public getExtrema(format: "wkt"): { kind: GridExtremaKind; value: number; geometry: string }[];
  public getExtrema(format: "geojson"): FeatureCollection<Point>;
  public getExtrema(
    format: "wkt" | "geojson" = "wkt",
  ): { value: number; geometry: string }[] | FeatureCollection<Point> {
    if (!this.extrema) throw new Error("No extrema have been computed.");

    switch (format) {
      case "wkt": {
        return this.extrema.map((e) => {
          const { x, y, value, kind } = e;
          const [lng, lat] = this.barnesParams.unproject(x, y);
          const { x: mx, y: my } = lonLatToWebMercator(lng, lat);
          const geometry = `POINT(${mx} ${my})`;

          return {
            kind,
            geometry,
            value,
          };
        });
      }

      case "geojson": {
        return {
          type: "FeatureCollection",
          features: this.extrema.map((e) => ({
            type: "Feature",
            geometry: {
              type: "Point",
              coordinates: this.barnesParams.unproject(e.x, e.y),
            },
            properties: {
              kind: e.kind,
              value: e.value,
            },
          })),
        };
      }
    }
  }
}
