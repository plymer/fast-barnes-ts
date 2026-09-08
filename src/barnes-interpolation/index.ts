import type { Feature, FeatureCollection, LineString, Position, Point } from "geojson";
import type { BarnesOptions, SphericalBarnesParams2D } from "../barnes/types";
import type { PolylinesWithLevels, ScalarField } from "../march/types";
import type { Tuple2DWithValue } from "../types";
import type { GridExtremaKind, GridExtremaPoint2D } from "../extrema/types";
import { barnes } from "../barnes";
import { getBarnesParams } from "../barnes/helpers";
import { computeThresholds } from "../march/isolines";
import { computePolylines, fieldFromTypedArray } from "../march/algorithm";
import { findGridExtrema2D } from "../extrema";

/**
 * Class for performing Barnes interpolation on a set of 2D points with associated values. Provides methods for computing isolines and converting them to different coordinate formats.
 *
 * @example
 * ```typescript
 * const interpolation = new BarnesInterpolation(tupleData, {
 *   resolution: [100, 100],
 *   sigma: 1.0,
 *   barnesOptions: { maxDist: 0.5, numIter: 10 },
 * });
 * interpolation.computeIsolines(0.1);
 * interpolation.computeExtrema();
 * const isolinesWkt = interpolation.getIsolines("wkt");
 * const extremaGeoJson = interpolation.getExtrema("geojson");
 * ```
 */
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

  private lonLatToWebMercator(lon: number, lat: number): { x: number; y: number } {
    const clampedLat = Math.max(Math.min(lat, 85.05112878), -85.05112878);
    const x = (lon * 20037508.34) / 180;
    const y = (Math.log(Math.tan(((90 + clampedLat) * Math.PI) / 360)) / (Math.PI / 180)) * (20037508.34 / 180);

    return { x, y };
  }

  private convertToWgs84(lines: Position[], paddingOffset?: { x: number; y: number }): Position[] {
    if (!paddingOffset) paddingOffset = { x: 0, y: 0 };
    return lines.map(([x, y]) =>
      this.barnesParams.unproject(
        this.barnesParams.x0[0] + paddingOffset.x + x * this.barnesParams.step[0]!,
        this.barnesParams.x0[1] + paddingOffset.y + y * this.barnesParams.step[1]!,
      ),
    );
  }

  private convertToWebMercator(lines: Position[], paddingOffset?: { x: number; y: number }): Position[] {
    return this.convertToWgs84(lines, paddingOffset).map(([lon, lat]) => {
      const { x, y } = this.lonLatToWebMercator(lon, lat);
      return [x, y] as Position;
    });
  }

  private getIsolineThreshold(polylines: PolylinesWithLevels, index: number) {
    return polylines.levelValues[polylines.polylineLevelIndex[index]!];
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

    switch (format) {
      case "wkt": {
        // convert the polyline data into Web Mercator coordinates
        const polylineOutput = {
          ...this.polylines,
          polylines: this.polylines?.polylines.map((line) => this.convertToWebMercator(line)),
        };

        if (!polylineOutput.polylines) throw new Error("No isolines have been computed.");
        const lines = polylineOutput.polylines.map((line, idx) => {
          return {
            value: this.getIsolineThreshold(this.polylines!, idx),
            geometry: `LINESTRING(${line.map(([lon, lat]) => `${lon} ${lat}`).join(",")})`,
          };
        });
        return lines;
      }
      case "geojson": {
        // convert the polyline data into geographic (WGS 84) coordinates
        const polylineOutput = {
          ...this.polylines,
          polylines: this.polylines?.polylines.map((line) => this.convertToWgs84(line)),
        };

        const lines: Feature<LineString, { value: number }>[] = polylineOutput.polylines!.map((line, idx) => ({
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: line,
          },
          properties: {
            value: this.getIsolineThreshold(this.polylines!, idx),
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
          const { x: mx, y: my } = this.lonLatToWebMercator(lng, lat);
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
