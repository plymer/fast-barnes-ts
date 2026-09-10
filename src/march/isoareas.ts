import type { Position } from "geojson";
import type { PolygonsWithLevels, PolylinesWithLevels } from "./types";
import { getThresholdValue } from "./helpers";

type IsoareaOptions = {
  shape: [number, number];
};

type PolylineWithValue = { value: number; coords: Position[]; index: number };
type LineTermination = {
  id: number;
  polylineIndex: number;
  atStart: boolean;
  point: Position;
};

const keyPrecisionDigits = 7;
const keyCollinearEpsilon = 1e-7;

function pointsEqual(a: Position, b: Position): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

function pointIsOnBoundary(point: Position, shape: [number, number]) {
  return point[0] === 0 || point[0] === shape[0] - 1 || point[1] === 0 || point[1] === shape[1] - 1;
}

function convertToPolylineWithValue(polyline: Position[], value: number, index: number): PolylineWithValue {
  return { value, coords: polyline.map((p) => [...p]), index };
}

function findLevelIndex(levelValues: number[], value: number): number {
  const exact = levelValues.findIndex((candidate) => candidate === value);
  if (exact !== -1) return exact;

  // Fallback for tiny floating-point mismatches.
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < levelValues.length; i++) {
    const distance = Math.abs(levelValues[i]! - value);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }

  return bestIndex;
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

function sideEndCorner(sideRank: number, shape: [number, number]): Position {
  const maxX = shape[0] - 1;
  const maxY = shape[1] - 1;

  switch (sideRank) {
    case 0:
      return [maxX, 0];
    case 1:
      return [maxX, maxY];
    case 2:
      return [0, maxY];
    default:
      return [0, 0];
  }
}

function appendDistinct(target: Position[], point: Position) {
  const last = target[target.length - 1];
  if (!last || !pointsEqual(last, point)) target.push([point[0], point[1]]);
}

function appendPathDistinct(target: Position[], path: Position[]) {
  for (const point of path) appendDistinct(target, point);
}

function pointKey(point: Position): string {
  // Round for stable keying across tiny floating-point noise.
  return `${point[0].toFixed(keyPrecisionDigits)},${point[1].toFixed(keyPrecisionDigits)}`;
}

function quantizePoint(point: Position): Position {
  return [Number(point[0].toFixed(keyPrecisionDigits)), Number(point[1].toFixed(keyPrecisionDigits))];
}

function collinear(a: Position, b: Position, c: Position): boolean {
  const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
  return Math.abs(cross) <= keyCollinearEpsilon;
}

function normalizePointsForKey(ring: Position[]): Position[] {
  if (ring.length === 0) return [];

  const open = ring.length > 1 && pointsEqual(ring[0]!, ring[ring.length - 1]!) ? ring.slice(0, -1) : [...ring];
  if (open.length === 0) return [];

  const quantized = open.map(quantizePoint);

  const deduped: Position[] = [];
  for (const point of quantized) {
    const last = deduped[deduped.length - 1];
    if (!last || !pointsEqual(last, point)) deduped.push(point);
  }

  if (deduped.length >= 2 && pointsEqual(deduped[0]!, deduped[deduped.length - 1]!)) {
    deduped.pop();
  }

  if (deduped.length < 3) return deduped;

  const simplified = [...deduped];
  let changed = true;

  while (changed && simplified.length >= 3) {
    changed = false;

    for (let i = 0; i < simplified.length; i++) {
      const previous = simplified[(i - 1 + simplified.length) % simplified.length]!;
      const current = simplified[i]!;
      const next = simplified[(i + 1) % simplified.length]!;

      if (collinear(previous, current, next)) {
        simplified.splice(i, 1);
        changed = true;
        break;
      }
    }
  }

  return simplified;
}

function canonicalCycleString(points: Position[]): string {
  if (points.length === 0) return "";

  const keys = points.map(pointKey);
  const length = keys.length;
  let best = "";

  for (let start = 0; start < length; start++) {
    const candidate: string[] = [];
    for (let i = 0; i < length; i++) {
      candidate.push(keys[(start + i) % length]!);
    }

    const asString = candidate.join("|");
    if (best === "" || asString < best) best = asString;
  }

  return best;
}

function ringKey(ring: Position[]): string {
  const open = normalizePointsForKey(ring);
  if (open.length === 0) return "ring:";

  const forward = canonicalCycleString(open);
  const backward = canonicalCycleString([...open].reverse());
  return `ring:${forward < backward ? forward : backward}`;
}

function signedArea(ring: Position[]): number {
  let area = 0;

  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i]!;
    const [x2, y2] = ring[i + 1]!;
    area += x1 * y2 - x2 * y1;
  }

  return area / 2;
}

function pointOnSegment(point: Position, a: Position, b: Position, epsilon = 1e-9): boolean {
  const cross = (b[0] - a[0]) * (point[1] - a[1]) - (b[1] - a[1]) * (point[0] - a[0]);
  if (Math.abs(cross) > epsilon) return false;

  const dot = (point[0] - a[0]) * (b[0] - a[0]) + (point[1] - a[1]) * (b[1] - a[1]);
  if (dot < -epsilon) return false;

  const squaredLength = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
  return dot <= squaredLength + epsilon;
}

function pointOnRingBoundary(point: Position, ring: Position[]): boolean {
  for (let i = 0; i < ring.length - 1; i++) {
    if (pointOnSegment(point, ring[i]!, ring[i + 1]!)) return true;
  }
  return false;
}

function pointInRing(point: Position, ring: Position[]): boolean {
  let inside = false;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]![0];
    const yi = ring[i]![1];
    const xj = ring[j]![0];
    const yj = ring[j]![1];

    const intersects =
      yi > point[1] !== yj > point[1] && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi || Number.EPSILON) + xi;

    if (intersects) inside = !inside;
  }

  return inside;
}

function ringContainsRing(parent: Position[], child: Position[]): boolean {
  let anyStrictInside = false;

  for (const childPoint of child) {
    if (pointOnRingBoundary(childPoint, parent)) continue;
    if (!pointInRing(childPoint, parent)) return false;
    anyStrictInside = true;
  }

  return anyStrictInside;
}

function edgeKey(a: Position, b: Position): string {
  const qa = quantizePoint(a);
  const qb = quantizePoint(b);
  const aKey = pointKey(qa);
  const bKey = pointKey(qb);
  return aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`;
}

function boundaryPathForward(from: Position, to: Position, shape: [number, number]): Position[] {
  if (pointsEqual(from, to)) return [[to[0], to[1]]];

  const [fromSide] = boundaryOrderKey(from, shape);
  const [toSide] = boundaryOrderKey(to, shape);

  if (!Number.isFinite(fromSide) || !Number.isFinite(toSide)) return [[to[0], to[1]]];

  const path: Position[] = [];
  let side = fromSide;

  while (side !== toSide) {
    const corner = sideEndCorner(side, shape);
    appendDistinct(path, corner);
    side = (side + 1) % 4;
  }

  appendDistinct(path, to);
  return path;
}

function closePolylines(polylines: PolylinesWithLevels, boundaries: Position[][], shape: [number, number]) {
  // lines we don't need to deal with - these are already valid polygon rings
  const closedLines: PolylineWithValue[] = [];
  const closedShortLines: PolylineWithValue[] = [];
  const walkedStartTerminationIds = new Set<number>();
  const walkCountByPolyline = new Map<number, number>();
  const emittedLoopKeys = new Set<string>();

  // holds the endpoints along the exterior boundaries that we will check against
  const lineTerminations: LineTermination[] = [];
  let terminationId = 0;

  polylines.polylines.forEach((line, index) => {
    const value = getThresholdValue(polylines, index);

    const [sx, sy] = line[0];
    const [ex, ey] = line[line.length - 1];

    if (sx === ex && sy === ey) {
      // clone the line's coordinates (so we don't accidentally mutate the existing isoline)
      closedLines.push(convertToPolylineWithValue(line, value, index));
    } else {
      if (pointIsOnBoundary(line[0], shape)) {
        lineTerminations.push({ id: terminationId++, polylineIndex: index, atStart: true, point: line[0] });
      }
      if (pointIsOnBoundary(line[line.length - 1], shape)) {
        lineTerminations.push({
          id: terminationId++,
          polylineIndex: index,
          atStart: false,
          point: line[line.length - 1],
        });
      }
    }
  });

  // sort the lineTermination points in a CCW direction starting
  // with the bottom left corner [0,0]in grid space
  lineTerminations.sort((a, b) => {
    const [sideA, distanceA] = boundaryOrderKey(a.point, shape);
    const [sideB, distanceB] = boundaryOrderKey(b.point, shape);

    if (sideA !== sideB) return sideA - sideB;
    if (distanceA !== distanceB) return distanceA - distanceB;

    return a.polylineIndex - b.polylineIndex;
  });

  const sortedTerminationIds = lineTerminations.map((termination) => termination.id);
  const termById = new Map<number, LineTermination>(
    lineTerminations.map((termination) => [termination.id, termination]),
  );
  const termIndexById = new Map<number, number>(
    sortedTerminationIds.map((terminationId, sortedIndex) => [terminationId, sortedIndex]),
  );

  const termIdsByPolyline = new Map<number, number[]>();
  for (const termination of lineTerminations) {
    const existing = termIdsByPolyline.get(termination.polylineIndex);
    if (!existing) termIdsByPolyline.set(termination.polylineIndex, [termination.id]);
    else existing.push(termination.id);
  }

  const oppositeTermination = (termination: LineTermination): LineTermination | undefined => {
    const ids = termIdsByPolyline.get(termination.polylineIndex);
    if (!ids || ids.length < 2) return undefined;
    const oppositeId = ids[0] === termination.id ? ids[1] : ids[0];
    return oppositeId === undefined ? undefined : termById.get(oppositeId);
  };

  const nextTermination = (termination: LineTermination): LineTermination | undefined => {
    const at = termIndexById.get(termination.id);
    if (at === undefined || sortedTerminationIds.length === 0) return undefined;
    const nextId = sortedTerminationIds[(at + 1) % sortedTerminationIds.length]!;
    return termById.get(nextId);
  };

  for (const startTermination of lineTerminations) {
    if (walkedStartTerminationIds.has(startTermination.id)) continue;

    const existingWalkCount = walkCountByPolyline.get(startTermination.polylineIndex) ?? 0;
    if (existingWalkCount >= 2) continue;

    const startLine = polylines.polylines[startTermination.polylineIndex];
    const startValue = getThresholdValue(polylines, startTermination.polylineIndex);
    const ring: Position[] = [[startTermination.point[0], startTermination.point[1]]];
    let stitched = false;
    let minWalkValue = startValue;

    let currentTermination: LineTermination | undefined = startTermination;
    const maxSteps = lineTerminations.length * 4 + 8;

    for (let step = 0; step < maxSteps; step++) {
      if (!currentTermination) break;

      const currentLine = polylines.polylines[currentTermination.polylineIndex];
      const currentValue = getThresholdValue(polylines, currentTermination.polylineIndex);
      minWalkValue = Math.min(minWalkValue, currentValue);
      const linePath = currentTermination.atStart ? currentLine : [...currentLine].reverse();
      appendPathDistinct(
        ring,
        linePath.slice(1).map((point) => [point[0], point[1]]),
      );

      const exitTermination = oppositeTermination(currentTermination);
      if (!exitTermination) break;

      const nextOnBoundary = nextTermination(exitTermination);
      if (!nextOnBoundary) break;

      appendPathDistinct(ring, boundaryPathForward(exitTermination.point, nextOnBoundary.point, shape));

      if (nextOnBoundary.polylineIndex === startTermination.polylineIndex) {
        appendPathDistinct(ring, boundaryPathForward(nextOnBoundary.point, startTermination.point, shape));
        if (!pointsEqual(ring[0]!, ring[ring.length - 1]!)) ring.push([ring[0]![0], ring[0]![1]]);
        const dedupeKey = ringKey(ring);
        if (!emittedLoopKeys.has(dedupeKey)) {
          closedShortLines.push(convertToPolylineWithValue(ring, minWalkValue, startTermination.polylineIndex));
          emittedLoopKeys.add(dedupeKey);
        }
        stitched = true;
        break;
      }

      currentTermination = nextOnBoundary;
    }

    // If we could not stitch this walk into a closure, preserve the original
    // polyline so upstream code can still inspect the unresolved geometry.
    if (!stitched) {
      const dedupeKey = ringKey(startLine);
      if (!emittedLoopKeys.has(dedupeKey)) {
        closedShortLines.push(convertToPolylineWithValue(startLine, startValue, startTermination.polylineIndex));
        emittedLoopKeys.add(dedupeKey);
      }
    }

    // Only mark the origin termination as consumed so other starts,
    // including the opposite endpoint of the same polyline, can still run.
    walkedStartTerminationIds.add(startTermination.id);
    walkCountByPolyline.set(startTermination.polylineIndex, existingWalkCount + 1);
  }

  return { closedLines, openLines: [], closedShortLines };
}

export function generateIsoareas(
  polylines: PolylinesWithLevels,
  boundaries: Position[][],
  options: IsoareaOptions,
): PolygonsWithLevels {
  const { closedLines, closedShortLines } = closePolylines(polylines, boundaries, options.shape);

  // Final safety dedupe: remove identical geometry emitted from different
  // traversal origins before turning lines into polygons.
  const geometryIndexByKey = new Map<string, number>();
  const uniqueLines: PolylineWithValue[] = [];

  for (const line of [...closedLines, ...closedShortLines]) {
    const dedupeKey = ringKey(line.coords);
    const existingIndex = geometryIndexByKey.get(dedupeKey);

    if (existingIndex === undefined) {
      geometryIndexByKey.set(dedupeKey, uniqueLines.length);
      uniqueLines.push(line);
      continue;
    }

    const existing = uniqueLines[existingIndex]!;
    if (line.value < existing.value) {
      uniqueLines[existingIndex] = {
        ...existing,
        value: line.value,
      };
    }
  }

  // if one of the x or y values is equal to either zero or the boundary limit, it might indicate an edge case for closing the polyline

  console.log("started closed:", closedLines.length);
  console.log("we closed:", closedShortLines.length);
  console.log("deduped total:", uniqueLines.length);

  const baseValues = uniqueLines.map((line) => line.value);
  const adjustedValues = [...baseValues];
  const absoluteAreas = uniqueLines.map((line) => Math.abs(signedArea(line.coords)));
  const parentByIndex = new Map<number, number>();

  for (let childIndex = 0; childIndex < uniqueLines.length; childIndex++) {
    let bestParent: number | undefined;
    let bestParentArea = Number.POSITIVE_INFINITY;

    for (let parentIndex = 0; parentIndex < uniqueLines.length; parentIndex++) {
      if (childIndex === parentIndex) continue;

      const parentArea = absoluteAreas[parentIndex]!;
      const childArea = absoluteAreas[childIndex]!;
      if (parentArea <= childArea) continue;

      if (!ringContainsRing(uniqueLines[parentIndex]!.coords, uniqueLines[childIndex]!.coords)) continue;

      if (parentArea < bestParentArea) {
        bestParentArea = parentArea;
        bestParent = parentIndex;
      }
    }

    if (bestParent !== undefined) parentByIndex.set(childIndex, bestParent);
  }

  const neighborsByIndex = new Map<number, Set<number>>();
  const ringIndicesByEdge = new Map<string, number[]>();

  uniqueLines.forEach((line, ringIndex) => {
    for (let i = 0; i < line.coords.length - 1; i++) {
      const key = edgeKey(line.coords[i]!, line.coords[i + 1]!);
      const existing = ringIndicesByEdge.get(key);
      if (!existing) ringIndicesByEdge.set(key, [ringIndex]);
      else existing.push(ringIndex);
    }
  });

  for (const sharing of ringIndicesByEdge.values()) {
    if (sharing.length < 2) continue;

    for (let i = 0; i < sharing.length; i++) {
      for (let j = i + 1; j < sharing.length; j++) {
        const a = sharing[i]!;
        const b = sharing[j]!;
        if (!neighborsByIndex.has(a)) neighborsByIndex.set(a, new Set<number>());
        if (!neighborsByIndex.has(b)) neighborsByIndex.set(b, new Set<number>());
        neighborsByIndex.get(a)!.add(b);
        neighborsByIndex.get(b)!.add(a);
      }
    }
  }

  for (let i = 0; i < uniqueLines.length; i++) {
    const currentValue = baseValues[i]!;
    const currentLevel = findLevelIndex(polylines.levelValues, currentValue);
    if (currentLevel <= 0) continue;

    const parentIndex = parentByIndex.get(i);
    const touchesBoundary = uniqueLines[i]!.coords.some((point) => pointIsOnBoundary(point, options.shape));

    let shouldDropLevel = false;

    if (parentIndex !== undefined && baseValues[parentIndex] === currentValue) {
      shouldDropLevel = true;
    } else if (touchesBoundary) {
      const neighbors = neighborsByIndex.get(i);
      if (neighbors) {
        for (const neighborIndex of neighbors) {
          // Only treat larger adjacent rings as parent-like neighbors.
          if (absoluteAreas[neighborIndex]! > absoluteAreas[i]! && baseValues[neighborIndex] === currentValue) {
            shouldDropLevel = true;
            break;
          }
        }
      }
    }

    if (shouldDropLevel) {
      adjustedValues[i] = polylines.levelValues[currentLevel - 1]!;
    }
  }

  const polygons = uniqueLines.map((line) => [line.coords]);
  const levelIndex = Uint8Array.from(adjustedValues.map((value) => findLevelIndex(polylines.levelValues, value)));

  return { polygons, levelIndex, levelValues: polylines.levelValues };
}
