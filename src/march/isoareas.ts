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

/**
 * Compares two numbers using a tiny tolerance instead of exact equality.
 *
 * Why this exists:
 * Coordinates are floating-point values, so tiny rounding differences are
 * normal. This helper prevents those tiny differences from breaking geometry
 * checks later in the pipeline.
 */
function nearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= pointMatchEpsilon;
}

/**
 * Compares two 2D points with tolerance on both x and y values.
 *
 * Used throughout the file whenever we need to decide whether two vertices
 * should be treated as the same location.
 */
function pointsEqual(a: Position, b: Position): boolean {
  return nearlyEqual(a[0], b[0]) && nearlyEqual(a[1], b[1]);
}

/**
 * Checks whether a point lies on the finite line segment from a to b.
 *
 * This is a geometric building block used by ring and boundary checks.
 * It verifies collinearity and that the point is between segment endpoints.
 */
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

/**
 * Returns true if the point touches any edge of the ring.
 *
 * The ring is expected to be closed, so we test each consecutive pair of
 * vertices as one segment.
 */
function pointOnRing(point: Position, ring: Position[]): boolean {
  for (let i = 0; i < ring.length - 1; i++) {
    if (pointOnSegment(point, ring[i]!, ring[i + 1]!)) return true;
  }
  return false;
}

/**
 * Inclusive containment test for a ring.
 *
 * Returns true when the point is either strictly inside the ring or exactly
 * on one of its edges. This matters because contour rings often share border
 * points due to interpolation.
 */
function pointInOrOnRing(point: Position, ring: Position[]): boolean {
  return pointInRing(point, ring) || pointOnRing(point, ring);
}

/**
 * Checks whether one ring is contained by another ring.
 *
 * Current rule:
 * If every vertex of candidate is inside or on parent, we treat candidate as
 * contained. This is a practical rule for our contour data, which is already
 * built from non-random linework.
 */
function ringContainedInRing(candidate: Position[], parent: Position[]): boolean {
  const n = candidate.length - 1;
  if (n < 3) return false;

  // Simple containment rule: every candidate vertex must be inside (or on)
  // the parent ring. If any point falls outside, this is not a child ring.
  for (let i = 0; i < n; i++) {
    if (!pointInOrOnRing(candidate[i]!, parent)) return false;
  }

  return true;
}

/**
 * Moves a hole ring slightly inward when it touches its outer ring.
 *
 * Why this exists:
 * If a hole shares exact coordinates with the shell, some renderers and
 * geometry consumers can treat the polygon as invalid or ambiguous.
 *
 * Strategy:
 * For touching vertices, move them a tiny distance toward the hole centroid.
 */
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

    // Move touching points slightly toward the ring center so hole and shell
    // are no longer exactly on top of each other.
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

/**
 * Removes back-to-back duplicate vertices from a ring path.
 *
 * This is a cleanup step that simplifies geometry and prevents zero-length
 * segments from leaking into later calculations.
 */
function removeSequentialDuplicates(ring: Position[]): Position[] {
  if (ring.length === 0) return ring;
  const out: Position[] = [[ring[0]![0], ring[0]![1]]];
  for (let i = 1; i < ring.length; i++) {
    const p = ring[i]!;
    if (!pointsEqual(out[out.length - 1]!, p)) out.push([p[0], p[1]]);
  }
  return out;
}

/**
 * Removes unnecessary middle points along straight runs.
 *
 * If three consecutive points are collinear, the middle point does not change
 * shape and can be dropped. This keeps rings cleaner and smaller.
 */
function removeCollinearVertices(ring: Position[]): Position[] {
  if (ring.length <= 4) return ring;

  const out: Position[] = [ring[0]!, ring[1]!].map(([x, y]) => [x, y]);
  for (let i = 2; i < ring.length; i++) {
    const nextPoint = ring[i]!;
    const currentPoint = out[out.length - 1]!;
    const previousPoint = out[out.length - 2]!;

    const previousToCurrentX = currentPoint[0] - previousPoint[0];
    const previousToCurrentY = currentPoint[1] - previousPoint[1];
    const currentToNextX = nextPoint[0] - currentPoint[0];
    const currentToNextY = nextPoint[1] - currentPoint[1];
    const cross = previousToCurrentX * currentToNextY - previousToCurrentY * currentToNextX;

    if (Math.abs(cross) <= pointMatchEpsilon) {
      out[out.length - 1] = [nextPoint[0], nextPoint[1]];
    } else {
      out.push([nextPoint[0], nextPoint[1]]);
    }
  }

  return out;
}

/**
 * Normalizes a ring into a consistent, valid form or returns undefined.
 *
 * What it does in order:
 * 1. Ensures we have enough points.
 * 2. Converts to an open path temporarily to clean it safely.
 * 3. Removes sequential duplicates.
 * 4. Removes collinear middle points.
 * 5. Closes the ring again.
 * 6. Rejects near-zero-area rings.
 *
 * This function is a core safety gate before polygon output.
 */
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

/**
 * Ensures hole orientation is opposite the shell orientation.
 *
 * Many polygon formats and geometry tools expect shell and hole rings to use
 * opposite winding directions. This function enforces that convention.
 */
function orientHoleAgainstOuter(outer: Position[], hole: Position[]): Position[] {
  const outerSign = Math.sign(ringSignedArea(outer));
  const holeSign = Math.sign(ringSignedArea(hole));
  if (outerSign !== 0 && holeSign === outerSign) return reverseRing(hole);
  return hole;
}

/**
 * Finds where a point lies along one boundary segment.
 *
 * Returns:
 * - A number t from 0 to 1 when the point is on the segment.
 *   - t = 0 means at segment start.
 *   - t = 1 means at segment end.
 * - undefined when the point is not on this segment.
 *
 * In this project, domain boundaries are axis-aligned in grid space, so the
 * checks are optimized for horizontal and vertical segments.
 */
function pointOnBoundarySegment(point: Position, a: Position, b: Position): number | undefined {
  const [px, py] = point;
  const [ax, ay] = a;
  const [bx, by] = b;
  const segmentDeltaX = bx - ax;
  const segmentDeltaY = by - ay;

  // Domain boundary segments are axis-aligned and should have non-zero length.
  if (Math.abs(segmentDeltaX) > pointMatchEpsilon) {
    if (!nearlyEqual(py, ay) || !nearlyEqual(py, by)) return undefined;
    const t = (px - ax) / segmentDeltaX;
    return t >= -pointMatchEpsilon && t <= 1 + pointMatchEpsilon ? Math.min(1, Math.max(0, t)) : undefined;
  }

  if (Math.abs(segmentDeltaY) > pointMatchEpsilon) {
    if (!nearlyEqual(px, ax) || !nearlyEqual(px, bx)) return undefined;
    const t = (py - ay) / segmentDeltaY;
    return t >= -pointMatchEpsilon && t <= 1 + pointMatchEpsilon ? Math.min(1, Math.max(0, t)) : undefined;
  }

  return undefined;
}

/**
 * Finds every boundary location where a point lands.
 *
 * Most points match one segment. Corner points can match two segments.
 * Returning all matches lets later logic choose the best connection.
 */
function findBoundaryLocations(point: Position, boundaries: Position[][]): BoundaryLocation[] {
  const locations: BoundaryLocation[] = [];

  boundaries.forEach((ring, boundaryRingIndex) => {
    const segmentCount = ring.length - 1;
    if (segmentCount < 1) return;

    for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex++) {
      const segmentStart = ring[segmentIndex]!;
      const segmentEnd = ring[segmentIndex + 1]!;
      const t = pointOnBoundarySegment(point, segmentStart, segmentEnd);
      if (t === undefined) continue;
      locations.push({ boundaryRingIndex, segmentIndex, t, point });
    }
  });

  return locations;
}

/**
 * Appends a point only when it is different from the current last point.
 *
 * This avoids creating duplicate vertices while we build paths incrementally.
 */
function pushIfDistinct(points: Position[], point: Position) {
  const last = points[points.length - 1];
  if (!last || !pointsEqual(last, point)) points.push(point);
}

/**
 * Converts a boundary location into a sortable number.
 *
 * segmentIndex gives the whole-segment position and t gives in-segment offset,
 * so segmentIndex + t lets us sort events in boundary-walk order.
 */
function boundaryScalar(ref: BoundaryLocation): number {
  return ref.segmentIndex + ref.t;
}

/**
 * Computes forward distance along a closed boundary ring.
 *
 * The ring is cyclic, so if the destination is "behind" the source in index
 * order we wrap around the end of the ring.
 */
function forwardBoundaryDistance(from: BoundaryLocation, to: BoundaryLocation, segmentCount: number): number {
  const fromScalar = boundaryScalar(from);
  const toScalar = boundaryScalar(to);
  return toScalar >= fromScalar ? toScalar - fromScalar : segmentCount - (fromScalar - toScalar);
}

/**
 * Builds an explicit boundary path from one boundary location to another.
 *
 * Inputs:
 * - from, to: positions on boundary segments
 * - direction: forward or backward walk around the ring
 *
 * Output:
 * A polyline of boundary vertices ending at to.point.
 *
 * This is the path used to close open isolines along the domain edge.
 */
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
    // Walk forward around the boundary ring.
    if (from.t < 1 - pointMatchEpsilon) pushIfDistinct(path, ring[segmentIndex + 1]!);

    segmentIndex = (segmentIndex + 1) % segmentCount;
    while (segmentIndex !== to.segmentIndex) {
      pushIfDistinct(path, ring[segmentIndex + 1]!);
      segmentIndex = (segmentIndex + 1) % segmentCount;
    }
  } else {
    // Walk backward around the boundary ring.
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

/**
 * Picks one boundary match for a point when multiple matches exist.
 *
 * Current behavior is deterministic sorting by ring and segment order.
 * This keeps results stable run-to-run even at corners.
 */
function pickBoundaryLocation(point: Position, boundaries: Position[][]): BoundaryLocation | undefined {
  const locations = findBoundaryLocations(point, boundaries);
  if (locations.length === 0) return undefined;
  return locations.sort((a, b) => {
    if (a.boundaryRingIndex !== b.boundaryRingIndex) return a.boundaryRingIndex - b.boundaryRingIndex;
    if (a.segmentIndex !== b.segmentIndex) return a.segmentIndex - b.segmentIndex;
    return a.t - b.t;
  })[0];
}

/**
 * Returns a boundary arc from from to to, including the start coordinate.
 *
 * This wraps buildBoundaryPath so callers always get a complete connector
 * polyline that starts where expected.
 */
function boundaryArcInclusive(ring: Position[], from: BoundaryLocation, to: BoundaryLocation): Position[] {
  const arc: Position[] = [[from.point[0], from.point[1]]];
  const tail = buildBoundaryPath(ring, from, to, 1);
  for (const point of tail) {
    pushIfDistinct(arc, [point[0], point[1]]);
  }
  return arc;
}

/**
 * Small helper that measures boundary arc distance between two events.
 *
 * Used for scoring candidate pairings when we connect open-line endpoints.
 */
function arcDistanceOnRing(ring: Position[], a: BoundaryLocation, b: BoundaryLocation): number {
  const segmentCount = ring.length - 1;
  if (segmentCount < 1) return 0;
  return forwardBoundaryDistance(a, b, segmentCount);
}

/**
 * Closes a group of open isolines that touch the same boundary ring.
 *
 * Big picture:
 * 1. Convert open-line endpoints into ordered boundary events.
 * 2. Pair neighboring events in one of two non-crossing patterns.
 * 3. Build boundary connectors between each pair.
 * 4. Walk line segment -> boundary connector -> next line segment until a loop
 *    closes.
 *
 * This is the main multi-line closure routine for complex boundary-touching
 * cases.
 */
function stitchOpenLinesOnBoundary(
  openLines: OpenLineWithBoundary[],
  boundaries: Position[][],
  preferLargerBoundaryArc: boolean,
): Position[][] {
  if (openLines.length === 0) return [];

  const eventsByRing = new Map<number, EndpointEvent[]>();

  for (const line of openLines) {
    // This stitching pass assumes each open line starts/ends on the same
    // boundary ring. If not, use per-line fallback closure.
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
    // Endpoint events come in pairs; odd counts indicate incomplete topology,
    // so we switch to fallback closures.
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

    // There are two non-crossing ways to pair neighbors on a cycle:
    // pair [0-1,2-3,...] or [1-2,3-4,...,last-0].
    for (let offset = 0 as 0 | 1; offset <= 1; offset++) {
      let score = 0;
      for (let i = 0; i < sorted.length; i += 2) {
        const firstEvent = sorted[(offset + i) % sorted.length]!;
        const secondEvent = sorted[(offset + i + 1) % sorted.length]!;
        score += arcDistanceOnRing(ring, firstEvent.location, secondEvent.location);
      }
      pairingScores[offset] = score;
    }

    const chosenOffset: 0 | 1 =
      // Lower levels usually represent broader outside regions, so the
      // heuristic can prefer longer boundary arcs there.
      (preferLargerBoundaryArc && pairingScores[0] >= pairingScores[1]) ||
      (!preferLargerBoundaryArc && pairingScores[0] <= pairingScores[1])
        ? 0
        : 1;

    for (let i = 0; i < sorted.length; i += 2) {
      const firstEvent = sorted[(chosenOffset + i) % sorted.length]!;
      const secondEvent = sorted[(chosenOffset + i + 1) % sorted.length]!;

      pairMap.set(firstEvent.endpointId, secondEvent.endpointId);
      pairMap.set(secondEvent.endpointId, firstEvent.endpointId);

      const connectingArc = boundaryArcInclusive(ring, firstEvent.location, secondEvent.location);
      arcMap.set(keyOf(firstEvent.endpointId, secondEvent.endpointId), connectingArc);
      arcMap.set(keyOf(secondEvent.endpointId, firstEvent.endpointId), [...connectingArc].reverse());
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

    // Alternate between (1) walking a boundary connector and (2) following
    // the next open isoline until we get back to the starting endpoint.
    const maxSteps = openLines.length * 3 + 8;
    for (let step = 0; step < maxSteps; step++) {
      const pairedEndpointId = pairMap.get(currentEndpointId);
      if (!pairedEndpointId) return undefined;

      const boundaryConnector = arcMap.get(keyOf(currentEndpointId, pairedEndpointId));
      if (!boundaryConnector) return undefined;
      for (let i = 1; i < boundaryConnector.length; i++) {
        pushIfDistinct(loop, boundaryConnector[i]!);
      }

      if (pairedEndpointId === startEndpointId) {
        if (!pointsEqual(loop[0]!, loop[loop.length - 1]!)) loop.push(loop[0]!);
        return { loop, usedLineIds: [...used] };
      }

      const target = endpointToLine.get(pairedEndpointId);
      if (!target || used.has(target.lineId)) return undefined;

      const targetLine = openLines[target.lineId]!;
      const targetSegment = target.atStart ? targetLine.coords : [...targetLine.coords].reverse();
      for (let i = 1; i < targetSegment.length; i++) {
        pushIfDistinct(loop, targetSegment[i]!);
      }

      used.add(target.lineId);
      currentEndpointId = target.atStart ? targetLine.endEndpointId : targetLine.startEndpointId;
    }

    // Guard against accidental infinite walks if topology links are broken.
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
      // If stitched traversal failed, close this line independently so we
      // still return a polygon candidate.
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

/**
 * Fallback for a single open isoline when multi-line stitching cannot be used.
 *
 * It finds boundary matches for the start and end points, chooses the shortest
 * valid boundary walk between them, and appends that walk to close the ring.
 */
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

      const forwardDistance = forwardBoundaryDistance(endLocation, startLocation, segmentCount);
      const backwardDistance = segmentCount - forwardDistance;
      const boundaryDistance = Math.min(forwardDistance, backwardDistance);

      // Pick the closest ring-walk connection between endpoints.
      if (!bestPair || boundaryDistance < bestPair.distance) {
        bestPair = { startLocation, endLocation, distance: boundaryDistance };
      }
    }
  }

  if (!bestPair) return undefined;

  const ring = boundaries[bestPair.startLocation.boundaryRingIndex]!;
  const segmentCount = ring.length - 1;

  const forwardDistance = forwardBoundaryDistance(bestPair.endLocation, bestPair.startLocation, segmentCount);
  const backwardDistance = segmentCount - forwardDistance;
  // Choose the shorter direction around the boundary.
  const direction: 1 | -1 = forwardDistance <= backwardDistance ? 1 : -1;

  const closingPath = buildBoundaryPath(ring, bestPair.endLocation, bestPair.startLocation, direction);
  const closed = [...line, ...closingPath];

  if (!pointsEqual(closed[0]!, closed[closed.length - 1]!)) closed.push(closed[0]!);
  return closed;
}

/**
 * Converts raw threshold polylines into closed rings, organized by level.
 *
 * What happens:
 * - Closed lines are kept as-is.
 * - Open lines are grouped by level.
 * - Each group is stitched on boundaries when possible.
 * - If stitching fails, per-line fallback closure is attempted.
 *
 * Output is two ring sets that are later merged for band generation.
 */
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
      // Already a loop: no boundary work needed.
      closedLines.push(polylineWithValue);
    } else {
      const startLocation = pickBoundaryLocation(polylineWithValue.coords[0]!, boundaries);
      const endLocation = pickBoundaryLocation(
        polylineWithValue.coords[polylineWithValue.coords.length - 1]!,
        boundaries,
      );

      if (!startLocation || !endLocation) {
        // If endpoint snapping failed, try independent closure as backup.
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
    // Stitch all open lines for this level into one or more closed loops.
    const stitched = stitchOpenLinesOnBoundary(openLines, boundaries, preferLargerBoundaryArc);
    for (const ring of stitched) {
      closedShortLines.push({ levelIdx, coords: ring });
    }
  }

  return { closedLines, closedShortLines };
}

/**
 * Groups closed rings by threshold level index.
 *
 * The returned array shape is levels[levelIdx] = list of rings for that level.
 */
function toLevels(rings: PolylineWithLevel[], levelCount: number): Position[][][] {
  const levels: Position[][][] = Array.from({ length: levelCount }, () => []);

  for (const ring of rings) {
    levels[ring.levelIdx]?.push(ring.coords);
  }

  return levels;
}

/**
 * Returns direct child rings of a parent ring.
 *
 * A direct child is inside parent and is not inside another candidate that is
 * also inside parent. This avoids skipping one nesting level.
 */
function immediateChildren(parent: Position[], candidates: Position[][]): Position[][] {
  const contained = candidates.filter((candidate) => ringContainedInRing(candidate, parent));
  return contained.filter(
    (candidate) => !contained.some((other) => other !== candidate && ringContainedInRing(candidate, other)),
  );
}

/**
 * Main entry point that builds final isoarea polygons for all contour bands.
 *
 * Band meaning:
 * Band i is the area between level i and level i + 1.
 *
 * Pipeline in this function:
 * 1. Close open isolines so each level has rings.
 * 2. Group rings by level.
 * 3. For each band, use lower-level rings as outer shells.
 * 4. Find upper-level rings directly inside each shell and treat them as
 *    holes.
 * 5. Normalize geometry and fix winding before output.
 *
 * Returns polygons with level indices and original level values.
 */
export function generateIsoareas(
  polylines: PolylinesWithLevels,
  boundaries: Position[][],
  _options: IsoareaOptions,
): PolygonsWithLevels {
  // Step 1: close all open isolines so each threshold level has rings.
  const { closedLines, closedShortLines } = closePolylines(polylines, boundaries);

  const thresholdRings = [...closedLines, ...closedShortLines];
  // Step 2: group rings by their threshold level index.
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

      // Holes for this band come from the next higher threshold that sits
      // directly inside this outer ring.
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
