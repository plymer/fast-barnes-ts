import type { Position } from "geojson";
import type { PolygonsWithLevels, PolylinesWithLevels } from "./types";
import { getThresholdValue } from "./helpers";

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

type PolylineWithValue = { value: number; coords: Position[] };

function closePolylines(polylines: PolylinesWithLevels, boundaries: Position[][]) {
  // lines we don't need to deal with - these are already valid polygon rings
  const closedLines: PolylineWithValue[] = [];
  // these are lines of length > 2 that are open
  const openLongLines: PolylineWithValue[] = [];
  // these are stubs that cannot automatically be dealt with by simply adding their first point to close them
  const openShortLines: PolylineWithValue[] = [];
  polylines.polylines.forEach((line, index) => {
    const value = getThresholdValue(polylines, index);

    const polylineWithValue: PolylineWithValue = { value, coords: line };

    if (line.length === 2) {
      openShortLines.push(polylineWithValue);
    } else if (line.length >= 3) {
      const [sx, sy] = line[0];
      const [ex, ey] = line[line.length - 1];

      if (sx === ex && sy === ey) {
        closedLines.push(polylineWithValue);
      } else {
        openLongLines.push(polylineWithValue);
      }
    }
  });

  return { closedLines, openLongLines, openShortLines };
}

export function generateIsoareas(
  polylines: PolylinesWithLevels,
  boundaries: Position[][],
  _options: IsoareaOptions,
): PolygonsWithLevels {
  const levelIndex = new Uint8Array(0);

  const { closedLines, openLongLines, openShortLines } = closePolylines(polylines, boundaries);

  console.log("closed:", closedLines.length);
  console.log("open-long:", openLongLines.length);
  console.log("open-short:", JSON.stringify(openShortLines, null, 2));
  console.log("boundary-points:", JSON.stringify(boundaries.flat(), null, 2));

  return { polygons: [], levelIndex, levelValues: [] };
}
