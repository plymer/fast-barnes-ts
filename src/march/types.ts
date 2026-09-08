import type { Position } from "geojson";

export type Edge = "top" | "right" | "bottom" | "left";
export type SegmentOnCell = [Edge, Edge];
export type Segment = [Position, Position];
export type FieldTopology = {
  x: number;
  y: number;
  segments: SegmentOnCell[];
};

export type PolylinesWithLevels = {
  polylines: Position[][];
  levelValues: number[]; // unique thresholds, stored once
  polylineLevelIndex: Uint8Array;
};

export type PolygonsWithLevels = {
  polygons: Position[][][]; // each polygon = [exteriorRing, ...holeRings]
  levelValues: number[]; // same thresholds as the source PolylinesWithLevels
  bandLevelIndex: Uint8Array; // index i => band spans [levelValues[i], levelValues[i + 1]]
};

export type EdgeCode = 0 | 1 | 2 | 3; // top, right, bottom, left
export type EdgeCodeSegment = readonly [EdgeCode, EdgeCode];

export type ScalarField = {
  xDim: number;
  yDim: number;
  get: (x: number, y: number) => number;
};
