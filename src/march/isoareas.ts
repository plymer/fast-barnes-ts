import type { Position } from "geojson";
import type { PolygonsWithLevels, PolylinesWithLevels } from "./types";
import { getThresholdValue } from "./helpers";

type IsoareaOptions = {
  shape: [number, number];
};

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

function closePolylines(polylines: PolylinesWithLevels, boundaries: Position[][], shape: [number, number]) {
  const [xDim, yDim] = shape;

  // lines we don't need to deal with - these are already valid polygon rings
  const closedLines: PolylineWithValue[] = [];

  const openLines: PolylineWithValue[] = [];

  polylines.polylines.forEach((line, index) => {
    const value = getThresholdValue(polylines, index);

    // clone the line's coordinates (so we don't accidentally mutate the existing isoline)
    const polylineWithValue: PolylineWithValue = { value, coords: line.map((p) => [...p]) };

    const [sx, sy] = line[0];
    const [ex, ey] = line[line.length - 1];

    if (sx === ex && sy === ey) {
      closedLines.push(polylineWithValue);
    } else {
      openLines.push(polylineWithValue);
    }
  });

  // check which boundary points could be included in the open lines

  const closedShortLines = openLines
    .map((osl) => {
      const [sx, sy] = osl.coords[0];
      const [ex, ey] = osl.coords[osl.coords.length - 1];

      const minX = Math.min(sx, ex);
      const minY = Math.min(sy, ey);
      const maxX = Math.max(sx, ex);
      const maxY = Math.max(sy, ey);

      let boundaryToWalk: ("top" | "right" | "bottom" | "left")[] = [];

      if (minX === 0) boundaryToWalk.push("left");
      if (maxX === xDim - 1) boundaryToWalk.push("right");
      if (minY === 0) boundaryToWalk.push("bottom");
      if (maxY === yDim - 1) boundaryToWalk.push("top");

      if (boundaryToWalk.length === 1) {
        const [boundary] = boundaryToWalk;

        //collect the integer points along the boundary that might be between the x/y values of the first and last points
        switch (boundary) {
          case "top": {
            // dealing with yDim - 1 as the boundary condition
            // if we span across at least one grid unit, we need to collect the points inbetween along that boundary
            if (spansGridPoints(sx, ex)) {
              // check for all integer values between sx and ex along the top boundary
              // go from the rightmost point to the leftmost point along the top boundary
              // to maintain the correct CCW windind order
              for (let x = xDim - 1; x >= 0; x--) {
                if (x <= Math.max(sx, ex) && x >= Math.min(sx, ex)) {
                  console.log("adding", [x, yDim - 1]);
                  osl.coords.push([x, yDim - 1]);
                }
              }
            }
            break;
          }
          case "right": {
            // dealing with xDim -1 as the boundary condition
            if (spansGridPoints(sy, ey)) {
              for (let y = yDim - 1; y >= 0; y--) {
                if (y <= Math.max(sy, ey) && y >= Math.min(sy, ey)) {
                  console.log("adding", [xDim - 1, y]);
                  osl.coords.push([xDim - 1, y]);
                }
              }
            }
            break;
          }
          case "bottom": {
            // dealing with 0 as the boundary condition for y
            if (spansGridPoints(sx, ex)) {
              for (let x = xDim - 1; x >= 0; x--) {
                if (x <= Math.max(sx, ex) && x >= Math.min(sx, ex)) {
                  console.log("adding", [x, 0]);
                  osl.coords.push([x, 0]);
                }
              }
            }
            break;
          }
          case "left": {
            // dealing with 0 as the boundary condition for x
            if (spansGridPoints(sy, ey)) {
              for (let y = yDim - 1; y >= 0; y--) {
                if (y <= Math.max(sy, ey) && y >= Math.min(sy, ey)) {
                  console.log("adding", [0, y]);
                  osl.coords.push([0, y]);
                }
              }
            }
            break;
          }
        }

        // if we only touch one side, let's use the first point to close the polyline against that boundary
        return { ...osl, coords: [...osl.coords, osl.coords[0]] };
      }
    })
    .filter((osl) => osl !== undefined);

  return { closedLines, openLines, closedShortLines };
}

function spansGridPoints(start: number, end: number): boolean {
  return Math.abs(start - end) > 1;
}

export function generateIsoareas(
  polylines: PolylinesWithLevels,
  boundaries: Position[][],
  options: IsoareaOptions,
): PolygonsWithLevels {
  const levelIndex = new Uint8Array();

  const { closedLines, closedShortLines } = closePolylines(polylines, boundaries, options.shape);

  // if one of the x or y values is equal to either zero or the boundary limit, it might indicate an edge case for closing the polyline

  console.log("started closed:", closedLines.length);
  console.log("we closed:", closedShortLines.length);

  const polygons = [...closedLines, ...closedShortLines].map((line) => [line.coords]);

  return { polygons, levelIndex, levelValues: polylines.levelValues };
}
