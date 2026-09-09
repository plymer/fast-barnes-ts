import type { Position } from "geojson";
import type { PolygonsWithLevels, PolylinesWithLevels } from "./types";

type IsoareaOptions = {};

// A single closed ring produced either directly from a closed polyline, or by closing an open
// polyline against the boundary ring it exits through.
type Ring = {
  linePoints: Position[];
  levelIndex: number;
  // vertices needed to close an open polyline against the boundary it touches, kept separate from
  // linePoints so duplicate boundary-hugging vertices claimed by another ring can be dropped later.
  closingRefs?: { point: Position; boundaryRingIndex: number; segmentIndex: number }[];
};

const pointEpsilon = 1e-7;

export function generateIsoareas(
  polylines: PolylinesWithLevels,
  _boundaries: Position[][],
  _options: IsoareaOptions,
): PolygonsWithLevels {
  const levelIndex = new Uint8Array(polylines.polylines.length);

  return { polygons: [], levelIndex, levelValues: [] };
}
