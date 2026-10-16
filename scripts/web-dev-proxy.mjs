#!/usr/bin/env node
// Local stand-in for production hosting of the browser apps (plain Node, no deps):
//
//   /app/store/…  → dist-web/store   (SPA: unknown paths fall back to its index.html)
//   /app/check/…  → dist-web/check
//   everything else (/api/*, /j/*, /downloads*, /cases/*, /login, /_next/*, …)
//                 → the SwapUp dev server, headers and cookies untouched
//
// so the web apps are SAME-ORIGIN with the API, exactly as on the server.
//
//   bash scripts/export-web.sh all          # build both
//   node scripts/web-dev-proxy.mjs          # http://localhost:4620/app/store/  ·  /app/check/
//
// Env: PORT (4620), UPSTREAM (http://localhost:4500), DIST (<repo>/dist-web), QUIET=1.
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || 4620);
const UPSTREAM = new URL(process.env.UPSTREAM || "http://localhost:4500");
const DIST = path.resolve(process.env.DIST || path.join(ROOT, "dist-web"));
const QUIET = process.env.QUIET === "1";
const APPS = ["store", "check"];

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wasm": "application/wasm",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function log(req, status, t0, note = "") {
  if (QUIET) return;
  console.log(`${new Date().toISOString().slice(11, 19)} ${req.method} ${req.url} → ${status} ${Date.now() - t0}ms${note ? " " + note : ""}`);
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", ...headers });
  res.end(body);
}

/** Serve one of the two web apps. `rest` is the path after /app/<app>/ (no leading slash). */
function serveApp(req, res, app, rest, t0) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    send(res, 405, "Method not allowed", { allow: "GET, HEAD" });
    return log(req, 405, t0);
  }
  const appRoot = path.join(DIST, app);
  const index = path.join(appRoot, "index.html");
  if (!fs.existsSync(index)) {
    send(res, 503, `dist-web/${app} has not been built. Run: bash scripts/export-web.sh ${app}\n`);
    return log(req, 503, t0, "(not built)");
  }
  let rel;
  try {
    rel = decodeURIComponent(rest);
  } catch {
    send(res, 400, "Bad path");
    return log(req, 400, t0);
  }
  const file = path.normalize(path.join(appRoot, rel));
  if (file !== appRoot && !file.startsWith(appRoot + path.sep)) {
    send(res, 403, "Forbidden");
    return log(req, 403, t0);
  }
  let target = null;
  try {
    if (rel && fs.statSync(file).isFile()) target = file;
  } catch {
    /* not a file → maybe SPA fallback */
  }
  if (!target) {
    // A missing bundle/asset must 404 — handing the browser index.html for a
    // .js file turns a clear 404 into a confusing syntax error.
    if (/^(_expo|assets)\//.test(rel) || /\.(js|mjs|css|map|wasm|png|jpe?g|svg|ico|wav|mp3|json|woff2?|ttf)$/i.test(rel)) {
      send(res, 404, "Not found");
      return log(req, 404, t0);
    }
    target = index; // /app/check/, /app/check/?code=…, /app/check/anything
  }
  const ext = path.extname(target).toLowerCase();
  const immutable = target.includes(`${path.sep}_expo${path.sep}`) || target.includes(`${path.sep}assets${path.sep}`);
  const stat = fs.statSync(target);
  res.writeHead(200, {
    "content-type": TYPES[ext] || "application/octet-stream",
    "content-length": stat.size,
    // Bundles are content-hashed; index.html and version.json must always be fresh.
    "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
    "x-content-type-options": "nosniff",
  });
  if (req.method === "HEAD") {
    res.end();
    return log(req, 200, t0);
  }
  fs.createReadStream(target).pipe(res);
  log(req, 200, t0, target === index && rel !== "index.html" ? "(index.html)" : "");
}

/** Everything that isn't a web app goes to the SwapUp server untouched. */
function proxy(req, res, t0) {
  const headers = { ...req.headers };
  // Keep Host = this proxy (like Caddy's reverse_proxy does), and say so in the
  // forwarded headers, so links and cookies the server makes are for this origin.
  headers["x-forwarded-host"] = req.headers.host || `localhost:${PORT}`;
  headers["x-forwarded-proto"] = "http";
  headers["x-forwarded-for"] = [req.headers["x-forwarded-for"], req.socket.remoteAddress].filter(Boolean).join(", ");
  const up = http.request(
    { protocol: UPSTREAM.protocol, hostname: UPSTREAM.hostname, port: UPSTREAM.port || 80, method: req.method, path: req.url, headers },
    (ur) => {
      const out = { ...ur.headers };
      // An absolute redirect to the upstream origin → keep the browser on this origin.
      if (typeof out.location === "string" && out.location.startsWith(UPSTREAM.origin)) {
        out.location = out.location.slice(UPSTREAM.origin.length) || "/";
      }
      res.writeHead(ur.statusCode || 502, out);
      ur.pipe(res);
      ur.on("end", () => log(req, ur.statusCode, t0, "(proxied)"));
    }
  );
  up.on("error", (e) => {
    if (!res.headersSent) send(res, 502, `Can't reach the SwapUp server at ${UPSTREAM.origin} (${e.code || e.message}). Is \`npm run dev\` running there?\n`);
    else res.destroy();
    log(req, 502, t0, `(${e.code || e.message})`);
  });
  req.pipe(up);
}

const server = http.createServer((req, res) => {
  const t0 = Date.now();
  const url = req.url || "/";
  const q = url.indexOf("?");
  const pathname = q < 0 ? url : url.slice(0, q);
  const search = q < 0 ? "" : url.slice(q);
  for (const app of APPS) {
    const base = `/app/${app}`;
    if (pathname === base) {
      res.writeHead(308, { location: `${base}/${search}`, "cache-control": "no-store" });
      res.end();
      return log(req, 308, t0);
    }
    if (pathname.startsWith(base + "/")) return serveApp(req, res, app, pathname.slice(base.length + 1), t0);
  }
  proxy(req, res, t0);
});

// WebSockets (the dev server's hot reload) — pipe the raw sockets through.
server.on("upgrade", (req, socket, head) => {
  const up = net.connect(Number(UPSTREAM.port || 80), UPSTREAM.hostname, () => {
    const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
    up.write(lines.join("\r\n") + "\r\n\r\n");
    if (head && head.length) up.write(head);
    socket.pipe(up).pipe(socket);
  });
  up.on("error", () => socket.destroy());
  socket.on("error", () => up.destroy());
});

server.listen(PORT, () => {
  console.log(`SwapUp web apps on http://localhost:${PORT}`);
  for (const app of APPS) {
    const built = fs.existsSync(path.join(DIST, app, "index.html"));
    console.log(`  /app/${app}/  ← ${path.join(DIST, app)}${built ? "" : "  (NOT BUILT — bash scripts/export-web.sh " + app + ")"}`);
  }
  console.log(`  everything else → ${UPSTREAM.origin}`);
});
