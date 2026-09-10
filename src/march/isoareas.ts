import type { Position } from "geojson";
import type { PolygonsWithLevels, PolylinesWithLevels } from "./types";
import { getThresholdValue } from "./helpers";

type IsoareaOptions = {
  shape: [number, number];
};

type PolylineWithValue = { value: number; coords: Position[]; index: number };

function pointIsOnBoundary(point: Position, shape: [number, number]) {
  return point[0] === 0 || point[0] === shape[0] - 1 || point[1] === 0 || point[1] === shape[1] - 1;
}

function convertToPolylineWithValue(polyline: Position[], value: number, index: number): PolylineWithValue {
  return { value, coords: polyline.map((p) => [...p]), index };
}

function boundaryOrderKey(point: Position, shape: [number, number]): [sideRank: number, distanceOnSide: number] {
  const [x, y] = point;
  const maxX = shape[0] - 1;
  const maxY = shape[1] - 1;

  // 0: south (west -> east)
  if (y === 0) return [0, x];
  // 1: east (south -> north)
  if (x === maxX) return [1, y];
  // 2: north (east -> west)
  if (y === maxY) return [2, maxX - x];
  // 3: west (north -> south)
  if (x === 0) return [3, maxY - y];

  return [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
}

function closePolylines(polylines: PolylinesWithLevels, boundaries: Position[][], shape: [number, number]) {
  const [xDim, yDim] = shape;

  // lines we don't need to deal with - these are already valid polygon rings
  const closedLines: PolylineWithValue[] = [];

  const polylinesWalked = new Set<number>();

  // holds the endpoints along the exterior boundaries that we will check against
  const lineTerminations: { polylineIndex: number; point: Position }[] = [];

  polylines.polylines.forEach((line, index) => {
    const value = getThresholdValue(polylines, index);

    const [sx, sy] = line[0];
    const [ex, ey] = line[line.length - 1];

    if (sx === ex && sy === ey) {
      // clone the line's coordinates (so we don't accidentally mutate the existing isoline)
      closedLines.push(convertToPolylineWithValue(line, value, index));
    } else {
      lineTerminations.push({ polylineIndex: index, point: line[0] });
      lineTerminations.push({ polylineIndex: index, point: line[line.length - 1] });
    }
  });

  // sort the lineTermination points in a CCW direction starting
  // with the bottom left corner [0,0]in grid space
  lineTerminations.sort((a, b) => {
    const [sideA, distanceA] = boundaryOrderKey(a.point, shape);
    const [sideB, distanceB] = boundaryOrderKey(b.point, shape);

    if (sideA !== sideB) return sideA - sideB;
    if (distanceA !== distanceB) return distanceA - distanceB;

    return 0;
  });

  // sort the exterior boundary points as well so we can walk them
  // (don't forget to remove the last point which is duplicated)
  // then splice the lineTermination points into this in the correct order too
  const exteriorBoundary = boundaries[0].slice(1).sort((a, b) => {
    const [sideA, distanceA] = boundaryOrderKey(a, shape);
    const [sideB, distanceB] = boundaryOrderKey(b, shape);

    if (sideA !== sideB) return sideA - sideB;
    if (distanceA !== distanceB) return distanceA - distanceB;

    return 0;
  });

  // sort the exterior boundary points as well so we can walk them
  // (don't forget to remove the last point which is duplicated)
  // then splice the lineTermination points into this in the correct order too
  const allBoundaryPoints = [...lineTerminations.map(({ point }) => point), ...exteriorBoundary].sort((a, b) => {
    const [sideA, distanceA] = boundaryOrderKey(a, shape);
    const [sideB, distanceB] = boundaryOrderKey(b, shape);

    if (sideA !== sideB) return sideA - sideB;
    if (distanceA !== distanceB) return distanceA - distanceB;

    return 0;
  });

  // traverse all points along the exterior of the domain (including boundary points and line terminations)
  for (const extPoint of allBoundaryPoints) {
    const [bX, bY] = extPoint;
    let pointToTest = undefined;
    if (bY === 0) {
      // along the bottom edge
      pointToTest = lineTerminations.find(({ point }) => point[0] >= bX && point[1] === bY);
    } else if (bX === xDim - 1) {
      pointToTest = lineTerminations.find(({ point }) => point[0] === bX && point[1] >= bY);
    } else if (bY === yDim - 1) {
      pointToTest = lineTerminations.find(({ point }) => point[0] <= bX && point[1] === bY);
    } else if (bX === 0) {
      pointToTest = lineTerminations.find(({ point }) => point[0] === bX && point[1] <= bY);
    }

    // we have no point to test
    if (pointToTest === undefined) continue;

    // we've already walked this polyline
    if (polylinesWalked.has(pointToTest.polylineIndex)) continue;

    // otherwise let's do the walkies
    if (pointToTest) {
      // get the polyline coordinates that map to the point we're testing
      const coords = polylines.polylines[pointToTest.polylineIndex];
      const [lineStartX, lineStartY] = coords[0];

      const direction = lineStartX === bX && lineStartY === bY ? "start" : "end";

      // clone our original coords
      const ccwLineCoords = direction === "end" ? [...coords] : [...coords].reverse();

      const pointsToAppend: Position[] = [];
      // the next point might belong to another polyline or be a continuation of the current one

      // find the next boundary point along the exterior of the domain that this polyline should connect to
      for (let i = allBoundaryPoints.indexOf(extPoint) + 1; i < allBoundaryPoints.length; i++) {
        const nextBoundaryPoint = allBoundaryPoints[i];
        console.log("current point", extPoint, "next boundary point:", nextBoundaryPoint);
        const lineTerminator = lineTerminations.find(
          ({ point }) => point[0] === nextBoundaryPoint[0] && point[1] === nextBoundaryPoint[1],
        );
        if (lineTerminator) {
          console.log("we hit a line terminator");
          console.log("line terminator polyline index:", lineTerminator.polylineIndex);
          console.log("did we hit ourself?:", lineTerminator.polylineIndex === pointToTest.polylineIndex);
          // here we need to break out and add the new line's coordinates to ours
          // and then pick back up along the boundary from this new line terminator's end
          break;
        }

        // we need to check if we've hit 'ourself' as well
      }

      console.log("direction:", direction, ccwLineCoords[0]);

      polylinesWalked.add(pointToTest.polylineIndex);
    }
  }

  // // check which boundary points could be included in the open lines
  // const closedShortLines = openLines
  //   .map((osl) => {
  //     const [sx, sy] = osl.coords[0];
  //     const [ex, ey] = osl.coords[osl.coords.length - 1];

  //     const minX = Math.min(sx, ex);
  //     const minY = Math.min(sy, ey);
  //     const maxX = Math.max(sx, ex);
  //     const maxY = Math.max(sy, ey);

  //     let boundaryToWalk: ("top" | "right" | "bottom" | "left")[] = [];

  //     if (minX === 0) boundaryToWalk.push("left");
  //     if (maxX === xDim - 1) boundaryToWalk.push("right");
  //     if (minY === 0) boundaryToWalk.push("bottom");
  //     if (maxY === yDim - 1) boundaryToWalk.push("top");

  //     if (boundaryToWalk.length === 1) {
  //       const [boundary] = boundaryToWalk;

  //       //collect the integer points along the boundary that might be between the x/y values of the first and last points
  //       switch (boundary) {
  //         case "top": {
  //           // dealing with yDim - 1 as the boundary condition
  //           // if we span across at least one grid unit, we need to collect the points inbetween along that boundary
  //           if (spansGridPoints(sx, ex)) {
  //             // check for all integer values between sx and ex along the top boundary
  //             // go from the rightmost point to the leftmost point along the top boundary
  //             // to maintain the correct CCW windind order
  //             for (let x = xDim - 1; x >= 0; x--) {
  //               if (x <= Math.max(sx, ex) && x >= Math.min(sx, ex)) {
  //                 console.log("adding", [x, yDim - 1]);
  //                 osl.coords.push([x, yDim - 1]);
  //               }
  //             }
  //           }
  //           break;
  //         }
  //         case "right": {
  //           // dealing with xDim -1 as the boundary condition
  //           if (spansGridPoints(sy, ey)) {
  //             for (let y = yDim - 1; y >= 0; y--) {
  //               if (y <= Math.max(sy, ey) && y >= Math.min(sy, ey)) {
  //                 console.log("adding", [xDim - 1, y]);
  //                 osl.coords.push([xDim - 1, y]);
  //               }
  //             }
  //           }
  //           break;
  //         }
  //         case "bottom": {
  //           // dealing with 0 as the boundary condition for y
  //           if (spansGridPoints(sx, ex)) {
  //             for (let x = xDim - 1; x >= 0; x--) {
  //               if (x <= Math.max(sx, ex) && x >= Math.min(sx, ex)) {
  //                 console.log("adding", [x, 0]);
  //                 osl.coords.push([x, 0]);
  //               }
  //             }
  //           }
  //           break;
  //         }
  //         case "left": {
  //           // dealing with 0 as the boundary condition for x
  //           if (spansGridPoints(sy, ey)) {
  //             for (let y = yDim - 1; y >= 0; y--) {
  //               if (y <= Math.max(sy, ey) && y >= Math.min(sy, ey)) {
  //                 console.log("adding", [0, y]);
  //                 osl.coords.push([0, y]);
  //               }
  //             }
  //           }
  //           break;
  //         }
  //       }

  //       // if we only touch one side, let's use the first point to close the polyline against that boundary
  //       return { ...osl, coords: [...osl.coords, osl.coords[0]] };
  //     }
  //   })
  //   .filter((osl) => osl !== undefined);

  return { closedLines, openLines: [], closedShortLines: [] };
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
