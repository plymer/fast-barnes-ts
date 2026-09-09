import type { Position } from "geojson";
import type { PolygonsWithLevels, PolylinesWithLevels } from "./types";
import { pointInRing } from "./helpers";

type IsoareaOptions = {
  shape: [number, number];
};

type PolylineWithLevel = { levelIdx: number; coords: Position[] };

type BoundaryLocation = {
  boundaryRingIndex: number;
  segmentIndex: number;
  t: number;
  point: Position;
};

const pointMatchEpsilon = 1e-9;

function nearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= pointMatchEpsilon;
}

function pointsEqual(a: Position, b: Position): boolean {
  return nearlyEqual(a[0], b[0]) && nearlyEqual(a[1], b[1]);
}

function pointOnBoundarySegment(point: Position, a: Position, b: Position): number | undefined {
  const [px, py] = point;
  const [ax, ay] = a;
  const [bx, by] = b;
  const dx = bx - ax;
  const dy = by - ay;

  // Domain boundary segments are axis-aligned and should have non-zero length.
  if (Math.abs(dx) > pointMatchEpsilon) {
    if (!nearlyEqual(py, ay) || !nearlyEqual(py, by)) return undefined;
    const t = (px - ax) / dx;
    return t >= -pointMatchEpsilon && t <= 1 + pointMatchEpsilon ? Math.min(1, Math.max(0, t)) : undefined;
  }

  if (Math.abs(dy) > pointMatchEpsilon) {
    if (!nearlyEqual(px, ax) || !nearlyEqual(px, bx)) return undefined;
    const t = (py - ay) / dy;
    return t >= -pointMatchEpsilon && t <= 1 + pointMatchEpsilon ? Math.min(1, Math.max(0, t)) : undefined;
  }

  return undefined;
}

function findBoundaryLocations(point: Position, boundaries: Position[][]): BoundaryLocation[] {
  const locations: BoundaryLocation[] = [];

  boundaries.forEach((ring, boundaryRingIndex) => {
    const segmentCount = ring.length - 1;
    if (segmentCount < 1) return;

    for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex++) {
      const a = ring[segmentIndex]!;
      const b = ring[segmentIndex + 1]!;
      const t = pointOnBoundarySegment(point, a, b);
      if (t === undefined) continue;
      locations.push({ boundaryRingIndex, segmentIndex, t, point });
    }
  });

  return locations;
}

function pushIfDistinct(points: Position[], point: Position) {
  const last = points[points.length - 1];
  if (!last || !pointsEqual(last, point)) points.push(point);
}

function boundaryScalar(ref: BoundaryLocation): number {
  return ref.segmentIndex + ref.t;
}

function forwardBoundaryDistance(from: BoundaryLocation, to: BoundaryLocation, segmentCount: number): number {
  const fromScalar = boundaryScalar(from);
  const toScalar = boundaryScalar(to);
  return toScalar >= fromScalar ? toScalar - fromScalar : segmentCount - (fromScalar - toScalar);
}

function buildBoundaryPath(
  ring: Position[],
  from: BoundaryLocation,
  to: BoundaryLocation,
  direction: 1 | -1,
): Position[] {
  const segmentCount = ring.length - 1;
  if (segmentCount < 1) return [to.point];

  if (
    from.segmentIndex === to.segmentIndex &&
    ((direction === 1 && from.t <= to.t) || (direction === -1 && from.t >= to.t))
  ) {
    return [to.point];
  }

  const path: Position[] = [];
  let segmentIndex = from.segmentIndex;

  if (direction === 1) {
    if (from.t < 1 - pointMatchEpsilon) pushIfDistinct(path, ring[segmentIndex + 1]!);

    segmentIndex = (segmentIndex + 1) % segmentCount;
    while (segmentIndex !== to.segmentIndex) {
      pushIfDistinct(path, ring[segmentIndex + 1]!);
      segmentIndex = (segmentIndex + 1) % segmentCount;
    }
  } else {
    if (from.t > pointMatchEpsilon) pushIfDistinct(path, ring[segmentIndex]!);

    segmentIndex = (segmentIndex - 1 + segmentCount) % segmentCount;
    while (segmentIndex !== to.segmentIndex) {
      pushIfDistinct(path, ring[segmentIndex]!);
      segmentIndex = (segmentIndex - 1 + segmentCount) % segmentCount;
    }
  }

  pushIfDistinct(path, to.point);
  return path;
}

function closePolylineOnBoundary(line: Position[], boundaries: Position[][]): Position[] | undefined {
  const start = line[0]!;
  const end = line[line.length - 1]!;

  const startLocations = findBoundaryLocations(start, boundaries);
  const endLocations = findBoundaryLocations(end, boundaries);

  let bestPair:
    | {
        startLocation: BoundaryLocation;
        endLocation: BoundaryLocation;
        distance: number;
      }
    | undefined;

  for (const startLocation of startLocations) {
    for (const endLocation of endLocations) {
      if (startLocation.boundaryRingIndex !== endLocation.boundaryRingIndex) continue;

      const ring = boundaries[startLocation.boundaryRingIndex]!;
      const segmentCount = ring.length - 1;
      if (segmentCount < 1) continue;

      const forward = forwardBoundaryDistance(endLocation, startLocation, segmentCount);
      const backward = segmentCount - forward;
      const distance = Math.min(forward, backward);

      if (!bestPair || distance < bestPair.distance) {
        bestPair = { startLocation, endLocation, distance };
      }
    }
  }

  if (!bestPair) return undefined;

  const ring = boundaries[bestPair.startLocation.boundaryRingIndex]!;
  const segmentCount = ring.length - 1;

  const forward = forwardBoundaryDistance(bestPair.endLocation, bestPair.startLocation, segmentCount);
  const backward = segmentCount - forward;
  const direction: 1 | -1 = forward <= backward ? 1 : -1;

  const closingPath = buildBoundaryPath(ring, bestPair.endLocation, bestPair.startLocation, direction);
  const closed = [...line, ...closingPath];

  if (!pointsEqual(closed[0]!, closed[closed.length - 1]!)) closed.push(closed[0]!);
  return closed;
}

function closePolylines(polylines: PolylinesWithLevels, boundaries: Position[][]) {
  const closedLines: PolylineWithLevel[] = [];
  const openLines: PolylineWithLevel[] = [];

  polylines.polylines.forEach((line, index) => {
    const levelIdx = polylines.levelIndex[index]!;

    // clone the line's coordinates (so we don't accidentally mutate the existing isoline)
    const polylineWithValue: PolylineWithLevel = { levelIdx, coords: line.map((p) => [...p]) };

    const [sx, sy] = line[0];
    const [ex, ey] = line[line.length - 1];

    if (sx === ex && sy === ey) {
      closedLines.push(polylineWithValue);
    } else {
      openLines.push(polylineWithValue);
    }
  });

  const closedShortLines = openLines
    .map((osl) => {
      const closedCoords = closePolylineOnBoundary(osl.coords, boundaries);
      if (!closedCoords) return undefined;
      return { ...osl, coords: closedCoords };
    })
    .filter((osl): osl is PolylineWithLevel => osl !== undefined);

  return { closedLines, closedShortLines };
}

function toLevels(rings: PolylineWithLevel[], levelCount: number): Position[][][] {
  const levels: Position[][][] = Array.from({ length: levelCount }, () => []);

  for (const ring of rings) {
    levels[ring.levelIdx]?.push(ring.coords);
  }

  return levels;
}

function immediateChildren(parent: Position[], candidates: Position[][]): Position[][] {
  const contained = candidates.filter((candidate) => pointInRing(candidate[0]!, parent));
  return contained.filter(
    (candidate) => !contained.some((other) => other !== candidate && pointInRing(candidate[0]!, other)),
  );
}

export function generateIsoareas(
  polylines: PolylinesWithLevels,
  boundaries: Position[][],
  _options: IsoareaOptions,
): PolygonsWithLevels {
  const { closedLines, closedShortLines } = closePolylines(polylines, boundaries);

  const thresholdRings = [...closedLines, ...closedShortLines];
  const ringsByLevel = toLevels(thresholdRings, polylines.levelValues.length);

  const polygons: Position[][][] = [];
  const levelIndexBuffer: number[] = [];

  // Build contour bands as: area(>= level[i]) minus area(>= level[i + 1]).
  for (let bandIdx = 0; bandIdx < polylines.levelValues.length - 1; bandIdx++) {
    const lowerLevelRings = ringsByLevel[bandIdx] ?? [];
    if (lowerLevelRings.length === 0) continue;

    const upperLevelRings = ringsByLevel[bandIdx + 1] ?? [];

    for (const lowerRing of lowerLevelRings) {
      const holes = immediateChildren(lowerRing, upperLevelRings);
      polygons.push([lowerRing, ...holes]);
      levelIndexBuffer.push(bandIdx);
    }
  }

  const levelIndex = Uint8Array.from(levelIndexBuffer);

  return { polygons, levelIndex, levelValues: polylines.levelValues };
}
