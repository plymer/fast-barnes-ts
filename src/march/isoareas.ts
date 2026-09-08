import type { Position } from "geojson";
import type { PolygonsWithLevels, PolylinesWithLevels } from "./types";
import { closestPointOnRing, pointInRing, reverseRing, ringSignedArea } from "./helpers";

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

function pointsEqual(a: Position, b: Position): boolean {
  return Math.abs(a[0] - b[0]) < pointEpsilon && Math.abs(a[1] - b[1]) < pointEpsilon;
}

function closestBoundaryLocation(point: Position, boundaries: Position[][]) {
  let best: { boundaryRingIndex: number; segmentIndex: number; distSq: number } | undefined;
  for (let ringIndex = 0; ringIndex < boundaries.length; ringIndex++) {
    const { segmentIndex, distSq } = closestPointOnRing(point, boundaries[ringIndex]!);
    if (!best || distSq < best.distSq) best = { boundaryRingIndex: ringIndex, segmentIndex, distSq };
  }
  return best;
}

// Close every open polyline independently against the boundary ring it exits through, walking the
// boundary forward from the exit point to the entry point. Closed polylines pass through unchanged.
function closePolylines(polylines: PolylinesWithLevels, boundaries: Position[][]): Ring[] {
  return polylines.polylines.map((line, i) => {
    const levelIndex = polylines.levelIndex[i]!;
    const first = line[0]!;
    const last = line[line.length - 1]!;

    if (pointsEqual(first, last)) return { linePoints: line, levelIndex };

    const entry = closestBoundaryLocation(first, boundaries);
    const exit = closestBoundaryLocation(last, boundaries);
    if (!entry || !exit) {
      throw new Error(`Open polyline at index ${i} does not touch any provided boundary ring.`);
    }
    if (entry.boundaryRingIndex !== exit.boundaryRingIndex) {
      throw new Error(
        `Open polyline at index ${i} touches two different boundary rings; closing across separate rings is not supported.`,
      );
    }

    const boundaryRingIndex = entry.boundaryRingIndex;
    const boundaryPts = boundaries[boundaryRingIndex]!.slice(0, -1); // unique points; ring re-closes at [0]
    const n = boundaryPts.length;

    const closingRefs: Ring["closingRefs"] = [];
    let segIdx = (exit.segmentIndex + 1) % n;
    const stopIdx = (entry.segmentIndex + 1) % n;
    while (segIdx !== stopIdx) {
      closingRefs.push({ point: boundaryPts[segIdx]!, boundaryRingIndex, segmentIndex: segIdx });
      segIdx = (segIdx + 1) % n;
    }

    return { linePoints: line, levelIndex, closingRefs };
  });
}

// Drops boundary-hugging vertices already claimed by an earlier ring so two independently-closed
// rings that traced the same boundary arc don't both emit the shared edge.
function finalizeRingPoints(rings: Ring[]): Position[][] {
  const claimed = new Set<string>();

  return rings.map((ring) => {
    if (!ring.closingRefs) return ring.linePoints;

    const kept = ring.closingRefs.filter((ref) => {
      const key = `${ref.boundaryRingIndex}:${ref.segmentIndex}`;
      if (claimed.has(key)) return false;
      claimed.add(key);
      return true;
    });

    return [...ring.linePoints, ...kept.map((ref) => ref.point), ring.linePoints[0]!];
  });
}

// Assigns each ring's immediate containing parent (the smallest-area ring that contains it),
// across all levels combined, forming one general nesting forest.
function buildContainmentForest(rings: Position[][]) {
  const n = rings.length;
  const areas = rings.map((ring) => Math.abs(ringSignedArea(ring)));
  const parent: (number | undefined)[] = Array.from({ length: n }, () => undefined);
  const children: number[][] = Array.from({ length: n }, () => []);

  for (let i = 0; i < n; i++) {
    const testPoint = rings[i]![0]!;
    let bestParent: number | undefined;
    let bestArea = Infinity;

    for (let j = 0; j < n; j++) {
      if (j === i || areas[j]! <= areas[i]! || areas[j]! >= bestArea) continue;
      if (pointInRing(testPoint, rings[j]!)) {
        bestParent = j;
        bestArea = areas[j]!;
      }
    }

    parent[i] = bestParent;
    if (bestParent !== undefined) children[bestParent]!.push(i);
  }

  return { parent, children };
}

// A ring is "ascending" (mountain: >= its level is inside) if it has an even number of same-level
// ancestors, and "descending" (valley: only ever used as a hole) if that count is odd.
function classifyAscending(levelIndices: Uint8Array, parent: (number | undefined)[]): boolean[] {
  return Array.from(levelIndices, (levelIndex, i) => {
    let sameLevelAncestors = 0;
    let cur = parent[i];
    while (cur !== undefined) {
      if (levelIndices[cur] === levelIndex) sameLevelAncestors++;
      cur = parent[cur];
    }
    return sameLevelAncestors % 2 === 0;
  });
}

function assembleBands(
  rings: Position[][],
  levelIndices: Uint8Array,
  children: number[][],
  ascending: boolean[],
  levelValues: number[],
) {
  const polygons: Position[][][] = [];
  const bandLevelIndex: number[] = [];

  for (let i = 0; i < rings.length; i++) {
    if (!ascending[i]) continue;
    const level = levelIndices[i]!;
    if (level + 1 >= levelValues.length) continue; // no next level to bound this band above

    const holes = children[i]!.filter(
      (c) => levelIndices[c] === level || (levelIndices[c] === level + 1 && ascending[c]),
    ).map((c) => reverseRing(rings[c]!));

    polygons.push([rings[i]!, ...holes]);
    bandLevelIndex.push(level);
  }

  return { polygons, levelIndex: Uint8Array.from(bandLevelIndex) };
}

export function generateIsoareas(
  polylines: PolylinesWithLevels,
  boundaries: Position[][],
  _options: IsoareaOptions,
): PolygonsWithLevels {
  const rings = closePolylines(polylines, boundaries);
  const ringPoints = finalizeRingPoints(rings);
  const levelIndices = polylines.levelIndex;

  const { parent, children } = buildContainmentForest(ringPoints);
  const ascending = classifyAscending(levelIndices, parent);
  const { polygons, levelIndex } = assembleBands(ringPoints, levelIndices, children, ascending, polylines.levelValues);

  return { polygons, levelValues: polylines.levelValues, levelIndex };
}
