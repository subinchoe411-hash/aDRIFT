// Cloudflare Worker 진입점. /api/* 만 여기서 처리하고, 화면 파일은 Workers Static Assets 가 내보낸다.
import { handleApi, sweep } from "./api.js";
import { HttpError } from "./util.js";

const HEAD = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Strict-Transport-Security": "max-age=31536000",
};
const out = (status, obj) => new Response(JSON.stringify(obj), { status, headers: HEAD });

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS ? env.ASSETS.fetch(req) : new Response("Not found", { status: 404 });
    try {
      // Cloudflare 가 직접 넣어 주는 값이라 접속자가 위조할 수 없다
      const ip = req.headers.get("cf-connecting-ip") || "";
      return out(200, await handleApi(req, env, ip));
    } catch (e) {
      if (e instanceof HttpError) return out(e.status, { error: e.message });
      console.error(e);
      return out(500, { error: "서버 오류가 났습니다." });
    }
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(sweep(env).catch((e) => console.error("sweep:", e)));
  },
};
