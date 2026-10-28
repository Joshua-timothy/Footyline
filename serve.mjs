#!/usr/bin/env node
/**
 * Tiny static server for Footyline with single-page-app fallback.
 *   node serve.mjs [port]
 * Serves the current directory; unknown paths fall back to index.html so
 * /match/..., /league/... and /team/... deep links work locally.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.argv[2] || process.env.PORT || 4185);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.endsWith("/")) pathname += "index.html";

  const resolved = path.join(root, path.normalize(pathname).replace(/^([/\\])+/, ""));
  if (!resolved.startsWith(root)) {
    response.writeHead(403).end("Forbidden");
    return;
  }

  const send = (file, status = 200) => {
    fs.readFile(file, (error, buffer) => {
      if (error) {
        response.writeHead(404, { "content-type": "text/plain" }).end("Not found");
        return;
      }
      response.writeHead(status, {
        "content-type": TYPES[path.extname(file)] || "application/octet-stream",
        "cache-control": "no-cache",
      });
      response.end(buffer);
    });
  };

  if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
    send(resolved);
    return;
  }
  if (path.extname(resolved)) {
    response.writeHead(404, { "content-type": "text/plain" }).end("Not found");
    return;
  }
  send(path.join(root, "index.html"));
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Footyline running at http://127.0.0.1:${port}`);
});
