import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  outExtensions: ({ format }) => {
    if (format === "es") {
      return { js: ".js", dts: ".d.ts" };
    }

    return { js: ".cjs" };
  },
  sourcemap: true,
  clean: true,
  minify: false,
  treeshake: true,
  deps: {
    alwaysBundle: ["d3-contour"],
  },
  target: false,
});
