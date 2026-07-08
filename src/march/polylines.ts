export type Edge = "top" | "right" | "bottom" | "left";
export type SegmentOnCell = [Edge, Edge];
export type Point = [number, number];
export type Segment = [Point, Point];
export type FieldTopology = {
  x: number;
  y: number;
  segments: SegmentOnCell[];
};

export type PolylinesWithLevels = {
  polylines: Point[][];
  levelValues: number[]; // unique thresholds, stored once
  polylineLevelIndex: Uint8Array;
};

const thresholdEpsilon = 1e-9;

type EdgeCode = 0 | 1 | 2 | 3; // top, right, bottom, left
type EdgeCodeSegment = readonly [EdgeCode, EdgeCode];
type EdgeCodeSegments = readonly EdgeCodeSegment[];

type ScalarField = {
  xDim: number;
  yDim: number;
  get: (x: number, y: number) => number;
};

const edgeCodes: ReadonlyArray<EdgeCodeSegments | undefined> = [
  undefined,
  [[3, 2]],
  [[2, 1]],
  [[3, 1]],
  [[0, 1]],
  undefined,
  [[0, 2]],
  [[3, 0]],
  [[0, 3]],
  [[0, 2]],
  undefined,
  [[0, 1]],
  [[3, 1]],
  [[2, 1]],
  [[3, 2]],
  undefined,
] as const;

const ambiguousCase5Above: EdgeCodeSegments = [
  [0, 3],
  [2, 1],
] as const;

const ambiguousCase5Below: EdgeCodeSegments = [
  [0, 1],
  [3, 2],
] as const;

const ambiguousCase10Above: EdgeCodeSegments = [
  [0, 1],
  [3, 2],
] as const;

const ambiguousCase10Below: EdgeCodeSegments = [
  [0, 3],
  [2, 1],
] as const;

const isAboveThreshold = (value: number, threshold: number) => value > threshold + thresholdEpsilon;
const isFiniteNumber = (value: number) => Number.isFinite(value);

function interpolateT(a: number, b: number, threshold: number) {
  if (a === b) return 0.5;
  return (threshold - a) / (b - a);
}

function assertGridDims(xDim: number, yDim: number) {
  if (!Number.isInteger(xDim) || !Number.isInteger(yDim) || xDim < 2 || yDim < 2) {
    throw new Error("Grid dimensions are invalid; expected xDim >= 2 and yDim >= 2");
  }
}

function fieldFromNestedGrid(grid: number[][]): ScalarField {
  const yDim = grid.length;
  const xDim = grid[0]?.length ?? 0;
  assertGridDims(xDim, yDim);

  for (let y = 0; y < yDim; y++) {
    if (grid[y]?.length !== xDim) throw new Error("Grid rows are not rectangular");
  }

  return {
    xDim,
    yDim,
    get: (x, y) => grid[y]![x]!,
  };
}

function fieldFromTypedArray(data: Float32Array, xDim: number, yDim: number): ScalarField {
  assertGridDims(xDim, yDim);
  if (data.length !== xDim * yDim) {
    throw new Error("Float32Array length does not match xDim * yDim");
  }

  return {
    xDim,
    yDim,
    get: (x, y) => data[y * xDim + x]!,
  };
}

function resolveSaddle(cellX: number, cellY: number, caseIndex: 5 | 10, field: ScalarField, threshold: number) {
  const tl = field.get(cellX, cellY);
  const tr = field.get(cellX + 1, cellY);
  const br = field.get(cellX + 1, cellY + 1);
  const bl = field.get(cellX, cellY + 1);

  const centerAbove = isAboveThreshold((tl + tr + br + bl) * 0.25, threshold);

  switch (caseIndex) {
    case 5:
      return centerAbove ? ambiguousCase5Above : ambiguousCase5Below;
    case 10:
      return centerAbove ? ambiguousCase10Above : ambiguousCase10Below;
  }
}

function edgeCodeToId(
  edgeCode: EdgeCode,
  cellX: number,
  cellY: number,
  cellXDim: number,
  xDim: number,
  horizontalEdgeCount: number,
) {
  switch (edgeCode) {
    case 0:
      return cellY * cellXDim + cellX;
    case 2:
      return (cellY + 1) * cellXDim + cellX;
    case 3:
      return horizontalEdgeCount + cellY * xDim + cellX;
    default:
      return horizontalEdgeCount + cellY * xDim + (cellX + 1);
  }
}

function edgeIdToPoint(
  edgeId: number,
  horizontalEdgeCount: number,
  cellXDim: number,
  xDim: number,
  field: ScalarField,
  threshold: number,
) {
  if (edgeId < horizontalEdgeCount) {
    const y = Math.floor(edgeId / cellXDim);
    const x = edgeId - y * cellXDim;
    const a = field.get(x, y);
    const b = field.get(x + 1, y);
    return [x + interpolateT(a, b, threshold), y] as Point;
  }

  const localId = edgeId - horizontalEdgeCount;
  const y = Math.floor(localId / xDim);
  const x = localId - y * xDim;
  const a = field.get(x, y);
  const b = field.get(x, y + 1);
  return [x, y + interpolateT(a, b, threshold)] as Point;
}

function computeSegments(caseIndex: number, x: number, y: number, field: ScalarField, threshold: number) {
  const isAmbiguous = caseIndex === 5 || caseIndex === 10;
  return isAmbiguous ? resolveSaddle(x, y, caseIndex as 5 | 10, field, threshold) : edgeCodes[caseIndex]!;
}

function computeCaseIdentities(field: ScalarField, threshold: number) {
  const { xDim, yDim } = field;
  const cellXDim = xDim - 1;
  const cellYDim = yDim - 1;
  const caseGrid = new Uint8Array(cellXDim * cellYDim);

  for (let y = 0; y < cellYDim; y++) {
    for (let x = 0; x < cellXDim; x++) {
      const topLeftValue = field.get(x, y);
      const topRightValue = field.get(x + 1, y);
      const bottomRightValue = field.get(x + 1, y + 1);
      const bottomLeftValue = field.get(x, y + 1);

      // Treat invalid/no-data corners as outside the contour domain for this cell.
      if (
        !isFiniteNumber(topLeftValue) ||
        !isFiniteNumber(topRightValue) ||
        !isFiniteNumber(bottomRightValue) ||
        !isFiniteNumber(bottomLeftValue)
      ) {
        caseGrid[y * cellXDim + x] = 0;
        continue;
      }

      const topLeft = isAboveThreshold(topLeftValue, threshold) ? 1 : 0;
      const topRight = isAboveThreshold(topRightValue, threshold) ? 1 : 0;
      const bottomRight = isAboveThreshold(bottomRightValue, threshold) ? 1 : 0;
      const bottomLeft = isAboveThreshold(bottomLeftValue, threshold) ? 1 : 0;

      caseGrid[y * cellXDim + x] = (topLeft << 3) | (topRight << 2) | (bottomRight << 1) | bottomLeft;
    }
  }

  return { caseGrid, cellXDim, cellYDim, xDim, yDim };
}

function computeTopology(
  caseGrid: Uint8Array,
  cellXDim: number,
  cellYDim: number,
  field: ScalarField,
  threshold: number,
) {
  const xDim = cellXDim + 1;
  const yDim = cellYDim + 1;

  const horizontalEdgeCount = cellXDim * yDim;
  const verticalEdgeCount = xDim * cellYDim;
  const endpointCount = horizontalEdgeCount + verticalEdgeCount;

  // we loop over once first to figure out how large our edge allocations need to be
  let segmentCount = 0;
  for (let y = 0; y < cellYDim; y++) {
    for (let x = 0; x < cellXDim; x++) {
      const caseIndex = caseGrid[y * cellXDim + x]!;
      if (caseIndex === 0 || caseIndex === 15) continue;
      segmentCount += computeSegments(caseIndex, x, y, field, threshold).length;
    }
  }

  // allocate our memory for edges
  const edgeA = new Uint32Array(segmentCount);
  const edgeB = new Uint32Array(segmentCount);
  let writeIdx = 0;

  for (let y = 0; y < cellYDim; y++) {
    for (let x = 0; x < cellXDim; x++) {
      const caseIndex = caseGrid[y * cellXDim + x]!;
      if (caseIndex === 0 || caseIndex === 15) continue;

      const segments = computeSegments(caseIndex, x, y, field, threshold);

      for (const [e0, e1] of segments) {
        const idA = edgeCodeToId(e0, x, y, cellXDim, xDim, horizontalEdgeCount);
        const idB = edgeCodeToId(e1, x, y, cellXDim, xDim, horizontalEdgeCount);
        if (idA === idB) continue;
        edgeA[writeIdx] = idA;
        edgeB[writeIdx] = idB;
        writeIdx++;
      }
    }
  }

  return writeIdx === segmentCount
    ? { edgeA, edgeB, endpointCount, horizontalEdgeCount, xDim, cellXDim }
    : {
        edgeA: edgeA.slice(0, writeIdx),
        edgeB: edgeB.slice(0, writeIdx),
        endpointCount,
        horizontalEdgeCount,
        xDim,
        cellXDim,
      };
}

function generateGeometry(
  edgeA: Uint32Array,
  edgeB: Uint32Array,
  endpointCount: number,
  horizontalEdgeCount: number,
  cellXDim: number,
  xDim: number,
  field: ScalarField,
  threshold: number,
) {
  const segmentCount = edgeA.length;
  const degree = new Uint16Array(endpointCount);

  for (let i = 0; i < segmentCount; i++) {
    degree[edgeA[i]!]! += 1;
    degree[edgeB[i]!]! += 1;
  }

  const offsets = new Uint32Array(endpointCount + 1);
  for (let i = 0; i < endpointCount; i++) offsets[i + 1] = offsets[i]! + degree[i]!;

  const incident = new Uint32Array(offsets[endpointCount]!);
  const cursor = new Uint32Array(offsets);

  for (let i = 0; i < segmentCount; i++) {
    const a = edgeA[i]!;
    const b = edgeB[i]!;
    incident[cursor[a]!] = i;
    cursor[a]!++;
    incident[cursor[b]!] = i;
    cursor[b]!++;
  }

  const pointX = new Float64Array(endpointCount);
  const pointY = new Float64Array(endpointCount);
  const pointReady = new Uint8Array(endpointCount);

  const getPoint = (edgeId: number): Point => {
    if (pointReady[edgeId] === 1) return [pointX[edgeId]!, pointY[edgeId]!];
    const [x, y] = edgeIdToPoint(edgeId, horizontalEdgeCount, cellXDim, xDim, field, threshold);
    pointX[edgeId] = x;
    pointY[edgeId] = y;
    pointReady[edgeId] = 1;
    return [x, y];
  };

  const visited = new Uint8Array(segmentCount);
  const polylines: Point[][] = [];

  const walkFrom = (startEdgeId: number) => {
    const line: Point[] = [getPoint(startEdgeId)];
    let currentEdgeId = startEdgeId;

    while (true) {
      const begin = offsets[currentEdgeId]!;
      const end = offsets[currentEdgeId + 1]!;
      let nextSegment = -1;

      for (let i = begin; i < end; i++) {
        const segIdx = incident[i]!;
        if (visited[segIdx] === 0) {
          nextSegment = segIdx;
          break;
        }
      }

      if (nextSegment === -1) break;
      visited[nextSegment] = 1;

      const a = edgeA[nextSegment]!;
      const b = edgeB[nextSegment]!;
      currentEdgeId = a === currentEdgeId ? b : a;
      line.push(getPoint(currentEdgeId));
    }

    if (line.length > 1) polylines.push(line);
  };

  for (let edgeId = 0; edgeId < endpointCount; edgeId++) {
    if (degree[edgeId] === 1) walkFrom(edgeId);
  }

  for (let segIdx = 0; segIdx < segmentCount; segIdx++) {
    if (visited[segIdx] === 0) walkFrom(edgeA[segIdx]!);
  }

  return polylines;
}

function computePolylines(thresholds: number[], field: ScalarField) {
  const allPolylines: Point[][] = [];
  const levelIndexBuffer: number[] = [];

  if (thresholds.length > 255) {
    throw new Error(
      `Your threshold count is ${thresholds.length}. This marching squares implementation only supports up to 255 thresholds due to internal use of Uint8Array for level indexing. Please reduce the number of thresholds or implement a custom solution for more levels.`,
    );
  }

  for (let levelIdx = 0; levelIdx < thresholds.length; levelIdx++) {
    const threshold = thresholds[levelIdx]!;
    const { caseGrid, cellXDim, cellYDim } = computeCaseIdentities(field, threshold);
    const { edgeA, edgeB, endpointCount, horizontalEdgeCount, xDim } = computeTopology(
      caseGrid,
      cellXDim,
      cellYDim,
      field,
      threshold,
    );

    const polylines = generateGeometry(
      edgeA,
      edgeB,
      endpointCount,
      horizontalEdgeCount,
      cellXDim,
      xDim,
      field,
      threshold,
    );

    allPolylines.push(...polylines);

    for (let i = 0; i < polylines.length; i++) {
      levelIndexBuffer.push(levelIdx);
    }
  }

  return {
    polylines: allPolylines,
    levelValues: thresholds.slice(),
    polylineLevelIndex: Uint8Array.from(levelIndexBuffer),
  };
}

export function marchingSquares(thresholds: number[], grid: number[][]): PolylinesWithLevels;
export function marchingSquares(
  thresholds: number[],
  typedArray: Float32Array,
  shape: [number, number],
): PolylinesWithLevels;
export function marchingSquares(
  thresholds: number[],
  data: number[][] | Float32Array,
  shape?: [number, number],
): PolylinesWithLevels {
  if (data instanceof Float32Array) {
    if (!shape) {
      throw new Error("Shape must be provided when using typed array input");
    } else {
      const [xDim, yDim] = shape;

      if (data.length !== xDim * yDim) {
        throw new Error("Typed array length does not match provided shape");
      }

      if (shape.length !== 2) {
        throw new Error("Only 2D shapes are supported");
      }

      return computePolylines(thresholds, fieldFromTypedArray(data, xDim, yDim));
    }
  } else {
    return computePolylines(thresholds, fieldFromNestedGrid(data));
  }
}
