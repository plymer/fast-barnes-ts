import { barnes } from "../dist/index.js";

function lcg(seed) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function createSyntheticDataset(sampleCount, bounds, seed = 42) {
  const rand = lcg(seed);
  const points = [];
  const values = [];

  const [xMin, xMax, yMin, yMax] = bounds;
  for (let i = 0; i < sampleCount; i++) {
    const x = xMin + rand() * (xMax - xMin);
    const y = yMin + rand() * (yMax - yMin);

    const signal =
      2.2 * Math.sin(0.55 * x) + 1.4 * Math.cos(0.42 * y) + 0.6 * Math.sin(0.2 * x * y);

    const noise = (rand() - 0.5) * 0.2;

    points.push([x, y]);
    values.push(signal + noise);
  }

  return { points, values };
}

function hrtimeMs() {
  return Number(process.hrtime.bigint()) / 1e6;
}

function runTimed(iterations, fn) {
  const runs = [];
  let last;

  for (let i = 0; i < iterations; i++) {
    const start = hrtimeMs();
    last = fn();
    const end = hrtimeMs();
    runs.push(end - start);
  }

  const best = Math.min(...runs);
  const avg = runs.reduce((a, b) => a + b, 0) / runs.length;

  return { best, avg, output: last };
}

function rmse(a, b) {
  if (a.length !== b.length) {
    throw new Error(`Array length mismatch: ${a.length} vs ${b.length}`);
  }

  let n = 0;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (Number.isNaN(x) || Number.isNaN(y)) continue;
    const d = x - y;
    sum += d * d;
    n++;
  }

  return n > 0 ? Math.sqrt(sum / n) : Number.NaN;
}

function fmt(ms) {
  return `${ms.toFixed(2)} ms`;
}

function main() {
  const sampleCount = Number(process.env.BENCH_SAMPLES ?? 1200);
  const resolution = Number(process.env.BENCH_RESOLUTION ?? 8);
  const sigma = Number(process.env.BENCH_SIGMA ?? 1.0);
  const numIter = Number(process.env.BENCH_ITER ?? 4);
  const reps = Number(process.env.BENCH_REPS ?? 3);

  const step = 1 / resolution;
  const x0 = [-26 + step, 34.5];
  const size = [Math.floor(75 / step), Math.floor(37.5 / step)];

  const bounds = [x0[0], x0[0] + size[0] * step, x0[1], x0[1] + size[1] * step];
  const { points, values } = createSyntheticDataset(sampleCount, bounds);

  console.log("Fast Barnes TS benchmark");
  console.log("------------------------");
  console.log(`samples:    ${sampleCount}`);
  console.log(`resolution: ${resolution}`);
  console.log(`grid size:  ${size[0]} x ${size[1]}`);
  console.log(`sigma:      ${sigma}`);
  console.log(`numIter:    ${numIter}`);
  console.log(`repetitions:${reps}`);
  console.log("");

  const naiveRes = runTimed(reps, () =>
    barnes(points, values, sigma, x0, step, size, { method: "naive" }),
  );

  const convRes = runTimed(reps, () =>
    barnes(points, values, sigma, x0, step, size, {
      method: "convolution",
      numIter,
      maxDist: 3.5,
    }),
  );

  const optRes = runTimed(reps, () =>
    barnes(points, values, sigma, x0, step, size, {
      method: "optimized_convolution",
      numIter,
      maxDist: 3.5,
    }),
  );

  const rmseConv = rmse(convRes.output.data, naiveRes.output.data);
  const rmseOpt = rmse(optRes.output.data, naiveRes.output.data);

  console.log("Timings (best / avg)");
  console.log(`naive:                 ${fmt(naiveRes.best)} / ${fmt(naiveRes.avg)}`);
  console.log(`convolution:           ${fmt(convRes.best)} / ${fmt(convRes.avg)}`);
  console.log(`optimized_convolution: ${fmt(optRes.best)} / ${fmt(optRes.avg)}`);
  console.log("");

  console.log("Accuracy vs naive (RMSE)");
  console.log(`convolution:           ${rmseConv.toFixed(6)}`);
  console.log(`optimized_convolution: ${rmseOpt.toFixed(6)}`);
  console.log("");

  console.log("Speed-up vs naive (best time)");
  console.log(`convolution:           x${(naiveRes.best / convRes.best).toFixed(1)}`);
  console.log(`optimized_convolution: x${(naiveRes.best / optRes.best).toFixed(1)}`);
}

main();
