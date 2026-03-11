import { createServer } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const port = Number(process.env.PORT ?? 4173);

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".geojson": "application/geo+json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function safeResolve(urlPath) {
  const rawPath = decodeURIComponent((urlPath || "/").split("?")[0]);

  let cleaned = rawPath;
  if (cleaned === "/" || cleaned === "") {
    cleaned = "/examples/maplibre-viewer.html";
  }

  if (cleaned.length > 1 && cleaned.endsWith("/")) {
    cleaned = cleaned.slice(0, -1);
  }

  const relative = cleaned.startsWith("/") ? cleaned.slice(1) : cleaned;
  const candidate = path.resolve(rootDir, relative);
  if (!candidate.startsWith(rootDir)) return null;
  return candidate;
}

const server = createServer(async (req, res) => {
  try {
    const filePath = safeResolve(req.url || "/");
    if (!filePath) {
      res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      res.end("Bad request");
      return;
    }

    let finalPath = filePath;
    let stat = await fs.stat(finalPath).catch(() => null);

    if (stat && stat.isDirectory()) {
      finalPath = path.join(finalPath, "index.html");
      stat = await fs.stat(finalPath).catch(() => null);
    }

    if (!stat || !stat.isFile()) {
      const fallback = path.join(rootDir, "examples", "maplibre-viewer.html");
      const wantsHtml = (req.url || "").includes(".html") || (req.url || "/") === "/";

      if (wantsHtml) {
        const fbStat = await fs.stat(fallback).catch(() => null);
        if (fbStat && fbStat.isFile()) {
          const data = await fs.readFile(fallback);
          res.writeHead(200, {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-cache",
          });
          res.end(data);
          return;
        }
      }

      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    const ext = path.extname(finalPath).toLowerCase();
    const contentType = mime[ext] || "application/octet-stream";
    const data = await fs.readFile(finalPath);

    res.writeHead(200, {
      "content-type": contentType,
      "cache-control": "no-cache",
    });
    res.end(data);
  } catch (err) {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end(String(err?.message || err));
  }
});

server.listen(port, () => {
  console.log(`Serving ${rootDir}`);
  console.log(`Open http://localhost:${port}/examples/maplibre-viewer.html`);
});
