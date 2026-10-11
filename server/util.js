import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export class HttpError extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}
export const bad = (msg = "잘못된 요청입니다.") => new HttpError(400, msg);
export const now = () => Date.now();

export const sha256 = (s) => createHash("sha256").update(s).digest("hex");
export const newToken = () => randomBytes(32).toString("hex");

export function hashPassword(pw, salt = randomBytes(16).toString("hex")) {
  const hash = scryptSync(pw, salt, 32, { N: 16384, r: 8, p: 1 }).toString("hex");
  return { salt, hash };
}
export function checkPassword(pw, salt, hash) {
  const a = Buffer.from(scryptSync(pw, salt, 32, { N: 16384, r: 8, p: 1 }));
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
export function safeEq(a, b) {
  const x = createHash("sha256").update(String(a)).digest();
  const y = createHash("sha256").update(String(b)).digest();
  return timingSafeEqual(x, y);
}

// 헷갈리는 글자(0 O 1 I L)를 뺀 초대 코드: XXXX-XXXX-XXXX
const ALPHA = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function newInviteCode() {
  const b = randomBytes(12);
  let s = "";
  for (let i = 0; i < 12; i++) s += ALPHA[b[i] % ALPHA.length];
  return s.match(/.{4}/g).join("-");
}
export const normCode = (c) => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/(.{4})(?=.)/g, "$1-");

// 제어문자·꺾쇠 제거 후 자르기 (화면에 넣을 땐 클라이언트가 또 escape 한다)
export const cleanStr = (v, max = 120) =>
  String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, max);
export const cleanName = (v) =>
  String(v == null ? "" : v).replace(/[^가-힣ㄱ-ㅎㅏ-ㅣA-Za-z0-9 _.\-·]/g, "").replace(/\s+/g, " ").trim().slice(0, 12) || "무명";
export const validUser = (u) => /^[A-Za-z0-9_가-힣]{3,16}$/.test(u);
export const num = (v, lo, hi, d = 0) => (typeof v === "number" && isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);

// 아주 단순한 메모리 속도 제한 (서버가 하나라서 충분하다)
const buckets = new Map();
export function limit(key, max, windowMs) {
  const t = Date.now();
  let b = buckets.get(key);
  if (!b || b[1] <= t) { b = [0, t + windowMs]; buckets.set(key, b); }
  if (++b[0] > max) throw new HttpError(429, "너무 자주 요청했습니다. 잠시 후 다시 시도하세요.");
}
setInterval(() => { const t = Date.now(); for (const [k, b] of buckets) if (b[1] <= t) buckets.delete(k); }, 60_000).unref();

// 세계는 가로 60, 세로 42 로 이어져 있다 (클라이언트 WW, WH 와 같아야 한다)
export const WW = 60, WH = 42;
const dl = (a, m) => ((a + m / 2) % m + m) % m - m / 2;
export const dist = (ax, ay, bx, by) => Math.hypot(dl(ax - bx, WW), dl(ay - by, WH));
