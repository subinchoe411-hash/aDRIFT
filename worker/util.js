// Cloudflare Workers 용 도우미 (WebCrypto 사용, Node 전용 모듈 없음)
export class HttpError extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}
export const bad = (msg = "잘못된 요청입니다.") => new HttpError(400, msg);
export const now = () => Date.now();

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");
const unhex = (h) => Uint8Array.from(h.match(/../g) || [], (x) => parseInt(x, 16));
export const randHex = (n) => { const b = new Uint8Array(n); crypto.getRandomValues(b); return hex(b); };
export const sha256 = async (s) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
export const newToken = () => randHex(32);

// 상수 시간 비교 (둘 다 해시한 뒤 바이트를 끝까지 비교)
export async function safeEq(a, b) {
  const x = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(String(a))));
  const y = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(String(b))));
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

// 비밀번호: PBKDF2-SHA256. 무료 플랜은 요청당 CPU 시간이 짧아 반복 횟수를 환경변수로 조절한다.
// 저장 형식은 "반복횟수$해시" 라서 나중에 횟수를 바꿔도 기존 계정은 그대로 로그인된다.
async function pbkdf2(pw, saltHex, iter) {
  const key = await crypto.subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: unhex(saltHex), iterations: iter }, key, 256));
}
export async function hashPassword(pw, iter, salt = randHex(16)) {
  return { salt, hash: iter + "$" + (await pbkdf2(pw, salt, iter)) };
}
export async function checkPassword(pw, salt, stored) {
  const [it, h] = String(stored).split("$");
  const iter = Math.max(1000, Math.min(100000, parseInt(it, 10) || 0));
  return safeEq(await pbkdf2(pw, salt, iter), h || "");
}

const ALPHA = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";   // 헷갈리는 글자(0 O 1 I L) 제외
export function newInviteCode() {
  const b = new Uint8Array(12); crypto.getRandomValues(b);
  let s = ""; for (let i = 0; i < 12; i++) s += ALPHA[b[i] % ALPHA.length];
  return s.match(/.{4}/g).join("-");
}
export const normCode = (c) => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/(.{4})(?=.)/g, "$1-");

export const cleanStr = (v, max = 120) =>
  String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, max);
export const cleanName = (v) =>
  String(v == null ? "" : v).replace(/[^가-힣ㄱ-ㅎㅏ-ㅣA-Za-z0-9 _.\-·]/g, "").replace(/\s+/g, " ").trim().slice(0, 12) || "무명";
export const validUser = (u) => /^[A-Za-z0-9_가-힣]{3,16}$/.test(u);
export const num = (v, lo, hi, d = 0) => (typeof v === "number" && isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);

// 세계는 가로 60, 세로 42 로 이어져 있다 (클라이언트 WW, WH 와 같아야 한다)
export const WW = 60, WH = 42;
const dl = (a, m) => ((a + m / 2) % m + m) % m - m / 2;
export const dist = (ax, ay, bx, by) => Math.hypot(dl(ax - bx, WW), dl(ay - by, WH));
