import type { BarnesResult, GridExtremaOptions2D, GridExtremaPoint2D, ScalarOrVector } from "../types";

/**
 * Finds local maxima and minima on a 2D interpolation grid.
 *
 * The detector first finds strict local extrema within a square neighborhood,
 * then filters weak signals by prominence and applies minimum-separation
 * suppression to avoid noisy chains along troughs/ridges.
 *
 * @param grid 2D interpolation result from `barnes(...)`.
 * @param x0 Grid origin in data coordinates.
 * @param step Grid spacing in data coordinates.
 * @param options Extrema filtering options.
 * @returns Extrema points with grid indices, coordinates, value, and kind.
 */
export function findGridExtrema2D(
  grid: BarnesResult,
  x0: ScalarOrVector,
  step: ScalarOrVector,
  options: GridExtremaOptions2D = {},
): GridExtremaPoint2D[] {
  if (grid.dimension !== 2 || grid.shape.length !== 2) {
    throw new Error(`findGridExtrema2D expects a 2D BarnesResult, got ${grid.dimension}D with shape ${grid.shape}`);
  }

  const [sx, sy] = grid.shape;
  const [x0x, x0y] = normalize2DVectorForExtrema(x0, "x0");
  const [stepX, stepY] = normalize2DVectorForExtrema(step, "step");

  if (!(stepX > 0) || !(stepY > 0)) {
    throw new Error(`step must be > 0 in both dimensions, got [${stepX}, ${stepY}]`);
  }

  const radius = options.radius ?? 1;
  const minSeparation = options.minSeparation ?? 2;
  const minProminence = options.minProminence ?? 0.01;
  const maxCountPerKind = options.maxCountPerKind;

  if (!Number.isInteger(radius) || radius < 1) {
    throw new Error(`radius must be an integer >= 1, got ${radius}`);
  }
  if (!(minSeparation >= 0)) {
    throw new Error(`minSeparation must be >= 0, got ${minSeparation}`);
  }
  if (!(minProminence >= 0)) {
    throw new Error(`minProminence must be >= 0, got ${minProminence}`);
  }
  if (maxCountPerKind !== undefined && (!Number.isInteger(maxCountPerKind) || maxCountPerKind < 1)) {
    throw new Error(`maxCountPerKind must be an integer >= 1 when provided, got ${maxCountPerKind}`);
  }

  const data = grid.data;
  const candidatesMax: GridExtremaPoint2D[] = [];
  const candidatesMin: GridExtremaPoint2D[] = [];

  const iStart = radius;
  const iEnd = sx - radius;
  const jStart = radius;
  const jEnd = sy - radius;

  for (let j = jStart; j < jEnd; j++) {
    const rowOffset = j * sx;
    for (let i = iStart; i < iEnd; i++) {
      const idx = rowOffset + i;
      const center = data[idx];
      if (!Number.isFinite(center)) continue;

      const eps = 1e-9 * Math.max(1.0, Math.abs(center));
      let isMax = true;
      let isMin = true;
      let maxNeighbor = Number.NEGATIVE_INFINITY;
      let minNeighbor = Number.POSITIVE_INFINITY;
      let hasNeighbor = false;
      let touchesInvalidNeighbor = false;

      const jMin = Math.max(0, j - radius);
      const jMax = Math.min(sy - 1, j + radius);
      const iMin = Math.max(0, i - radius);
      const iMax = Math.min(sx - 1, i + radius);

      for (let nj = jMin; nj <= jMax; nj++) {
        const nRow = nj * sx;
        for (let ni = iMin; ni <= iMax; ni++) {
          if (ni === i && nj === j) continue;
          const neighbor = data[nRow + ni];
          if (!Number.isFinite(neighbor)) {
            touchesInvalidNeighbor = true;
            break;
          }

          hasNeighbor = true;
          if (neighbor > maxNeighbor) maxNeighbor = neighbor;
          if (neighbor < minNeighbor) minNeighbor = neighbor;

          if (!(center > neighbor + eps)) isMax = false;
          if (!(center < neighbor - eps)) isMin = false;

          if (!isMax && !isMin) break;
        }
        if (touchesInvalidNeighbor || (!isMax && !isMin)) break;
      }

      if (touchesInvalidNeighbor) continue;
      if (!hasNeighbor) continue;

      if (isMax) {
        const prominence = center - maxNeighbor;
        if (prominence >= minProminence) {
          candidatesMax.push({
            kind: "max",
            value: center,
            prominence,
            gridIndex: idx,
            i,
            j,
            x: x0x + i * stepX,
            y: x0y + j * stepY,
          });
        }
      }

      if (isMin) {
        const prominence = minNeighbor - center;
        if (prominence >= minProminence) {
          candidatesMin.push({
            kind: "min",
            value: center,
            prominence,
            gridIndex: idx,
            i,
            j,
            x: x0x + i * stepX,
            y: x0y + j * stepY,
          });
        }
      }
    }
  }

  const keptMax = suppressExtrema(candidatesMax, minSeparation, maxCountPerKind);
  const keptMin = suppressExtrema(candidatesMin, minSeparation, maxCountPerKind);
  return [...keptMax, ...keptMin];
}

function suppressExtrema(
  candidates: GridExtremaPoint2D[],
  minSeparation: number,
  maxCountPerKind?: number,
): GridExtremaPoint2D[] {
  const sorted = candidates.slice();
  if (sorted.length === 0) return sorted;

  const isMax = sorted[0].kind === "max";
  sorted.sort((a, b) => {
    if (isMax) {
      if (b.value !== a.value) return b.value - a.value;
    } else if (a.value !== b.value) {
      return a.value - b.value;
    }
    return b.prominence - a.prominence;
  });

  if (minSeparation <= 0) {
    return maxCountPerKind === undefined ? sorted : sorted.slice(0, maxCountPerKind);
  }

  const minSepSq = minSeparation * minSeparation;
  const kept: GridExtremaPoint2D[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const candidate = sorted[i];
    let blocked = false;

    for (let k = 0; k < kept.length; k++) {
      const accepted = kept[k];
      const dx = candidate.i - accepted.i;
      const dy = candidate.j - accepted.j;
      if (dx * dx + dy * dy <= minSepSq) {
        blocked = true;
        break;
      }
    }

    if (blocked) continue;
    kept.push(candidate);

    if (maxCountPerKind !== undefined && kept.length >= maxCountPerKind) {
      break;
    }
  }

  return kept;
}

function normalize2DVectorForExtrema(value: ScalarOrVector, name: string): [number, number] {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`${name} must be finite, got ${value}`);
    }
    return [value, value];
  }

  const arr = Array.from(value);
  if (arr.length !== 2) {
    throw new Error(`${name} must be scalar or length-2 array, got length ${arr.length}`);
  }

  const x = arr[0];
  const y = arr[1];
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error(`${name} values must be finite, got [${x}, ${y}]`);
  }

  return [x, y];
}
