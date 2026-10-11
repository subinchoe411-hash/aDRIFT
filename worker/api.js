import { SCHEMA } from "./schema.js";
import {
  HttpError, bad, now, sha256, newToken, hashPassword, checkPassword, safeEq, newInviteCode,
  normCode, cleanStr, cleanName, validUser, num, dist, randHex,
} from "./util.js";

const DAY = 86_400_000;
const SESSION_TTL = 30 * DAY;
const FRESH = 60_000;          // 이 시간 안에 신호가 있어야 '바다에 있는' 배
const MAX_CREW = 4;
const encR = (env) => Number(env.ENCOUNTER_RADIUS || 2.5);   // 마주침 거리 (세계 좌표 단위)

/* ---------- D1 도우미 ---------- */
const P = (env, sql, ...b) => env.DB.prepare(sql).bind(...b);
const all = async (env, sql, ...b) => (await P(env, sql, ...b).all()).results || [];
const first = async (env, sql, ...b) => (await all(env, sql, ...b))[0] || null;
const run = (env, sql, ...b) => P(env, sql, ...b).run();
const changes = (r) => (r && r.meta && r.meta.changes) || 0;
const json = (s, d = {}) => { try { return JSON.parse(s); } catch { return d; } };
const dlv = (env, uid, kind, payload) => P(env, "INSERT INTO deliveries(user_id,kind,payload,created) VALUES(?,?,?,?)", uid, kind, JSON.stringify(payload), now());

let ready = null;
async function ensureSchema(env) {
  if (!ready) ready = (async () => {
    try { await env.DB.prepare("SELECT 1 FROM rl LIMIT 1").first(); return; } catch { /* 처음이면 테이블이 없다 */ }
    await env.DB.batch(SCHEMA.map((s) => env.DB.prepare(s)));
  })().catch((e) => { ready = null; throw e; });
  return ready;
}

// 속도 제한 (D1 카운터). 자주 부르는 sync/claim 에는 걸지 않는다.
async function limit(env, key, max, windowMs) {
  const t = now();
  const r = await first(env,
    `INSERT INTO rl(k,r,n) VALUES(?1,?2,1) ON CONFLICT(k) DO UPDATE SET
       n=CASE WHEN r<=?3 THEN 1 ELSE n+1 END, r=CASE WHEN r<=?3 THEN ?2 ELSE r END RETURNING n`, key, t + windowMs, t);
  if (r && r.n > max) throw new HttpError(429, "너무 자주 요청했습니다. 잠시 후 다시 시도하세요.");
}

/* ---------- 인증 ---------- */
async function authUser(env, req) {
  const h = req.headers.get("authorization") || "";
  const tok = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  if (!/^[a-f0-9]{64}$/.test(tok)) throw new HttpError(401, "로그인이 필요합니다.");
  const key = await sha256(tok), t = now();
  const r = await first(env, "SELECT s.user_id,s.seen,u.username FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.seen>?", key, t - SESSION_TTL);
  if (!r) throw new HttpError(401, "로그인이 만료되었습니다.");
  if (t - r.seen > 600_000) await run(env, "UPDATE sessions SET seen=? WHERE token=?", t, key);
  return { id: r.user_id, username: r.username, key };
}
async function issueSession(env, uid) {
  const tok = newToken();
  await run(env, "INSERT INTO sessions(token,user_id,created,seen) VALUES(?,?,?,?)", await sha256(tok), uid, now(), now());
  return tok;
}
const iters = (env) => Math.max(1000, Math.min(100000, Number(env.PBKDF_ITER || 20000)));

/* ---------- 가까이 있는가 ---------- */
async function nearCheck(env, meId, otherId) {
  const rows = await all(env, "SELECT * FROM presence WHERE user_id IN (?,?)", meId, otherId);
  const a = rows.find((r) => r.user_id === meId), b = rows.find((r) => r.user_id === otherId), t = now();
  if (!a || !b || t - a.updated > FRESH || t - b.updated > FRESH) return false;
  if (a.loc === "sea" && b.loc === "sea") return dist(a.x, a.y, b.x, b.y) <= encR(env) + 0.5;
  if (a.loc === "port" && b.loc === "port") return a.isl >= 0 && a.isl === b.isl;
  return false;
}
const needNear = async (env, a, b) => { if (!(await nearCheck(env, a, b))) throw bad("그 배는 이제 가까이에 없습니다."); };

/* ---------- 거래 내용 검증 ---------- */
function cleanBundle(b, label) {
  const out = { gold: 0, items: {} };
  if (b == null) return out;
  if (typeof b !== "object") throw bad(label + " 형식이 올바르지 않습니다.");
  out.gold = Math.floor(num(b.gold, 0, 100000, 0));
  if (b.items && typeof b.items === "object") {
    const ent = Object.entries(b.items);
    if (ent.length > 5) throw bad("한 번에 품목 5개까지만 거래할 수 있습니다.");
    for (const [k, v] of ent) {
      if (!/^[가-힣A-Za-z0-9 ·'-]{1,16}$/.test(k)) throw bad("품목 이름이 올바르지 않습니다.");
      const n = Math.floor(num(v, 0, 99, 0));
      if (n > 0) out.items[k] = n;
    }
  }
  return out;
}
const isEmpty = (b) => !b.gold && !Object.keys(b.items).length;

/* ---------- 선원 일 ---------- */
const OPEN = ["멸치", "고등어", "오징어", "참치", "가다랑어", "연어", "갈치"];
const COAST = ["조개", "새우", "게", "도미", "광어", "전복", "문어"];
const rpick = (a) => a[Math.floor(Math.random() * a.length)];
const DUTIES = {
  fish:    { name: "낚시",     cd: 75_000,  wage: 6 },
  cook:    { name: "식사 준비", cd: 120_000, wage: 5 },
  lookout: { name: "망보기",   cd: 120_000, wage: 6 },
  repair:  { name: "선체 수리", cd: 150_000, wage: 5 },
};
const RANKS = [[0, "견습 선원"], [20, "갑판원"], [60, "숙련 선원"], [150, "갑판장"]];
const rankOf = (xp) => RANKS.filter(([m]) => xp >= m).pop()[1];
const DAILY_CAP = 200;
const dayKey = () => new Date().toISOString().slice(0, 10);

async function doDuty(env, u, duty) {
  const d = DUTIES[duty];
  if (!d) throw bad("알 수 없는 일입니다.");
  const c = await first(env, "SELECT * FROM crew WHERE member_id=?", u.id);
  if (!c) throw bad("탑승한 배가 없습니다.");
  const t = now();
  const pend = await first(env, "SELECT COUNT(*) n FROM deliveries WHERE user_id=? AND claimed IS NULL AND kind='crew_work'", c.captain_id);
  if (pend.n >= 15) throw bad("선장이 한동안 자리를 비워 일이 쌓여 있습니다. 조금 쉬세요.");
  // 쿨다운 확인과 갱신을 한 문장으로 (동시에 두 번 눌러도 한 번만 통과)
  const cdr = await run(env,
    `INSERT INTO crew_cd(member_id,duty,ready) VALUES(?1,?2,?3) ON CONFLICT(member_id,duty) DO UPDATE SET ready=excluded.ready WHERE crew_cd.ready<=?4`,
    u.id, duty, t + d.cd, t);
  if (changes(cdr) !== 1) throw bad("아직 손이 비지 않았습니다.");
  const cap = await first(env, "SELECT loc FROM presence WHERE user_id=?", c.captain_id);
  const coast = cap && cap.loc === "port";
  let work, msg;
  if (duty === "fish") {
    const n = 1 + Math.floor(Math.random() * 3), items = {};
    for (let i = 0; i < n; i++) { const k = rpick(coast ? COAST : OPEN); items[k] = (items[k] || 0) + 1; }
    work = { items }; msg = Object.entries(items).map(([k, v]) => k + " " + v).join(", ") + "을(를) 낚아 올렸다.";
  } else if (duty === "cook") {
    const f = 8 + Math.floor(Math.random() * 8);
    work = { fx: "f:" + f }; msg = "따뜻한 한 끼를 차려 선장의 허기를 달랬다. (허기 +" + f + ")";
  } else if (duty === "lookout") {
    work = { fx: Math.random() < 0.6 ? "s:1" : "q:1" }; msg = "돛대 위에서 수평선을 샅샅이 살폈다.";
  } else {
    const h = 3 + Math.floor(Math.random() * 4);
    work = { fx: "h:-" + h }; msg = "갑판의 구멍을 메우고 선체를 손봤다. (선체 +" + h + ")";
  }
  await run(env, "INSERT OR IGNORE INTO crew_profile(user_id) VALUES(?)", u.id);
  const p = await first(env, "SELECT * FROM crew_profile WHERE user_id=?", u.id);
  const day = dayKey(), dayEarn = p.day === day ? p.day_earn : 0;
  const wage = Math.max(0, Math.min(d.wage, DAILY_CAP - dayEarn));
  work.by = u.username; work.duty = d.name; work.text = msg;
  await env.DB.batch([
    P(env, "UPDATE crew_profile SET purse=purse+?, xp=xp+1, tasks=tasks+1, day=?, day_earn=? WHERE user_id=?", wage, day, dayEarn + wage, u.id),
    dlv(env, c.captain_id, "crew_work", work),
  ]);
  return { msg, wage, ready: t + d.cd };
}

/* ---------- 라우터 ---------- */
const routes = new Map();
const route = (method, path, fn, opts = {}) => routes.set(method + " " + path, { fn, ...opts });

/* 계정 */
route("POST", "/api/register", async ({ env, body, ip }) => {
  await limit(env, "reg:" + ip, Number(env.REG_LIMIT || 8), 3_600_000);
  const code = normCode(body.code), username = String(body.username || "").trim(), pw = String(body.password || "");
  if (!validUser(username)) throw bad("아이디는 3~16자의 한글·영문·숫자·밑줄만 쓸 수 있습니다.");
  if (pw.length < 6 || pw.length > 72) throw bad("비밀번호는 6~72자로 정해 주세요.");
  const inv = await first(env, "SELECT * FROM invites WHERE code=?", code);
  if (!inv || inv.used_by || inv.expires <= now()) throw bad("사용할 수 없는 초대 코드입니다.");
  if (await first(env, "SELECT 1 x FROM users WHERE username=?", username)) throw bad("이미 있는 아이디입니다.");
  const { salt, hash } = await hashPassword(pw, iters(env));
  const t = now();
  let res;
  try {
    // 한 번의 트랜잭션: 코드가 아직 유효할 때만 계정을 만들고, 같은 묶음 안에서 코드를 사용 처리한다
    res = await env.DB.batch([
      P(env, `INSERT INTO users(username,salt,hash,invite,created)
              SELECT ?1,?2,?3,?4,?5 WHERE EXISTS(SELECT 1 FROM invites WHERE code=?4 AND used_by IS NULL AND expires>?5)`, username, salt, hash, code, t),
      P(env, "UPDATE invites SET used_by=(SELECT id FROM users WHERE username=?1), used_at=?2 WHERE code=?3 AND used_by IS NULL AND EXISTS(SELECT 1 FROM users WHERE username=?1)", username, t, code),
    ]);
  } catch { throw bad("이미 있는 아이디입니다."); }
  if (changes(res[0]) !== 1) throw bad("방금 다른 사람이 이 코드를 썼습니다.");
  const u = await first(env, "SELECT id FROM users WHERE username=?", username);
  return { token: await issueSession(env, u.id), user: { id: u.id, username } };
}, { anon: true });

route("POST", "/api/login", async ({ env, body, ip }) => {
  await limit(env, "login:" + ip, 20, 600_000);
  const username = String(body.username || "").trim(), pw = String(body.password || "");
  await limit(env, "loginu:" + username.toLowerCase(), 10, 600_000);
  const u = await first(env, "SELECT * FROM users WHERE username=?", username);
  // 존재 여부를 알려 주지 않도록 없는 계정도 같은 시간만큼 해시를 돌린다
  const ok = u ? await checkPassword(pw, u.salt, u.hash) : (await hashPassword(pw, iters(env)), false);
  if (!ok) throw new HttpError(401, "아이디 또는 비밀번호가 맞지 않습니다.");
  return { token: await issueSession(env, u.id), user: { id: u.id, username: u.username } };
}, { anon: true });

route("POST", "/api/logout", async ({ env, user }) => { await run(env, "DELETE FROM sessions WHERE token=?", user.key); return { ok: true }; });
route("GET", "/api/me", async ({ user }) => ({ user: { id: user.id, username: user.username } }));

/* 클라우드 저장 */
route("GET", "/api/save", async ({ env, user }) => {
  const r = await first(env, "SELECT data,updated FROM saves WHERE user_id=?", user.id);
  return r ? { data: r.data, updated: r.updated } : { data: null };
});
route("PUT", "/api/save", async ({ env, user, body }) => {
  await limit(env, "save:" + user.id, 12, 60_000);
  if (typeof body.data !== "string" || body.data.length > 1_200_000) throw bad("저장 데이터가 너무 큽니다.");
  await run(env, `INSERT INTO saves(user_id,data,updated) VALUES(?1,?2,?3) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data,updated=excluded.updated`, user.id, body.data, now());
  return { ok: true, updated: now() };
}, { maxBody: 1_500_000 });

/* 동기화: 내 위치를 알리고, 주변·채팅·우편·거래·선원 소식을 한 번에 받는다 (D1 왕복 2번) */
route("POST", "/api/sync", async ({ env, user, body }) => {
  const t = now(), m = body.me, R = encR(env);
  const stm = [];
  if (m && typeof m === "object") {
    const loc = ["sea", "port", "city"].includes(m.loc) ? m.loc : "sea";
    let snap = "{}";
    if (m.snap && typeof m.snap === "object") { snap = JSON.stringify(m.snap); if (snap.length > 2500) snap = "{}"; }
    stm.push(P(env, `INSERT INTO presence(user_id,name,ship,lv,x,y,hd,loc,isl,snap,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET name=excluded.name,ship=excluded.ship,lv=excluded.lv,x=excluded.x,y=excluded.y,
      hd=excluded.hd,loc=excluded.loc,isl=excluded.isl,snap=excluded.snap,updated=excluded.updated`,
      user.id, cleanName(m.name), cleanStr(m.ship, 16) || "조각배", Math.floor(num(m.lv, 0, 3)),
      num(m.x, 0, 60), num(m.y, 0, 42), num(m.hd, 0, 360), loc, Math.floor(num(m.isl, -1, 200, -1)), snap, t));
  }
  const o = stm.length;
  stm.push(
    P(env, "SELECT * FROM presence WHERE user_id=?", user.id),
    P(env, "SELECT * FROM crew WHERE member_id=?", user.id),
    P(env, "SELECT * FROM presence WHERE user_id<>? AND updated>? AND loc<>'city'", user.id, t - FRESH),
    P(env, "SELECT p.user_id id,p.name,u.username FROM presence p JOIN users u ON u.id=p.user_id WHERE p.updated>? AND p.user_id<>? ORDER BY p.updated DESC LIMIT 40", t - 5 * 60_000, user.id),
    P(env, "SELECT id,kind,payload,created FROM deliveries WHERE user_id=? AND claimed IS NULL ORDER BY id LIMIT 40", user.id),
    P(env, "SELECT t.*,u.username fromName FROM trades t JOIN users u ON u.id=t.from_id WHERE t.to_id=? AND t.status='open' AND t.expires>? ORDER BY t.id DESC LIMIT 10", user.id, t),
    P(env, "SELECT t.*,u.username toName FROM trades t JOIN users u ON u.id=t.to_id WHERE t.from_id=? AND t.status='open' AND t.expires>? ORDER BY t.id DESC LIMIT 10", user.id, t),
    P(env, "SELECT c.member_id id,u.username,p.updated seen FROM crew c JOIN users u ON u.id=c.member_id LEFT JOIN presence p ON p.user_id=c.member_id WHERE c.captain_id=?", user.id),
    P(env, "SELECT i.id,i.captain_id,u.username captainName,i.created FROM crew_invites i JOIN users u ON u.id=i.captain_id WHERE i.member_id=? AND i.status='open' AND i.created>? ORDER BY i.id DESC LIMIT 10", user.id, t - 3 * DAY),
    P(env, "SELECT i.id,i.member_id,u.username memberName FROM crew_invites i JOIN users u ON u.id=i.member_id WHERE i.captain_id=? AND i.status='open' AND i.created>? LIMIT 10", user.id, t - 3 * DAY),
    P(env, "SELECT * FROM crew_profile WHERE user_id=?", user.id),
  );
  const r1 = (await env.DB.batch(stm)).slice(o).map((x) => x.results || []);
  const [mineR, crewR, candR, rosterR, delivR, tinR, toutR, membersR, invInR, invOutR, profR] = r1;
  const mine = mineR[0], crewRow = crewR[0], p = profR[0];

  const nearby = [];
  if (mine && mine.loc !== "city") {
    for (const q of candR) {
      let d = null;
      if (mine.loc === "sea" && q.loc === "sea") { d = dist(mine.x, mine.y, q.x, q.y); if (d > R) continue; }
      else if (mine.loc === "port" && q.loc === "port" && mine.isl >= 0 && mine.isl === q.isl) d = 0;
      else continue;
      nearby.push({ id: q.user_id, name: q.name, ship: q.ship, lv: q.lv, x: q.x, y: q.y, hd: q.hd, loc: q.loc, d: Math.round(d * 10) / 10 });
    }
  }

  // 2차: 채팅(월드 + 내 배)과 선원 상세
  const myShip = crewRow ? crewRow.captain_id : user.id;
  const chans = ["world", "crew:" + myShip];
  const since = body.since && typeof body.since === "object" ? body.since : {};
  const stm2 = chans.map((ch) => typeof since[ch] === "number"
    ? P(env, "SELECT id,user_id uid,name,text,ts FROM chat WHERE channel=? AND id>? ORDER BY id LIMIT 60", ch, since[ch])
    : P(env, "SELECT * FROM (SELECT id,user_id uid,name,text,ts FROM chat WHERE channel=? ORDER BY id DESC LIMIT 30) ORDER BY id", ch));
  if (crewRow) stm2.push(
    P(env, "SELECT username FROM users WHERE id=?", crewRow.captain_id),
    P(env, "SELECT * FROM presence WHERE user_id=?", crewRow.captain_id),
    P(env, "SELECT u.username FROM crew c JOIN users u ON u.id=c.member_id WHERE c.captain_id=?", crewRow.captain_id),
    P(env, "SELECT duty,ready FROM crew_cd WHERE member_id=?", user.id));
  const r2 = (await env.DB.batch(stm2)).map((x) => x.results || []);
  const chat = {};
  chans.forEach((ch, i) => { chat[ch] = r2[i]; });

  const crew = { captainOf: [], memberOf: null, invitesIn: invInR, invitesOut: invOutR, me: null };
  crew.captainOf = membersR.map((r) => ({ id: r.id, name: r.username, online: !!(r.seen && t - r.seen < FRESH * 2) }));
  let cd = {};
  if (crewRow) {
    const k = chans.length, cp = r2[k + 1][0];
    cd = Object.fromEntries(r2[k + 3].map((r) => [r.duty, r.ready]));
    crew.memberOf = {
      captainId: crewRow.captain_id, captain: r2[k][0] && r2[k][0].username,
      shipmates: r2[k + 2].map((r) => r.username),
      ship: cp ? { name: cp.name, ship: cp.ship, lv: cp.lv, x: cp.x, y: cp.y, hd: cp.hd, loc: cp.loc, isl: cp.isl, online: t - cp.updated < FRESH * 2, snap: json(cp.snap), at: cp.updated } : null,
    };
  }
  if (p || crewRow) {
    const pp = p || { purse: 0, xp: 0, tasks: 0, day: "", day_earn: 0 };
    crew.me = { purse: pp.purse, xp: pp.xp, tasks: pp.tasks, rank: rankOf(pp.xp), cd, dayLeft: DAILY_CAP - (pp.day === dayKey() ? pp.day_earn : 0) };
  }

  return {
    now: t, nearby, chat, crew, radius: R, roster: rosterR,
    deliveries: delivR.map((d) => ({ ...d, payload: json(d.payload) })),
    trades: {
      incoming: tinR.map((r) => ({ id: r.id, from: r.from_id, name: r.fromName, give: json(r.give), want: json(r.want), expires: r.expires })),
      outgoing: toutR.map((r) => ({ id: r.id, to: r.to_id, name: r.toName, give: json(r.give), want: json(r.want), expires: r.expires })),
    },
  };
});

route("POST", "/api/claim", async ({ env, user, body }) => {
  const ids = (Array.isArray(body.ids) ? body.ids : []).filter(Number.isInteger).slice(0, 40);
  if (!ids.length) return { deliveries: [] };
  // 한 문장으로 '내 것이고 아직 안 가져간 것'만 표시하고 돌려받는다 (두 번 가져갈 수 없다)
  const rows = await all(env,
    `UPDATE deliveries SET claimed=? WHERE user_id=? AND claimed IS NULL AND id IN (${ids.map(() => "?").join(",")}) RETURNING id,kind,payload,created`,
    now(), user.id, ...ids);
  return { deliveries: rows.sort((a, b) => a.id - b.id).map((d) => ({ ...d, payload: json(d.payload) })) };
});

/* 인사 */
route("POST", "/api/greet", async ({ env, user, body }) => {
  const to = Math.floor(num(body.to, 1, 1e9, 0));
  await limit(env, `greet:${user.id}:${to}`, 3, 30_000);
  await limit(env, "greet:" + user.id, 20, 60_000);
  const text = cleanStr(body.text, 40);
  if (!text) throw bad("인사말이 비었습니다.");
  if (to === user.id || !(await first(env, "SELECT 1 x FROM users WHERE id=?", to))) throw bad("대상이 올바르지 않습니다.");
  await needNear(env, user.id, to);
  const me = await first(env, "SELECT name,ship FROM presence WHERE user_id=?", user.id);
  await dlv(env, to, "greet", { from: user.id, name: me.name, ship: me.ship, text }).run();
  return { ok: true };
});

/* 거래 */
route("POST", "/api/trade/offer", async ({ env, user, body }) => {
  await limit(env, "trade:" + user.id, 20, 60_000);
  const to = Math.floor(num(body.to, 1, 1e9, 0));
  if (to === user.id || !(await first(env, "SELECT 1 x FROM users WHERE id=?", to))) throw bad("대상이 올바르지 않습니다.");
  await needNear(env, user.id, to);
  const give = cleanBundle(body.give, "내놓을 것"), want = cleanBundle(body.want, "원하는 것");
  if (isEmpty(give) && isEmpty(want)) throw bad("거래할 내용이 없습니다.");
  const t = now();
  if ((await first(env, "SELECT COUNT(*) n FROM trades WHERE from_id=? AND status='open' AND expires>?", user.id, t)).n >= 3) throw bad("진행 중인 제안이 너무 많습니다.");
  if ((await first(env, "SELECT COUNT(*) n FROM trades WHERE from_id=? AND to_id=? AND status='open' AND expires>?", user.id, to, t)).n >= 1) throw bad("이미 그 사람에게 제안한 거래가 있습니다.");
  const r = await run(env, "INSERT INTO trades(from_id,to_id,give,want,status,created,expires) VALUES(?,?,?,?,'open',?,?)",
    user.id, to, JSON.stringify(give), JSON.stringify(want), t, t + 30 * 60_000);
  return { id: r.meta.last_row_id };
});
// 제안을 닫고 맡겨 둔 물건을 제안자에게 돌려보낸다 (한 트랜잭션)
async function closeTrade(env, id, status, why) {
  const res = await env.DB.batch([
    P(env, "INSERT INTO deliveries(user_id,kind,payload,created) SELECT from_id,'trade_refund',json_object('gain',json(give),'why',?1),?2 FROM trades WHERE id=?3 AND status='open'", why, now(), id),
    P(env, "UPDATE trades SET status=?1 WHERE id=?2 AND status='open'", status, id),
  ]);
  return changes(res[1]) === 1;
}
route("POST", "/api/trade/cancel", async ({ env, user, body }) => {
  const id = Math.floor(num(body.id, 1, 1e12, 0));
  const tr = await first(env, "SELECT * FROM trades WHERE id=?", id);
  if (!tr || tr.from_id !== user.id) throw bad("내 제안이 아닙니다.");
  if (!(await closeTrade(env, id, "cancelled", "제안을 거두었다"))) throw bad("이미 끝난 거래입니다.");
  return { ok: true };
});
route("POST", "/api/trade/decline", async ({ env, user, body }) => {
  const id = Math.floor(num(body.id, 1, 1e12, 0));
  const tr = await first(env, "SELECT * FROM trades WHERE id=?", id);
  if (!tr || tr.to_id !== user.id) throw bad("나에게 온 제안이 아닙니다.");
  if (!(await closeTrade(env, id, "declined", "상대가 제안을 거절했다"))) throw bad("이미 끝난 거래입니다.");
  return { ok: true };
});
route("POST", "/api/trade/accept", async ({ env, user, body }) => {
  await limit(env, "trade:" + user.id, 20, 60_000);
  const id = Math.floor(num(body.id, 1, 1e12, 0));
  const tr = await first(env, "SELECT * FROM trades WHERE id=?", id);
  if (!tr || tr.to_id !== user.id || tr.status !== "open" || tr.expires <= now()) throw bad("이미 끝났거나 만료된 거래입니다.");
  await needNear(env, user.id, tr.from_id);
  const names = await all(env, "SELECT user_id,name FROM presence WHERE user_id IN (?,?)", user.id, tr.from_id);
  const nameOf = (uid) => (names.find((n) => n.user_id === uid) || {}).name || "상대";
  const t = now();
  const empty = '{"gold":0,"items":{}}';
  // 같은 묶음 안에서 '아직 열려 있을 때만' 양쪽 우편을 넣고 닫는다. D1 은 한 번에 한 묶음씩 처리하므로 두 번 수락돼도 한 번만 성사된다.
  const res = await env.DB.batch([
    P(env, "INSERT INTO deliveries(user_id,kind,payload,created) SELECT to_id,'trade_done',json_object('gain',json(give),'cost',json(want),'with',?2),?3 FROM trades WHERE id=?1 AND status='open' AND to_id=?4 AND expires>?3", id, nameOf(tr.from_id), t, user.id),
    P(env, "INSERT INTO deliveries(user_id,kind,payload,created) SELECT from_id,'trade_done',json_object('gain',json(want),'cost',json(?2),'with',?3),?4 FROM trades WHERE id=?1 AND status='open' AND to_id=?5 AND expires>?4", id, empty, nameOf(user.id), t, user.id),
    P(env, "UPDATE trades SET status='done' WHERE id=?1 AND status='open' AND to_id=?2 AND expires>?3", id, user.id, t),
  ]);
  if (changes(res[2]) !== 1) throw bad("이미 끝났거나 만료된 거래입니다.");
  return { ok: true };
});

/* 병 편지 */
route("POST", "/api/bottle/send", async ({ env, user, body }) => {
  await limit(env, "bottle:" + user.id, 10, 3_600_000);
  const text = cleanStr(body.text, 60);
  if (!text) throw bad("편지가 비었습니다.");
  if ((await first(env, "SELECT COUNT(*) n FROM bottles WHERE author_id=? AND finder_id IS NULL AND reply_to IS NULL", user.id)).n >= 3) throw bad("바다에 띄운 병이 너무 많습니다.");
  const p = await first(env, "SELECT name FROM presence WHERE user_id=?", user.id);
  const r = await run(env, "INSERT INTO bottles(author_id,name,text,reply_to,created) VALUES(?,?,?,NULL,?)", user.id, p ? p.name : "무명", text, now());
  return { id: r.meta.last_row_id };
});
route("POST", "/api/bottle/find", async ({ env, user }) => {
  await limit(env, "find:" + user.id, 30, 3_600_000);
  // 한 문장으로 '남의 병 하나를 골라 내 것으로 표시'한다 (두 사람이 같은 병을 줍지 않는다)
  const b = await first(env,
    `UPDATE bottles SET finder_id=?1, found_at=?2 WHERE finder_id IS NULL AND id=(
       SELECT id FROM bottles WHERE finder_id IS NULL AND reply_to IS NULL AND author_id<>?1 ORDER BY RANDOM() LIMIT 1)
     RETURNING id,author_id,name,text,created`, user.id, now());
  if (!b) return { bottle: null };
  await dlv(env, b.author_id, "bottle_found", { text: b.text }).run();
  return { bottle: { id: b.id, from: b.name, text: b.text, at: b.created } };
});
route("POST", "/api/bottle/reply", async ({ env, user, body }) => {
  await limit(env, "reply:" + user.id, 10, 3_600_000);
  const b = await first(env, "SELECT * FROM bottles WHERE id=?", Math.floor(num(body.id, 1, 1e12, 0)));
  if (!b || b.finder_id !== user.id) throw bad("내가 주운 병이 아닙니다.");
  if ((await first(env, "SELECT COUNT(*) n FROM bottles WHERE reply_to=?", b.id)).n) throw bad("이미 답장을 보냈습니다.");
  const text = cleanStr(body.text, 60);
  if (!text) throw bad("답장이 비었습니다.");
  const p = await first(env, "SELECT name FROM presence WHERE user_id=?", user.id), name = p ? p.name : "무명";
  await env.DB.batch([
    P(env, "INSERT INTO bottles(author_id,name,text,reply_to,created) VALUES(?,?,?,?,?)", user.id, name, text, b.id, now()),
    dlv(env, b.author_id, "bottle_reply", { from: name, text, re: b.text }),
  ]);
  return { ok: true };
});

/* 채팅 */
route("POST", "/api/chat", async ({ env, user, body }) => {
  await limit(env, "chat:" + user.id, 25, 60_000);
  await limit(env, "chat1:" + user.id, 1, 1_000);
  const text = cleanStr(body.text, 80);
  if (!text) throw bad("내용이 비었습니다.");
  const ch = String(body.channel || "world");
  if (ch !== "world") {
    const m = /^crew:(\d+)$/.exec(ch);
    if (!m) throw bad("알 수 없는 채널입니다.");
    const cid = Number(m[1]);
    const row = await first(env, "SELECT captain_id FROM crew WHERE member_id=?", user.id);
    if (!(cid === user.id || (row && row.captain_id === cid))) throw new HttpError(403, "그 배의 채팅에 참여할 수 없습니다.");
  }
  const p = await first(env, "SELECT name FROM presence WHERE user_id=?", user.id);
  await run(env, "INSERT INTO chat(channel,user_id,name,text,ts) VALUES(?,?,?,?,?)", ch, user.id, p ? p.name : user.username, text, now());
  return { ok: true };
});

/* 선원 */
route("POST", "/api/crew/invite", async ({ env, user, body }) => {
  await limit(env, "cinv:" + user.id, 10, 60_000);
  const target = await first(env, "SELECT id FROM users WHERE username=?", String(body.username || "").trim());
  if (!target || target.id === user.id) throw bad("초대할 수 없는 아이디입니다.");
  if (await first(env, "SELECT 1 x FROM crew WHERE member_id=?", target.id)) throw bad("그 사람은 이미 다른 배에서 일하고 있습니다.");
  if ((await first(env, "SELECT COUNT(*) n FROM crew WHERE captain_id=?", user.id)).n >= MAX_CREW) throw bad(`선원은 최대 ${MAX_CREW}명까지입니다.`);
  if ((await first(env, "SELECT COUNT(*) n FROM crew_invites WHERE captain_id=? AND member_id=? AND status='open' AND created>?", user.id, target.id, now() - 3 * DAY)).n) throw bad("이미 초대했습니다.");
  await run(env, "INSERT INTO crew_invites(captain_id,member_id,created,status) VALUES(?,?,?, 'open')", user.id, target.id, now());
  return { ok: true };
});
route("POST", "/api/crew/respond", async ({ env, user, body }) => {
  const inv = await first(env, "SELECT * FROM crew_invites WHERE id=?", Math.floor(num(body.id, 1, 1e12, 0)));
  if (!inv || inv.member_id !== user.id || inv.status !== "open") throw bad("유효하지 않은 초대입니다.");
  if (!body.accept) { await run(env, "UPDATE crew_invites SET status='declined' WHERE id=? AND status='open'", inv.id); return { ok: true }; }
  if (await first(env, "SELECT 1 x FROM crew WHERE member_id=?", user.id)) throw bad("이미 다른 배에서 일하고 있습니다. 먼저 내려야 합니다.");
  const r = await run(env, "INSERT INTO crew(member_id,captain_id,joined) SELECT ?1,?2,?3 WHERE (SELECT COUNT(*) FROM crew WHERE captain_id=?2)<?4", user.id, inv.captain_id, now(), MAX_CREW);
  if (changes(r) !== 1) throw bad("그 배는 선원이 가득 찼습니다.");
  await env.DB.batch([
    P(env, "UPDATE crew_invites SET status='accepted' WHERE id=?", inv.id),
    P(env, "INSERT OR IGNORE INTO crew_profile(user_id) VALUES(?)", user.id),
  ]);
  return { ok: true };
});
route("POST", "/api/crew/cancel", async ({ env, user, body }) => {
  const inv = await first(env, "SELECT * FROM crew_invites WHERE id=?", Math.floor(num(body.id, 1, 1e12, 0)));
  if (!inv || inv.captain_id !== user.id) throw bad("내가 보낸 초대가 아닙니다.");
  await run(env, "UPDATE crew_invites SET status='cancelled' WHERE id=? AND status='open'", inv.id);
  return { ok: true };
});
route("POST", "/api/crew/leave", async ({ env, user }) => { await run(env, "DELETE FROM crew WHERE member_id=?", user.id); return { ok: true }; });
route("POST", "/api/crew/dismiss", async ({ env, user, body }) => {
  await run(env, "DELETE FROM crew WHERE member_id=? AND captain_id=?", Math.floor(num(body.id, 1, 1e12, 0)), user.id);
  return { ok: true };
});
route("POST", "/api/crew/duty", async ({ env, user, body }) => {
  await limit(env, "duty:" + user.id, 30, 60_000);
  return doDuty(env, user, String(body.duty || ""));
});
route("POST", "/api/crew/withdraw", async ({ env, user }) => {
  const p = await first(env, "SELECT purse FROM crew_profile WHERE user_id=?", user.id);
  if (!p || p.purse <= 0) throw bad("찾을 월급이 없습니다.");
  // 월급을 0으로 만드는 일과 우편 발송을 한 묶음으로 (돈이 사라지거나 두 번 나오지 않게)
  const res = await env.DB.batch([
    P(env, "INSERT INTO deliveries(user_id,kind,payload,created) SELECT user_id,'purse',json_object('gold',purse),?2 FROM crew_profile WHERE user_id=?1 AND purse>0", user.id, now()),
    P(env, "UPDATE crew_profile SET purse=0 WHERE user_id=?", user.id),
  ]);
  if (changes(res[0]) !== 1) throw bad("찾을 월급이 없습니다.");
  return { ok: true, gold: p.purse };
});

/* ---------- 관리자: 초대 코드 발급 ---------- */
async function adminAuth(env, req, ip) {
  const key = String(env.ADMIN_KEY || "");
  // 키가 짧으면 무차별 대입에 약하므로 12자 미만이면 관리자 기능을 끈다
  if (key.length < 12) throw new HttpError(503, "서버에 ADMIN_KEY(12자 이상)가 설정되어 있지 않습니다.");
  await limit(env, "admin:" + ip, 30, 600_000);
  if (!(await safeEq(req.headers.get("x-admin-key") || "", key))) throw new HttpError(401, "관리자 키가 맞지 않습니다.");
}
route("POST", "/api/admin/invites", async ({ env, body }) => {
  const count = Math.floor(num(body.count, 1, 20, 1)), days = Math.floor(num(body.days, 1, 90, 14));
  const note = cleanStr(body.note, 40), codes = [], stm = [], t = now();
  for (let i = 0; i < count; i++) { const c = newInviteCode(); codes.push(c); stm.push(P(env, "INSERT INTO invites(code,note,created,expires) VALUES(?,?,?,?)", c, note, t, t + days * DAY)); }
  await env.DB.batch(stm);
  return { codes };
}, { admin: true });
route("GET", "/api/admin/invites", async ({ env }) => ({
  invites: await all(env, "SELECT i.code,i.note,i.created,i.expires,i.used_at,u.username used_by FROM invites i LEFT JOIN users u ON u.id=i.used_by ORDER BY i.created DESC LIMIT 200"),
}), { admin: true });
route("POST", "/api/admin/invites/delete", async ({ env, body }) => ({
  deleted: changes(await run(env, "DELETE FROM invites WHERE code=? AND used_by IS NULL", normCode(body.code))),
}), { admin: true });
route("GET", "/api/admin/users", async ({ env }) => ({
  users: await all(env, "SELECT u.id,u.username,u.created,p.updated lastSeen FROM users u LEFT JOIN presence p ON p.user_id=u.id ORDER BY u.id"),
}), { admin: true });
route("POST", "/api/admin/password", async ({ env, body }) => {
  const u = await first(env, "SELECT id FROM users WHERE username=?", String(body.username || ""));
  const pw = String(body.password || "");
  if (!u || pw.length < 6) throw bad("대상이 없거나 비밀번호가 짧습니다.");
  const { salt, hash } = await hashPassword(pw, iters(env));
  await env.DB.batch([P(env, "UPDATE users SET salt=?,hash=? WHERE id=?", salt, hash, u.id), P(env, "DELETE FROM sessions WHERE user_id=?", u.id)]);
  return { ok: true };
}, { admin: true });

/* ---------- 진입점 ---------- */
export async function handleApi(req, env, ip) {
  const url = new URL(req.url);
  const r = routes.get(req.method + " " + url.pathname);
  if (!r) throw new HttpError(404, "없는 주소입니다.");
  await ensureSchema(env);
  let user = null;
  if (r.admin) await adminAuth(env, req, ip); else if (!r.anon) user = await authUser(env, req);
  let body = {};
  if (req.method !== "GET") {
    const text = await req.text();
    if (text.length > (r.maxBody || 64_000)) throw new HttpError(413, "요청이 너무 큽니다.");
    if (text) { try { body = JSON.parse(text); } catch { throw new HttpError(400, "JSON 형식이 올바르지 않습니다."); } if (!body || typeof body !== "object") body = {}; }
  }
  return r.fn({ env, user, body, ip, req });
}

/* ---------- 정리 작업 (크론: 몇 분마다) ---------- */
export async function sweep(env) {
  await ensureSchema(env);
  const t = now();
  const expired = await all(env, "SELECT id FROM trades WHERE status='open' AND expires<=? LIMIT 50", t);
  for (const tr of expired) await closeTrade(env, tr.id, "expired", "제안이 시간 안에 받아들여지지 않았다");
  await env.DB.batch([
    P(env, "DELETE FROM rl WHERE r<?", t),
    P(env, "DELETE FROM sessions WHERE seen<?", t - SESSION_TTL),
    P(env, "DELETE FROM chat WHERE channel='world' AND id<(SELECT COALESCE(MAX(id),0)-500 FROM chat WHERE channel='world')"),
    P(env, "DELETE FROM chat WHERE channel<>'world' AND ts<?", t - 7 * DAY),
    P(env, "DELETE FROM deliveries WHERE claimed IS NOT NULL AND claimed<?", t - DAY),
    P(env, "DELETE FROM deliveries WHERE claimed IS NULL AND created<?", t - 30 * DAY),
    P(env, "DELETE FROM bottles WHERE created<?", t - 30 * DAY),
    P(env, "DELETE FROM bottles WHERE finder_id IS NULL AND reply_to IS NULL AND id NOT IN (SELECT id FROM bottles WHERE finder_id IS NULL AND reply_to IS NULL ORDER BY id DESC LIMIT 2000)"),
    P(env, "UPDATE crew_invites SET status='cancelled' WHERE status='open' AND created<?", t - 3 * DAY),
    P(env, "DELETE FROM crew_invites WHERE status<>'open' AND created<?", t - 14 * DAY),
    P(env, "DELETE FROM trades WHERE status<>'open' AND created<?", t - 7 * DAY),
    P(env, "DELETE FROM crew_cd WHERE ready<?", t - DAY),
    P(env, "DELETE FROM presence WHERE updated<?", t - 7 * DAY),
  ]);
}
