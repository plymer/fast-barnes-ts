import type { Position } from "geojson";
import type { PolylinesWithLevels } from "./types";

export function getIsolineThreshold(polylines: PolylinesWithLevels, index: number) {
  return polylines.levelValues[polylines.polylineLevelIndex[index]!];
}

// Shoelace formula; ring is expected closed (first point repeated as last).
export function ringSignedArea(ring: Position[]): number {
  let sum = 0;
  const n = ring.length - 1;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = ring[i]!;
    const [x1, y1] = ring[i + 1]!;
    sum += x0 * y1 - x1 * y0;
  }
  return sum / 2;
}

// Ray-casting point-in-polygon test; ring is expected closed (first point repeated as last).
export function pointInRing(point: Position, ring: Position[]): boolean {
  const [px, py] = point;
  const n = ring.length - 1;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    const intersects = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function reverseRing(ring: Position[]): Position[] {
  return [...ring].reverse();
}

// Projects `point` onto the closest segment of `ring` (expected closed); used to snap polyline
// endpoints onto a boundary ring that was traced from a different (mask) field and may not share
// exact coordinates.
export function closestPointOnRing(point: Position, ring: Position[]): { segmentIndex: number; distSq: number } {
  const n = ring.length - 1;
  let bestSegmentIndex = 0;
  let bestDistSq = Infinity;

  for (let i = 0; i < n; i++) {
    const [ax, ay] = ring[i]!;
    const [bx, by] = ring[i + 1]!;
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((point[0] - ax) * dx + (point[1] - ay) * dy) / lengthSq));
    const projX = ax + t * dx;
    const projY = ay + t * dy;
    const distSq = (point[0] - projX) ** 2 + (point[1] - projY) ** 2;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      bestSegmentIndex = i;
    }
  }

  return { segmentIndex: bestSegmentIndex, distSq: bestDistSq };
}
