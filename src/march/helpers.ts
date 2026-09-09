import type { Position } from "geojson";
import type { PolygonsWithLevels, PolylinesWithLevels } from "./types";

export function getThresholdValue(features: PolylinesWithLevels | PolygonsWithLevels, index: number) {
  return features.levelValues[features.levelIndex[index]!];
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
