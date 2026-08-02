import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/// A local static server for the prototype pages, so they can read `config/` the way the finished
/// site will read its API. Serves the repository, read-only, on localhost only.
///
/// It is a development tool. It has no upload, no write path, and no way to reach anything outside
/// the repository directory.

const directory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(directory, "..");
const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT || 4181);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${HOST}:${PORT}`);
  let path = decodeURIComponent(url.pathname);
  // Redirect rather than serve the page at "/", so the page's relative imports resolve against its
  // own directory. Serving it in place made `./app.js` resolve to the repository root and 404.
  if (path === "/") {
    response.writeHead(302, { location: "/web/launch-flow/" }).end();
    return;
  }
  if (path.endsWith("/")) path += "index.html";

  // Contain every request inside the repository, whatever the path contains.
  const target = resolve(projectRoot, `.${normalize(path)}`);
  if (target !== projectRoot && !target.startsWith(projectRoot + sep)) {
    response.writeHead(403).end("outside the repository");
    return;
  }

  try {
    if (!(await stat(target)).isFile()) throw new Error("not a file");
    const body = await readFile(target);
    response.writeHead(200, {
      "content-type": TYPES[extname(target)] ?? "application/octet-stream",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    response.end(body);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("not found");
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Prototype server: http://${HOST}:${PORT}/`);
  console.log("Read-only, localhost only. Ctrl+C to stop.");
});
