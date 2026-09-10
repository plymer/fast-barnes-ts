import type { Position } from "geojson";
import type { PolygonsWithLevels, PolylinesWithLevels } from "./types";
import { pointInRing, reverseRing, ringSignedArea } from "./helpers";

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

type OpenLineWithBoundary = {
  lineId: number;
  levelIdx: number;
  coords: Position[];
  startEndpointId: string;
  endEndpointId: string;
  startLocation: BoundaryLocation;
  endLocation: BoundaryLocation;
};

type EndpointEvent = {
  endpointId: string;
  lineId: number;
  atStart: boolean;
  location: BoundaryLocation;
  scalar: number;
};

const pointMatchEpsilon = 1e-9;
const touchingHoleInset = 1e-4;

function nearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= pointMatchEpsilon;
}

function pointsEqual(a: Position, b: Position): boolean {
  return nearlyEqual(a[0], b[0]) && nearlyEqual(a[1], b[1]);
}

function pointOnSegment(point: Position, a: Position, b: Position): boolean {
  const [px, py] = point;
  const [ax, ay] = a;
  const [bx, by] = b;

  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const cross = abx * apy - aby * apx;
  if (Math.abs(cross) > pointMatchEpsilon) return false;

  const dot = apx * abx + apy * aby;
  if (dot < -pointMatchEpsilon) return false;

  const lenSq = abx * abx + aby * aby;
  if (dot - lenSq > pointMatchEpsilon) return false;

  return true;
}

function pointOnRing(point: Position, ring: Position[]): boolean {
  for (let i = 0; i < ring.length - 1; i++) {
    if (pointOnSegment(point, ring[i]!, ring[i + 1]!)) return true;
  }
  return false;
}

function pointInOrOnRing(point: Position, ring: Position[]): boolean {
  return pointInRing(point, ring) || pointOnRing(point, ring);
}

function ringContainedInRing(candidate: Position[], parent: Position[]): boolean {
  const n = candidate.length - 1;
  if (n < 3) return false;

  for (let i = 0; i < n; i++) {
    if (!pointInOrOnRing(candidate[i]!, parent)) return false;
  }

  return true;
}

function nudgeTouchingRingInside(candidate: Position[], parent: Position[]): Position[] {
  if (candidate.length < 4) return candidate;

  let cx = 0;
  let cy = 0;
  const n = candidate.length - 1;
  for (let i = 0; i < n; i++) {
    cx += candidate[i]![0];
    cy += candidate[i]![1];
  }
  cx /= n;
  cy /= n;

  const adjusted: Position[] = candidate.map(([x, y]) => [x, y]);
  let changed = false;

  for (let i = 0; i < n; i++) {
    const p = adjusted[i]!;
    if (!pointOnRing(p, parent)) continue;

    const dx = cx - p[0];
    const dy = cy - p[1];
    const len = Math.hypot(dx, dy);
    if (len <= pointMatchEpsilon) continue;

    p[0] += (dx / len) * touchingHoleInset;
    p[1] += (dy / len) * touchingHoleInset;
    changed = true;
  }

  if (changed) {
    adjusted[adjusted.length - 1] = [adjusted[0]![0], adjusted[0]![1]];
  }

  return adjusted;
}

function removeSequentialDuplicates(ring: Position[]): Position[] {
  if (ring.length === 0) return ring;
  const out: Position[] = [[ring[0]![0], ring[0]![1]]];
  for (let i = 1; i < ring.length; i++) {
    const p = ring[i]!;
    if (!pointsEqual(out[out.length - 1]!, p)) out.push([p[0], p[1]]);
  }
  return out;
}

function removeCollinearVertices(ring: Position[]): Position[] {
  if (ring.length <= 4) return ring;

  const out: Position[] = [ring[0]!, ring[1]!].map(([x, y]) => [x, y]);
  for (let i = 2; i < ring.length; i++) {
    const c = ring[i]!;
    const b = out[out.length - 1]!;
    const a = out[out.length - 2]!;

    const abx = b[0] - a[0];
    const aby = b[1] - a[1];
    const bcx = c[0] - b[0];
    const bcy = c[1] - b[1];
    const cross = abx * bcy - aby * bcx;

    if (Math.abs(cross) <= pointMatchEpsilon) {
      out[out.length - 1] = [c[0], c[1]];
    } else {
      out.push([c[0], c[1]]);
    }
  }

  return out;
}

function normalizeRing(ring: Position[]): Position[] | undefined {
  if (ring.length < 4) return undefined;

  const opened = pointsEqual(ring[0]!, ring[ring.length - 1]!) ? ring.slice(0, -1) : [...ring];
  if (opened.length < 3) return undefined;

  let cleaned = removeSequentialDuplicates(opened);
  if (cleaned.length < 3) return undefined;

  cleaned = removeCollinearVertices(cleaned);
  if (cleaned.length < 3) return undefined;

  const closed = [...cleaned, cleaned[0]!];
  const area = Math.abs(ringSignedArea(closed));
  if (area <= pointMatchEpsilon) return undefined;

  return closed;
}

function orientHoleAgainstOuter(outer: Position[], hole: Position[]): Position[] {
  const outerSign = Math.sign(ringSignedArea(outer));
  const holeSign = Math.sign(ringSignedArea(hole));
  if (outerSign !== 0 && holeSign === outerSign) return reverseRing(hole);
  return hole;
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

function pickBoundaryLocation(point: Position, boundaries: Position[][]): BoundaryLocation | undefined {
  const locations = findBoundaryLocations(point, boundaries);
  if (locations.length === 0) return undefined;
  return locations.sort((a, b) => {
    if (a.boundaryRingIndex !== b.boundaryRingIndex) return a.boundaryRingIndex - b.boundaryRingIndex;
    if (a.segmentIndex !== b.segmentIndex) return a.segmentIndex - b.segmentIndex;
    return a.t - b.t;
  })[0];
}

function boundaryArcInclusive(ring: Position[], from: BoundaryLocation, to: BoundaryLocation): Position[] {
  const arc: Position[] = [[from.point[0], from.point[1]]];
  const tail = buildBoundaryPath(ring, from, to, 1);
  for (const point of tail) {
    pushIfDistinct(arc, [point[0], point[1]]);
  }
  return arc;
}

function arcDistanceOnRing(ring: Position[], a: BoundaryLocation, b: BoundaryLocation): number {
  const segmentCount = ring.length - 1;
  if (segmentCount < 1) return 0;
  return forwardBoundaryDistance(a, b, segmentCount);
}

function stitchOpenLinesOnBoundary(
  openLines: OpenLineWithBoundary[],
  boundaries: Position[][],
  preferLargerBoundaryArc: boolean,
): Position[][] {
  if (openLines.length === 0) return [];

  const eventsByRing = new Map<number, EndpointEvent[]>();

  for (const line of openLines) {
    if (line.startLocation.boundaryRingIndex !== line.endLocation.boundaryRingIndex) {
      return openLines
        .map((ol) => closePolylineOnBoundary(ol.coords, boundaries))
        .filter((ring): ring is Position[] => ring !== undefined);
    }

    const ringIdx = line.startLocation.boundaryRingIndex;
    const list = eventsByRing.get(ringIdx);
    const startEvent: EndpointEvent = {
      endpointId: line.startEndpointId,
      lineId: line.lineId,
      atStart: true,
      location: line.startLocation,
      scalar: boundaryScalar(line.startLocation),
    };
    const endEvent: EndpointEvent = {
      endpointId: line.endEndpointId,
      lineId: line.lineId,
      atStart: false,
      location: line.endLocation,
      scalar: boundaryScalar(line.endLocation),
    };

    if (!list) {
      eventsByRing.set(ringIdx, [startEvent, endEvent]);
    } else {
      list.push(startEvent, endEvent);
    }
  }

  const pairMap = new Map<string, string>();
  const arcMap = new Map<string, Position[]>();
  const endpointToLine = new Map<string, { lineId: number; atStart: boolean }>();

  for (const line of openLines) {
    endpointToLine.set(line.startEndpointId, { lineId: line.lineId, atStart: true });
    endpointToLine.set(line.endEndpointId, { lineId: line.lineId, atStart: false });
  }

  const keyOf = (a: string, b: string) => `${a}|${b}`;

  for (const [ringIdx, ringEvents] of eventsByRing) {
    if (ringEvents.length % 2 !== 0) {
      return openLines
        .map((ol) => closePolylineOnBoundary(ol.coords, boundaries))
        .filter((ring): ring is Position[] => ring !== undefined);
    }

    if (ringEvents.length === 2) {
      return openLines
        .map((ol) => closePolylineOnBoundary(ol.coords, boundaries))
        .filter((ring): ring is Position[] => ring !== undefined);
    }

    const ring = boundaries[ringIdx]!;
    const sorted = [...ringEvents].sort((a, b) => a.scalar - b.scalar);
    const pairingScores = [0, 0];

    for (let offset = 0 as 0 | 1; offset <= 1; offset++) {
      let score = 0;
      for (let i = 0; i < sorted.length; i += 2) {
        const a = sorted[(offset + i) % sorted.length]!;
        const b = sorted[(offset + i + 1) % sorted.length]!;
        score += arcDistanceOnRing(ring, a.location, b.location);
      }
      pairingScores[offset] = score;
    }

    const chosenOffset: 0 | 1 =
      (preferLargerBoundaryArc && pairingScores[0] >= pairingScores[1]) ||
      (!preferLargerBoundaryArc && pairingScores[0] <= pairingScores[1])
        ? 0
        : 1;

    for (let i = 0; i < sorted.length; i += 2) {
      const a = sorted[(chosenOffset + i) % sorted.length]!;
      const b = sorted[(chosenOffset + i + 1) % sorted.length]!;

      pairMap.set(a.endpointId, b.endpointId);
      pairMap.set(b.endpointId, a.endpointId);

      const forward = boundaryArcInclusive(ring, a.location, b.location);
      arcMap.set(keyOf(a.endpointId, b.endpointId), forward);
      arcMap.set(keyOf(b.endpointId, a.endpointId), [...forward].reverse());
    }
  }

  const loops: Position[][] = [];
  const consumed = new Uint8Array(openLines.length);

  const traverseFrom = (
    seedLine: OpenLineWithBoundary,
    startFromStart: boolean,
  ): { loop: Position[]; usedLineIds: number[] } | undefined => {
    const startEndpointId = startFromStart ? seedLine.startEndpointId : seedLine.endEndpointId;
    const firstSegment = startFromStart ? seedLine.coords : [...seedLine.coords].reverse();
    const loop: Position[] = firstSegment.map((point) => [point[0], point[1]]);

    const used = new Set<number>([seedLine.lineId]);
    let currentEndpointId = startFromStart ? seedLine.endEndpointId : seedLine.startEndpointId;

    const maxSteps = openLines.length * 3 + 8;
    for (let step = 0; step < maxSteps; step++) {
      const pairedEndpointId = pairMap.get(currentEndpointId);
      if (!pairedEndpointId) return undefined;

      const connector = arcMap.get(keyOf(currentEndpointId, pairedEndpointId));
      if (!connector) return undefined;
      for (let i = 1; i < connector.length; i++) {
        pushIfDistinct(loop, connector[i]!);
      }

      if (pairedEndpointId === startEndpointId) {
        if (!pointsEqual(loop[0]!, loop[loop.length - 1]!)) loop.push(loop[0]!);
        return { loop, usedLineIds: [...used] };
      }

      const target = endpointToLine.get(pairedEndpointId);
      if (!target || used.has(target.lineId)) return undefined;

      const targetLine = openLines[target.lineId]!;
      const segment = target.atStart ? targetLine.coords : [...targetLine.coords].reverse();
      for (let i = 1; i < segment.length; i++) {
        pushIfDistinct(loop, segment[i]!);
      }

      used.add(target.lineId);
      currentEndpointId = target.atStart ? targetLine.endEndpointId : targetLine.startEndpointId;
    }

    return undefined;
  };

  for (const line of openLines) {
    if (consumed[line.lineId] === 1) continue;

    const attemptA = traverseFrom(line, true);
    const attemptB = traverseFrom(line, false);
    const chosen =
      !attemptA && !attemptB
        ? undefined
        : !attemptA
          ? attemptB
          : !attemptB
            ? attemptA
            : Math.abs(ringSignedArea(attemptA.loop)) >= Math.abs(ringSignedArea(attemptB.loop))
              ? attemptA
              : attemptB;

    if (!chosen) {
      const fallback = closePolylineOnBoundary(line.coords, boundaries);
      if (fallback) loops.push(fallback);
      consumed[line.lineId] = 1;
      continue;
    }

    loops.push(chosen.loop);
    for (const usedLineId of chosen.usedLineIds) consumed[usedLineId] = 1;
  }

  return loops;
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
  const openByLevel = new Map<number, OpenLineWithBoundary[]>();
  const minLevel = Math.min(...polylines.levelValues);
  const maxLevel = Math.max(...polylines.levelValues);
  const midLevel = (minLevel + maxLevel) * 0.5;

  polylines.polylines.forEach((line, index) => {
    const levelIdx = polylines.levelIndex[index]!;

    // clone the line's coordinates (so we don't accidentally mutate the existing isoline)
    const polylineWithValue: PolylineWithLevel = { levelIdx, coords: line.map((p) => [...p]) };

    const [sx, sy] = line[0];
    const [ex, ey] = line[line.length - 1];

    if (sx === ex && sy === ey) {
      closedLines.push(polylineWithValue);
    } else {
      const startLocation = pickBoundaryLocation(polylineWithValue.coords[0]!, boundaries);
      const endLocation = pickBoundaryLocation(
        polylineWithValue.coords[polylineWithValue.coords.length - 1]!,
        boundaries,
      );

      if (!startLocation || !endLocation) {
        const fallback = closePolylineOnBoundary(polylineWithValue.coords, boundaries);
        if (fallback) closedLines.push({ levelIdx, coords: fallback });
        return;
      }

      const list = openByLevel.get(levelIdx);
      const lineId = list?.length ?? 0;
      const openLine: OpenLineWithBoundary = {
        lineId,
        levelIdx,
        coords: polylineWithValue.coords,
        startEndpointId: `${lineId}:s`,
        endEndpointId: `${lineId}:e`,
        startLocation,
        endLocation,
      };

      if (!list) openByLevel.set(levelIdx, [openLine]);
      else list.push(openLine);
    }
  });

  const closedShortLines: PolylineWithLevel[] = [];

  for (const [levelIdx, openLines] of openByLevel) {
    const levelValue = polylines.levelValues[levelIdx]!;
    const preferLargerBoundaryArc = levelValue < midLevel;
    const stitched = stitchOpenLinesOnBoundary(openLines, boundaries, preferLargerBoundaryArc);
    for (const ring of stitched) {
      closedShortLines.push({ levelIdx, coords: ring });
    }
  }

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
  const contained = candidates.filter((candidate) => ringContainedInRing(candidate, parent));
  return contained.filter(
    (candidate) => !contained.some((other) => other !== candidate && ringContainedInRing(candidate, other)),
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
      const normalizedOuter = normalizeRing(lowerRing);
      if (!normalizedOuter) continue;

      const holes = immediateChildren(normalizedOuter, upperLevelRings)
        .map((hole) => nudgeTouchingRingInside(hole, normalizedOuter))
        .map((hole) => orientHoleAgainstOuter(normalizedOuter, hole))
        .map((hole) => normalizeRing(hole))
        .filter((hole): hole is Position[] => hole !== undefined);

      polygons.push([normalizedOuter, ...holes]);
      levelIndexBuffer.push(bandIdx);
    }
  }

  const levelIndex = Uint8Array.from(levelIndexBuffer);

  return { polygons, levelIndex, levelValues: polylines.levelValues };
}
