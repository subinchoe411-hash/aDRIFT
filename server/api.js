import { db, tx, q } from "./db.js";
import {
  HttpError, bad, now, sha256, newToken, hashPassword, checkPassword, safeEq, newInviteCode,
  normCode, cleanStr, cleanName, validUser, num, limit, dist,
} from "./util.js";

const DAY = 86_400_000;
const SESSION_TTL = 30 * DAY;
const FRESH = 60_000;                         // 이 시간 안에 신호가 있어야 '바다에 있는' 배
const ENC_R = Number(process.env.ENCOUNTER_RADIUS || 2.5);  // 마주침 거리 (세계 좌표 단위)
const MAX_CREW = 4;
const ADMIN_KEY = process.env.ADMIN_KEY || "";

/* ---------- 준비된 쿼리 ---------- */
const S = {
  userByName: q("SELECT * FROM users WHERE username=?"),
  userById: q("SELECT id,username FROM users WHERE id=?"),
  insUser: q("INSERT INTO users(username,salt,hash,invite,created) VALUES(?,?,?,?,?)"),
  invite: q("SELECT * FROM invites WHERE code=?"),
  useInvite: q("UPDATE invites SET used_by=?, used_at=? WHERE code=? AND used_by IS NULL AND expires>?"),
  insSession: q("INSERT INTO sessions(token,user_id,created,seen) VALUES(?,?,?,?)"),
  session: q("SELECT s.user_id,s.seen,u.username FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.seen>?"),
  touchSession: q("UPDATE sessions SET seen=? WHERE token=?"),
  delSession: q("DELETE FROM sessions WHERE token=?"),
  upPresence: q(`INSERT INTO presence(user_id,name,ship,lv,x,y,hd,loc,isl,snap,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET name=excluded.name,ship=excluded.ship,lv=excluded.lv,x=excluded.x,y=excluded.y,
    hd=excluded.hd,loc=excluded.loc,isl=excluded.isl,snap=excluded.snap,updated=excluded.updated`),
  presence: q("SELECT * FROM presence WHERE user_id=?"),
  nearbyCand: q("SELECT * FROM presence WHERE user_id<>? AND updated>? AND loc<>'city'"),
  roster: q("SELECT p.user_id id,p.name,u.username FROM presence p JOIN users u ON u.id=p.user_id WHERE p.updated>? ORDER BY p.updated DESC LIMIT 40"),
  chatSince: q("SELECT id,user_id uid,name,text,ts FROM chat WHERE channel=? AND id>? ORDER BY id LIMIT 60"),
  chatLast: q("SELECT * FROM (SELECT id,user_id uid,name,text,ts FROM chat WHERE channel=? ORDER BY id DESC LIMIT 30) ORDER BY id"),
  insChat: q("INSERT INTO chat(channel,user_id,name,text,ts) VALUES(?,?,?,?,?)"),
  delivs: q("SELECT id,kind,payload,created FROM deliveries WHERE user_id=? AND claimed IS NULL ORDER BY id LIMIT 40"),
  insDeliv: q("INSERT INTO deliveries(user_id,kind,payload,created) VALUES(?,?,?,?)"),
  claim: q("UPDATE deliveries SET claimed=? WHERE id=? AND user_id=? AND claimed IS NULL"),
  getDeliv: q("SELECT id,kind,payload,created FROM deliveries WHERE id=?"),
  pendingForCap: q("SELECT COUNT(*) n FROM deliveries WHERE user_id=? AND claimed IS NULL AND kind='crew_work'"),
  tradeIn: q("SELECT t.*,u.username fromName FROM trades t JOIN users u ON u.id=t.from_id WHERE t.to_id=? AND t.status='open' AND t.expires>? ORDER BY t.id DESC LIMIT 10"),
  tradeOut: q("SELECT t.*,u.username toName FROM trades t JOIN users u ON u.id=t.to_id WHERE t.from_id=? AND t.status='open' AND t.expires>? ORDER BY t.id DESC LIMIT 10"),
  trade: q("SELECT * FROM trades WHERE id=?"),
  insTrade: q("INSERT INTO trades(from_id,to_id,give,want,status,created,expires) VALUES(?,?,?,?,'open',?,?)"),
  setTrade: q("UPDATE trades SET status=? WHERE id=? AND status='open'"),
  openTradeCount: q("SELECT COUNT(*) n FROM trades WHERE from_id=? AND status='open' AND expires>?"),
  openTradePair: q("SELECT COUNT(*) n FROM trades WHERE from_id=? AND to_id=? AND status='open' AND expires>?"),
  expiredTrades: q("SELECT * FROM trades WHERE status='open' AND expires<=?"),
  insBottle: q("INSERT INTO bottles(author_id,name,text,reply_to,created) VALUES(?,?,?,?,?)"),
  myDrifting: q("SELECT COUNT(*) n FROM bottles WHERE author_id=? AND finder_id IS NULL AND reply_to IS NULL"),
  pickBottle: q("SELECT * FROM bottles WHERE finder_id IS NULL AND reply_to IS NULL AND author_id<>? ORDER BY RANDOM() LIMIT 1"),
  takeBottle: q("UPDATE bottles SET finder_id=?, found_at=? WHERE id=? AND finder_id IS NULL"),
  bottle: q("SELECT * FROM bottles WHERE id=?"),
  replied: q("SELECT COUNT(*) n FROM bottles WHERE reply_to=?"),
  crewOf: q("SELECT * FROM crew WHERE member_id=?"),
  crewMembers: q("SELECT c.member_id id,u.username,c.joined FROM crew c JOIN users u ON u.id=c.member_id WHERE c.captain_id=?"),
  crewCount: q("SELECT COUNT(*) n FROM crew WHERE captain_id=?"),
  insCrew: q("INSERT INTO crew(member_id,captain_id,joined) VALUES(?,?,?)"),
  delCrew: q("DELETE FROM crew WHERE member_id=? AND captain_id=?"),
  delCrewSelf: q("DELETE FROM crew WHERE member_id=?"),
  insCInv: q("INSERT INTO crew_invites(captain_id,member_id,created,status) VALUES(?,?,?, 'open')"),
  cInvIn: q("SELECT i.id,i.captain_id,u.username captainName,i.created FROM crew_invites i JOIN users u ON u.id=i.captain_id WHERE i.member_id=? AND i.status='open' AND i.created>? ORDER BY i.id DESC LIMIT 10"),
  cInvOut: q("SELECT i.id,i.member_id,u.username memberName FROM crew_invites i JOIN users u ON u.id=i.member_id WHERE i.captain_id=? AND i.status='open' AND i.created>? LIMIT 10"),
  cInv: q("SELECT * FROM crew_invites WHERE id=?"),
  setCInv: q("UPDATE crew_invites SET status=? WHERE id=? AND status='open'"),
  cInvDup: q("SELECT COUNT(*) n FROM crew_invites WHERE captain_id=? AND member_id=? AND status='open' AND created>?"),
  profile: q("SELECT * FROM crew_profile WHERE user_id=?"),
  insProfile: q("INSERT OR IGNORE INTO crew_profile(user_id) VALUES(?)"),
  setProfile: q("UPDATE crew_profile SET purse=?,xp=?,tasks=?,day=?,day_earn=? WHERE user_id=?"),
  cd: q("SELECT duty,ready FROM crew_cd WHERE member_id=?"),
  setCd: q("INSERT INTO crew_cd(member_id,duty,ready) VALUES(?,?,?) ON CONFLICT(member_id,duty) DO UPDATE SET ready=excluded.ready"),
  getSave: q("SELECT data,updated FROM saves WHERE user_id=?"),
  putSave: q("INSERT INTO saves(user_id,data,updated) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data,updated=excluded.updated"),
};

const deliver = (uid, kind, payload) => S.insDeliv.run(uid, kind, JSON.stringify(payload), now());

/* ---------- 인증 ---------- */
export function authUser(req) {
  const h = req.headers.authorization || "";
  const tok = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  if (!/^[a-f0-9]{64}$/.test(tok)) throw new HttpError(401, "로그인이 필요합니다.");
  const key = sha256(tok);
  const t = now();
  const r = S.session.get(key, t - SESSION_TTL);
  if (!r) throw new HttpError(401, "로그인이 만료되었습니다.");
  if (t - r.seen > 600_000) S.touchSession.run(t, key);
  return { id: r.user_id, username: r.username, key };
}
const issueSession = (uid) => {
  const tok = newToken();
  S.insSession.run(sha256(tok), uid, now(), now());
  return tok;
};

/* ---------- 가까이 있는가 ---------- */
function nearCheck(meId, otherId) {
  const a = S.presence.get(meId), b = S.presence.get(otherId);
  const t = now();
  if (!a || !b || t - a.updated > FRESH || t - b.updated > FRESH) return false;
  if (a.loc === "sea" && b.loc === "sea") return dist(a.x, a.y, b.x, b.y) <= ENC_R + 0.5;
  if (a.loc === "port" && b.loc === "port") return a.isl >= 0 && a.isl === b.isl;
  return false;
}
const needNear = (meId, otherId) => {
  if (!nearCheck(meId, otherId)) throw bad("그 배는 이제 가까이에 없습니다.");
};

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
const empty = (b) => !b.gold && !Object.keys(b.items).length;

/* ---------- 선원 일 ---------- */
const OPEN = ["멸치", "고등어", "오징어", "참치", "가다랑어", "연어", "갈치"];
const COAST = ["조개", "새우", "게", "도미", "광어", "전복", "문어"];
const rpick = (a) => a[Math.floor(Math.random() * a.length)];
const DUTIES = {
  fish:    { name: "낚시",   cd: 75_000,  wage: 6 },
  cook:    { name: "식사 준비", cd: 120_000, wage: 5 },
  lookout: { name: "망보기", cd: 120_000, wage: 6 },
  repair:  { name: "선체 수리", cd: 150_000, wage: 5 },
};
const RANKS = [[0, "견습 선원"], [20, "갑판원"], [60, "숙련 선원"], [150, "갑판장"]];
const rankOf = (xp) => RANKS.filter(([m]) => xp >= m).pop()[1];
const DAILY_CAP = 200;
const dayKey = () => new Date().toISOString().slice(0, 10);

function doDuty(u, duty) {
  const d = DUTIES[duty];
  if (!d) throw bad("알 수 없는 일입니다.");
  const c = S.crewOf.get(u.id);
  if (!c) throw bad("탑승한 배가 없습니다.");
  const t = now();
  const cd = Object.fromEntries(S.cd.all(u.id).map((r) => [r.duty, r.ready]));
  if ((cd[duty] || 0) > t) throw bad("아직 손이 비지 않았습니다.");
  if (S.pendingForCap.get(c.captain_id).n >= 15) throw bad("선장이 한동안 자리를 비워 일이 쌓여 있습니다. 조금 쉬세요.");
  const cap = S.presence.get(c.captain_id);
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
  S.setCd.run(u.id, duty, t + d.cd);
  S.insProfile.run(u.id);
  const p = S.profile.get(u.id);
  const day = dayKey();
  let dayEarn = p.day === day ? p.day_earn : 0;
  const wage = Math.max(0, Math.min(d.wage, DAILY_CAP - dayEarn));
  dayEarn += wage;
  S.setProfile.run(p.purse + wage, p.xp + 1, p.tasks + 1, day, dayEarn, u.id);
  work.by = u.username; work.duty = d.name; work.text = msg;
  deliver(c.captain_id, "crew_work", work);
  return { msg, wage, ready: t + d.cd };
}

/* ---------- 라우터 ---------- */
const routes = new Map();
const route = (method, path, fn, opts = {}) => routes.set(method + " " + path, { fn, ...opts });

/* 계정 */
route("POST", "/api/register", ({ body, ip }) => {
  limit("reg:" + ip, Number(process.env.REG_LIMIT || 8), 3_600_000);
  const code = normCode(body.code), username = String(body.username || "").trim(), pw = String(body.password || "");
  if (!validUser(username)) throw bad("아이디는 3~16자의 한글·영문·숫자·밑줄만 쓸 수 있습니다.");
  if (pw.length < 6 || pw.length > 72) throw bad("비밀번호는 6~72자로 정해 주세요.");
  const inv = S.invite.get(code);
  if (!inv || inv.used_by || inv.expires <= now()) throw bad("사용할 수 없는 초대 코드입니다.");
  if (S.userByName.get(username)) throw bad("이미 있는 아이디입니다.");
  const { salt, hash } = hashPassword(pw);
  const uid = tx(() => {
    const r = S.insUser.run(username, salt, hash, code, now());
    const id = Number(r.lastInsertRowid);
    if (S.useInvite.run(id, now(), code, now()).changes !== 1) throw bad("방금 다른 사람이 이 코드를 썼습니다.");
    return id;
  });
  return { token: issueSession(uid), user: { id: uid, username } };
}, { anon: true });

route("POST", "/api/login", ({ body, ip }) => {
  limit("login:" + ip, 20, 600_000);
  const username = String(body.username || "").trim(), pw = String(body.password || "");
  const u = S.userByName.get(username);
  limit("loginu:" + username.toLowerCase(), 10, 600_000);
  // 존재 여부를 알려 주지 않도록 없는 계정도 같은 시간만큼 해시를 돌린다
  const ok = u ? checkPassword(pw, u.salt, u.hash) : (hashPassword(pw), false);
  if (!ok) throw new HttpError(401, "아이디 또는 비밀번호가 맞지 않습니다.");
  return { token: issueSession(u.id), user: { id: u.id, username: u.username } };
}, { anon: true });

route("POST", "/api/logout", ({ user }) => { S.delSession.run(user.key); return { ok: true }; });
route("GET", "/api/me", ({ user }) => ({ user: { id: user.id, username: user.username } }));

/* 클라우드 저장 */
route("GET", "/api/save", ({ user }) => {
  const r = S.getSave.get(user.id);
  return r ? { data: r.data, updated: r.updated } : { data: null };
});
route("PUT", "/api/save", ({ user, body }) => {
  limit("save:" + user.id, 12, 60_000);
  if (typeof body.data !== "string" || body.data.length > 1_200_000) throw bad("저장 데이터가 너무 큽니다.");
  S.putSave.run(user.id, body.data, now());
  return { ok: true, updated: now() };
}, { maxBody: 1_500_000 });

/* 동기화: 내 위치를 알리고, 주변·채팅·우편·거래·선원 소식을 한 번에 받는다 */
route("POST", "/api/sync", ({ user, body }) => {
  limit("sync:" + user.id, 40, 60_000);
  const t = now();
  const m = body.me;
  if (m && typeof m === "object") {
    const loc = ["sea", "port", "city"].includes(m.loc) ? m.loc : "sea";
    let snap = "{}";
    if (m.snap && typeof m.snap === "object") {
      snap = JSON.stringify(m.snap);
      if (snap.length > 2500) snap = "{}";
    }
    S.upPresence.run(user.id, cleanName(m.name), cleanStr(m.ship, 16) || "조각배", Math.floor(num(m.lv, 0, 3)),
      num(m.x, 0, 60), num(m.y, 0, 42), num(m.hd, 0, 360), loc, Math.floor(num(m.isl, -1, 200, -1)), snap, t);
  }
  const mine = S.presence.get(user.id);

  const nearby = [];
  if (mine && mine.loc !== "city") {
    for (const p of S.nearbyCand.all(user.id, t - FRESH)) {
      let d = null;
      if (mine.loc === "sea" && p.loc === "sea") { d = dist(mine.x, mine.y, p.x, p.y); if (d > ENC_R) continue; }
      else if (mine.loc === "port" && p.loc === "port" && mine.isl >= 0 && mine.isl === p.isl) d = 0;
      else continue;
      nearby.push({ id: p.user_id, name: p.name, ship: p.ship, lv: p.lv, x: p.x, y: p.y, hd: p.hd, loc: p.loc, d: Math.round(d * 10) / 10 });
    }
  }

  // 채널 구독: 월드 채팅 + 내가 속한 배
  const crewRow = S.crewOf.get(user.id);
  const myShip = crewRow ? crewRow.captain_id : user.id;
  const chans = ["world", "crew:" + myShip];
  const since = body.since && typeof body.since === "object" ? body.since : {};
  const chat = {};
  for (const ch of chans) {
    const s = since[ch];
    chat[ch] = typeof s === "number" ? S.chatSince.all(ch, s) : S.chatLast.all(ch);
  }

  const deliveries = S.delivs.all(user.id).map((d) => ({ ...d, payload: JSON.parse(d.payload) }));

  const trades = {
    incoming: S.tradeIn.all(user.id, t).map((r) => ({ id: r.id, from: r.from_id, name: r.fromName, give: JSON.parse(r.give), want: JSON.parse(r.want), expires: r.expires })),
    outgoing: S.tradeOut.all(user.id, t).map((r) => ({ id: r.id, to: r.to_id, name: r.toName, give: JSON.parse(r.give), want: JSON.parse(r.want), expires: r.expires })),
  };

  // 선원 소식
  const crew = { captainOf: [], memberOf: null, invitesIn: [], invitesOut: [], me: null };
  crew.captainOf = S.crewMembers.all(user.id).map((r) => ({ id: r.id, name: r.username, online: !!(S.presence.get(r.id) && t - S.presence.get(r.id).updated < FRESH * 2) }));
  crew.invitesIn = S.cInvIn.all(user.id, t - 3 * DAY);
  crew.invitesOut = S.cInvOut.all(user.id, t - 3 * DAY);
  if (crewRow) {
    const cap = S.userById.get(crewRow.captain_id), cp = S.presence.get(crewRow.captain_id);
    crew.memberOf = {
      captainId: crewRow.captain_id, captain: cap && cap.username,
      shipmates: S.crewMembers.all(crewRow.captain_id).map((r) => r.username),
      ship: cp ? { name: cp.name, ship: cp.ship, lv: cp.lv, x: cp.x, y: cp.y, hd: cp.hd, loc: cp.loc, isl: cp.isl, online: t - cp.updated < FRESH * 2, snap: JSON.parse(cp.snap || "{}"), at: cp.updated } : null,
    };
  }
  // 월급 정보는 선원이 아니어도(내렸어도) 남아 있다
  const p = S.profile.get(user.id);
  if (p || crewRow) {
    const pp = p || { purse: 0, xp: 0, tasks: 0, day: "", day_earn: 0 };
    const cd = crewRow ? Object.fromEntries(S.cd.all(user.id).map((r) => [r.duty, r.ready])) : {};
    crew.me = { purse: pp.purse, xp: pp.xp, tasks: pp.tasks, rank: rankOf(pp.xp), cd, dayLeft: DAILY_CAP - (pp.day === dayKey() ? pp.day_earn : 0) };
  }

  const roster = S.roster.all(t - 5 * 60_000).filter((r) => r.id !== user.id);
  return { now: t, nearby, chat, deliveries, trades, crew, roster, radius: ENC_R };
});

route("POST", "/api/claim", ({ user, body }) => {
  const ids = Array.isArray(body.ids) ? body.ids.slice(0, 40) : [];
  const out = [];
  tx(() => {
    for (const id of ids) {
      if (!Number.isInteger(id)) continue;
      if (S.claim.run(now(), id, user.id).changes === 1) {
        const d = S.getDeliv.get(id);
        out.push({ id: d.id, kind: d.kind, payload: JSON.parse(d.payload), created: d.created });
      }
    }
  });
  return { deliveries: out };
});

/* 인사 */
route("POST", "/api/greet", ({ user, body }) => {
  const to = Math.floor(num(body.to, 1, 1e9, 0));
  limit(`greet:${user.id}:${to}`, 3, 30_000);
  limit("greet:" + user.id, 20, 60_000);
  const text = cleanStr(body.text, 40);
  if (!text) throw bad("인사말이 비었습니다.");
  if (to === user.id || !S.userById.get(to)) throw bad("대상이 올바르지 않습니다.");
  needNear(user.id, to);
  const me = S.presence.get(user.id);
  deliver(to, "greet", { from: user.id, name: me.name, ship: me.ship, text });
  return { ok: true };
});

/* 거래 */
route("POST", "/api/trade/offer", ({ user, body }) => {
  limit("trade:" + user.id, 20, 60_000);
  const to = Math.floor(num(body.to, 1, 1e9, 0));
  if (to === user.id || !S.userById.get(to)) throw bad("대상이 올바르지 않습니다.");
  needNear(user.id, to);
  const give = cleanBundle(body.give, "내놓을 것"), want = cleanBundle(body.want, "원하는 것");
  if (empty(give) && empty(want)) throw bad("거래할 내용이 없습니다.");
  const t = now();
  if (S.openTradeCount.get(user.id, t).n >= 3) throw bad("진행 중인 제안이 너무 많습니다.");
  if (S.openTradePair.get(user.id, to, t).n >= 1) throw bad("이미 그 사람에게 제안한 거래가 있습니다.");
  const r = S.insTrade.run(user.id, to, JSON.stringify(give), JSON.stringify(want), t, t + 30 * 60_000);
  return { id: Number(r.lastInsertRowid) };
});
function closeTrade(id, status, refundTo) {
  return tx(() => {
    const tr = S.trade.get(id);
    if (!tr || tr.status !== "open") return null;
    S.setTrade.run(status, id);
    if (refundTo) deliver(tr.from_id, "trade_refund", { gain: JSON.parse(tr.give), why: refundTo });
    return tr;
  });
}
route("POST", "/api/trade/cancel", ({ user, body }) => {
  const tr = S.trade.get(Math.floor(num(body.id, 1, 1e12, 0)));
  if (!tr || tr.from_id !== user.id) throw bad("내 제안이 아닙니다.");
  if (!closeTrade(tr.id, "cancelled", "제안을 거두었다")) throw bad("이미 끝난 거래입니다.");
  return { ok: true };
});
route("POST", "/api/trade/decline", ({ user, body }) => {
  const tr = S.trade.get(Math.floor(num(body.id, 1, 1e12, 0)));
  if (!tr || tr.to_id !== user.id) throw bad("나에게 온 제안이 아닙니다.");
  if (!closeTrade(tr.id, "declined", "상대가 제안을 거절했다")) throw bad("이미 끝난 거래입니다.");
  return { ok: true };
});
route("POST", "/api/trade/accept", ({ user, body }) => {
  limit("trade:" + user.id, 20, 60_000);
  const id = Math.floor(num(body.id, 1, 1e12, 0));
  return tx(() => {
    const tr = S.trade.get(id);
    if (!tr || tr.to_id !== user.id || tr.status !== "open" || tr.expires <= now()) throw bad("이미 끝났거나 만료된 거래입니다.");
    needNear(user.id, tr.from_id);
    S.setTrade.run("done", id);
    const give = JSON.parse(tr.give), want = JSON.parse(tr.want);
    const from = S.presence.get(tr.from_id), me = S.presence.get(user.id);
    deliver(user.id, "trade_done", { gain: give, cost: want, with: from ? from.name : "상대" });
    deliver(tr.from_id, "trade_done", { gain: want, cost: { gold: 0, items: {} }, with: me ? me.name : "상대" });
    return { ok: true };
  });
});

/* 병 편지 */
route("POST", "/api/bottle/send", ({ user, body }) => {
  limit("bottle:" + user.id, 10, 3_600_000);
  const text = cleanStr(body.text, 60);
  if (!text) throw bad("편지가 비었습니다.");
  if (S.myDrifting.get(user.id).n >= 3) throw bad("바다에 띄운 병이 너무 많습니다.");
  const p = S.presence.get(user.id);
  const r = S.insBottle.run(user.id, p ? p.name : "무명", text, null, now());
  return { id: Number(r.lastInsertRowid) };
});
route("POST", "/api/bottle/find", ({ user }) => {
  limit("find:" + user.id, 30, 3_600_000);
  return tx(() => {
    const b = S.pickBottle.get(user.id);
    if (!b) return { bottle: null };
    S.takeBottle.run(user.id, now(), b.id);
    deliver(b.author_id, "bottle_found", { text: b.text });
    return { bottle: { id: b.id, from: b.name, text: b.text, at: b.created } };
  });
});
route("POST", "/api/bottle/reply", ({ user, body }) => {
  limit("reply:" + user.id, 10, 3_600_000);
  const b = S.bottle.get(Math.floor(num(body.id, 1, 1e12, 0)));
  if (!b || b.finder_id !== user.id) throw bad("내가 주운 병이 아닙니다.");
  if (S.replied.get(b.id).n) throw bad("이미 답장을 보냈습니다.");
  const text = cleanStr(body.text, 60);
  if (!text) throw bad("답장이 비었습니다.");
  const p = S.presence.get(user.id);
  S.insBottle.run(user.id, p ? p.name : "무명", text, b.id, now());
  deliver(b.author_id, "bottle_reply", { from: p ? p.name : "무명", text, re: b.text });
  return { ok: true };
});

/* 채팅 */
route("POST", "/api/chat", ({ user, body }) => {
  limit("chat:" + user.id, 25, 60_000);
  limit("chat1:" + user.id, 1, 1_000);
  const text = cleanStr(body.text, 80);
  if (!text) throw bad("내용이 비었습니다.");
  const ch = String(body.channel || "world");
  if (ch !== "world") {
    const m = /^crew:(\d+)$/.exec(ch);
    if (!m) throw bad("알 수 없는 채널입니다.");
    const cid = Number(m[1]);
    const ok = cid === user.id || (S.crewOf.get(user.id) || {}).captain_id === cid;
    if (!ok) throw new HttpError(403, "그 배의 채팅에 참여할 수 없습니다.");
  }
  const p = S.presence.get(user.id);
  S.insChat.run(ch, user.id, p ? p.name : user.username, text, now());
  return { ok: true };
});

/* 선원 */
route("POST", "/api/crew/invite", ({ user, body }) => {
  limit("cinv:" + user.id, 10, 60_000);
  const target = S.userByName.get(String(body.username || "").trim());
  if (!target || target.id === user.id) throw bad("초대할 수 없는 아이디입니다.");
  if (S.crewOf.get(target.id)) throw bad("그 사람은 이미 다른 배에서 일하고 있습니다.");
  if (S.crewCount.get(user.id).n >= MAX_CREW) throw bad(`선원은 최대 ${MAX_CREW}명까지입니다.`);
  if (S.cInvDup.get(user.id, target.id, now() - 3 * DAY).n) throw bad("이미 초대했습니다.");
  S.insCInv.run(user.id, target.id, now());
  return { ok: true };
});
route("POST", "/api/crew/respond", ({ user, body }) => {
  const inv = S.cInv.get(Math.floor(num(body.id, 1, 1e12, 0)));
  if (!inv || inv.member_id !== user.id || inv.status !== "open") throw bad("유효하지 않은 초대입니다.");
  if (!body.accept) { S.setCInv.run("declined", inv.id); return { ok: true }; }
  return tx(() => {
    if (S.crewOf.get(user.id)) throw bad("이미 다른 배에서 일하고 있습니다. 먼저 내려야 합니다.");
    if (S.crewCount.get(inv.captain_id).n >= MAX_CREW) throw bad("그 배는 선원이 가득 찼습니다.");
    S.setCInv.run("accepted", inv.id);
    S.insCrew.run(user.id, inv.captain_id, now());
    S.insProfile.run(user.id);
    return { ok: true };
  });
});
route("POST", "/api/crew/cancel", ({ user, body }) => {
  const inv = S.cInv.get(Math.floor(num(body.id, 1, 1e12, 0)));
  if (!inv || inv.captain_id !== user.id) throw bad("내가 보낸 초대가 아닙니다.");
  S.setCInv.run("cancelled", inv.id);
  return { ok: true };
});
route("POST", "/api/crew/leave", ({ user }) => { S.delCrewSelf.run(user.id); return { ok: true }; });
route("POST", "/api/crew/dismiss", ({ user, body }) => {
  S.delCrew.run(Math.floor(num(body.id, 1, 1e12, 0)), user.id);
  return { ok: true };
});
route("POST", "/api/crew/duty", ({ user, body }) => {
  limit("duty:" + user.id, 30, 60_000);
  return tx(() => doDuty(user, String(body.duty || "")));
});
route("POST", "/api/crew/withdraw", ({ user }) => {
  return tx(() => {
    S.insProfile.run(user.id);
    const p = S.profile.get(user.id);
    if (p.purse <= 0) throw bad("찾을 월급이 없습니다.");
    S.setProfile.run(0, p.xp, p.tasks, p.day, p.day_earn, user.id);
    deliver(user.id, "purse", { gold: p.purse });
    return { ok: true, gold: p.purse };
  });
});

/* ---------- 관리자: 초대 코드 발급 ---------- */
function adminAuth(req) {
  if (!ADMIN_KEY) throw new HttpError(503, "서버에 ADMIN_KEY 가 설정되어 있지 않습니다.");
  limit("admin:" + (req.socket.remoteAddress || ""), 60, 600_000);
  if (!safeEq(req.headers["x-admin-key"] || "", ADMIN_KEY)) throw new HttpError(401, "관리자 키가 맞지 않습니다.");
}
const insInvite = q("INSERT INTO invites(code,note,created,expires) VALUES(?,?,?,?)");
export function createInvites(count = 1, note = "", days = 14) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const code = newInviteCode();
    insInvite.run(code, cleanStr(note, 40), now(), now() + days * DAY);
    out.push(code);
  }
  return out;
}
route("POST", "/api/admin/invites", ({ body }) => {
  const count = Math.floor(num(body.count, 1, 20, 1)), days = Math.floor(num(body.days, 1, 90, 14));
  return { codes: createInvites(count, body.note, days) };
}, { admin: true });
route("GET", "/api/admin/invites", () => ({
  invites: q("SELECT i.code,i.note,i.created,i.expires,i.used_at,u.username used_by FROM invites i LEFT JOIN users u ON u.id=i.used_by ORDER BY i.created DESC LIMIT 200").all(),
}), { admin: true });
route("POST", "/api/admin/invites/delete", ({ body }) => {
  const r = q("DELETE FROM invites WHERE code=? AND used_by IS NULL").run(normCode(body.code));
  return { deleted: r.changes };
}, { admin: true });
route("GET", "/api/admin/users", () => ({
  users: q("SELECT u.id,u.username,u.created,p.updated lastSeen FROM users u LEFT JOIN presence p ON p.user_id=u.id ORDER BY u.id").all(),
}), { admin: true });
route("POST", "/api/admin/password", ({ body }) => {
  const u = S.userByName.get(String(body.username || ""));
  const pw = String(body.password || "");
  if (!u || pw.length < 6) throw bad("대상이 없거나 비밀번호가 짧습니다.");
  const { salt, hash } = hashPassword(pw);
  q("UPDATE users SET salt=?,hash=? WHERE id=?").run(salt, hash, u.id);
  q("DELETE FROM sessions WHERE user_id=?").run(u.id);
  return { ok: true };
}, { admin: true });

/* ---------- 디스패처 ---------- */
export function match(method, path) {
  return routes.get(method + " " + path);
}
export function authorize(r, req) {
  if (r.admin) { adminAuth(req); return null; }
  if (r.anon) return null;
  return authUser(req);
}

/* ---------- 정리 작업 (몇 분마다) ---------- */
export function sweep() {
  const t = now();
  try {
    for (const tr of S.expiredTrades.all(t)) closeTrade(tr.id, "expired", "제안이 시간 안에 받아들여지지 않았다");
    q("DELETE FROM sessions WHERE seen<?").run(t - SESSION_TTL);
    q("DELETE FROM chat WHERE channel='world' AND id<(SELECT COALESCE(MAX(id),0)-500 FROM chat WHERE channel='world')").run();
    q("DELETE FROM chat WHERE channel<>'world' AND ts<?").run(t - 7 * DAY);
    q("DELETE FROM deliveries WHERE claimed IS NOT NULL AND claimed<?").run(t - DAY);
    q("DELETE FROM deliveries WHERE claimed IS NULL AND created<?").run(t - 30 * DAY);
    q("DELETE FROM bottles WHERE created<?").run(t - 30 * DAY);
    q("DELETE FROM bottles WHERE finder_id IS NULL AND reply_to IS NULL AND id NOT IN (SELECT id FROM bottles WHERE finder_id IS NULL AND reply_to IS NULL ORDER BY id DESC LIMIT 2000)").run();
    q("UPDATE crew_invites SET status='cancelled' WHERE status='open' AND created<?").run(t - 3 * DAY);
    q("DELETE FROM presence WHERE updated<?").run(t - 7 * DAY);
  } catch (e) { console.error("sweep:", e); }
}
