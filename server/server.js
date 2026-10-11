import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { match, authorize, sweep } from "./api.js";
import { HttpError } from "./util.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || 3000);
const TRUST_PROXY = process.env.TRUST_PROXY !== "0";

// 정적으로 내보내는 파일은 이 목록뿐이다 (server/ 와 data/ 는 절대 노출되지 않는다)
const STATIC = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/online.js": ["online.js", "text/javascript; charset=utf-8"],
  "/admin": ["admin.html", "text/html; charset=utf-8"],
  "/admin.html": ["admin.html", "text/html; charset=utf-8"],
};
const HEAD = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
};

function readBody(req, max) {
  return new Promise((resolve, reject) => {
    let n = 0; const parts = [];
    req.on("data", (c) => { n += c.length; if (n > max) { reject(new HttpError(413, "요청이 너무 큽니다.")); req.destroy(); } else parts.push(c); });
    req.on("end", () => {
      if (!n) return resolve({});
      try { const j = JSON.parse(Buffer.concat(parts).toString("utf8")); resolve(j && typeof j === "object" ? j : {}); }
      catch { reject(new HttpError(400, "JSON 형식이 올바르지 않습니다.")); }
    });
    req.on("error", reject);
  });
}
function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { ...HEAD, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(body);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    if (url.pathname.startsWith("/api/")) {
      const r = match(req.method, url.pathname);
      if (!r) throw new HttpError(404, "없는 주소입니다.");
      const user = authorize(r, req);
      const body = req.method === "GET" ? {} : await readBody(req, r.maxBody || 64_000);
      const ip = (TRUST_PROXY && String(req.headers["x-forwarded-for"] || "").split(",")[0].trim()) || req.socket.remoteAddress || "";
      return send(res, 200, await r.fn({ req, user, body, ip, url }));
    }
    if (url.pathname === "/favicon.ico") { res.writeHead(204, HEAD); return res.end(); }
    const f = STATIC[url.pathname];
    if (f && (req.method === "GET" || req.method === "HEAD")) {
      const data = await readFile(join(ROOT, f[0]));
      res.writeHead(200, { ...HEAD, "Content-Type": f[1], "Cache-Control": "no-cache" });
      return res.end(req.method === "HEAD" ? undefined : data);
    }
    res.writeHead(404, { ...HEAD, "Content-Type": "text/plain; charset=utf-8" });
    res.end("없는 페이지입니다.");
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, { error: e.message });
    console.error(e);
    send(res, 500, { error: "서버 오류가 났습니다." });
  }
});
server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
server.listen(PORT, () => console.log("표류여행 서버 :" + PORT));

sweep();
setInterval(sweep, 5 * 60_000).unref();
process.on("SIGTERM", () => server.close(() => process.exit(0)));
