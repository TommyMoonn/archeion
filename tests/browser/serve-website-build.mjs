import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const root = path.resolve("website/build");
const base = "/archeion/";
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8",
};

// A filesystem host, with the project site's custom 404 and no SPA fallback.
// This exercises the artifact locally; it is not evidence of a live Pages deploy.
http
  .createServer((request, response) => {
    const url = new URL(request.url, "http://localhost");
    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      response.writeHead(400).end();
      return;
    }
    const file = path.resolve(root, pathname.slice(base.length));
    if (!pathname.startsWith(base) || (!file.startsWith(`${root}${path.sep}`) && file !== root)) {
      response.writeHead(404).end();
      return;
    }
    let target = file;
    if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
      if (!pathname.endsWith("/")) {
        response.writeHead(301, { Location: `${url.pathname}/${url.search}` }).end();
        return;
      }
      target = path.join(target, "index.html");
    }
    const found = fs.existsSync(target) && fs.statSync(target).isFile();
    if (!found) target = path.join(root, "404.html");
    response.writeHead(found ? 200 : 404, {
      "Content-Type": types[path.extname(target)] ?? "application/octet-stream",
    });
    fs.createReadStream(target).pipe(response);
  })
  .listen(4192, "127.0.0.1");
