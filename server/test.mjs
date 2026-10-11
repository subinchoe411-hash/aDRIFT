// node --test server/test.mjs  — 임시 DB 로 서버를 띄워 주요 흐름을 점검한다
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// TEST_BASE / TEST_ADMIN_KEY 를 주면 이미 떠 있는 서버(예: wrangler dev)를 시험하고, 없으면 Node 서버를 직접 띄운다.
const PORT = 3200 + Math.floor(Math.random() * 500), BASE = process.env.TEST_BASE || `http://127.0.0.1:${PORT}`, KEY = process.env.TEST_ADMIN_KEY || "k3y-test-admin-key";
let proc;
test.before(async () => {
  if (!process.env.TEST_BASE) proc = spawn(process.execPath, ["server/server.js"], {
    env: { ...process.env, PORT, ADMIN_KEY: KEY, REG_LIMIT: "1000", DATA_DIR: mkdtempSync(join(tmpdir(), "adrift-")) }, stdio: "ignore",
  });
  for (let i = 0; i < 100; i++) { try { await fetch(BASE + "/api/me"); return; } catch { await new Promise((r) => setTimeout(r, 200)); } }
  throw new Error("서버가 뜨지 않음");
});
test.after(() => proc && proc.kill());

const call = async (path, body, tok, method) => {
  const r = await fetch(BASE + path, {
    method: method || (body === undefined ? "GET" : "POST"),
    headers: { "content-type": "application/json", ...(tok ? { authorization: "Bearer " + tok } : {}), "x-admin-key": KEY },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, ...(await r.json()) };
};
const join_ = async (name) => {
  const { codes } = await call("/api/admin/invites", { count: 1 });
  const r = await call("/api/register", { code: codes[0], username: name, password: "secret1" });
  assert.equal(r.status, 200, JSON.stringify(r));
  return { tok: r.token, id: r.user.id };
};
const me = (o) => ({ name: "선장", ship: "조각배", lv: 0, x: 10, y: 10, hd: 0, loc: "sea", isl: -1, ...o });
const sync = (tok, m, since) => call("/api/sync", { me: m, since }, tok);

test("초대 코드는 한 번만 쓸 수 있고, 로그인/중복 아이디가 막힌다", async () => {
  const { codes } = await call("/api/admin/invites", { count: 1 });
  assert.equal((await call("/api/register", { code: "AAAA-BBBB-CCCC", username: "abc", password: "secret1" })).status, 400);
  const ok = await call("/api/register", { code: codes[0], username: "alice", password: "secret1" });
  assert.equal(ok.status, 200);
  assert.equal((await call("/api/register", { code: codes[0], username: "alice2", password: "secret1" })).status, 400);
  const { codes: c2 } = await call("/api/admin/invites", { count: 1 });
  assert.equal((await call("/api/register", { code: c2[0], username: "ALICE", password: "secret1" })).status, 400);
  assert.equal((await call("/api/login", { username: "alice", password: "wrong!!" })).status, 401);
  const lg = await call("/api/login", { username: "alice", password: "secret1" });
  assert.equal(lg.status, 200);
  assert.equal((await call("/api/me", undefined, lg.token)).user.username, "alice");
  assert.equal((await call("/api/me")).status, 401);
});

test("관리자 키 없이는 초대 코드를 못 만든다", async () => {
  const r = await fetch(BASE + "/api/admin/invites", { method: "POST", body: "{}" });
  assert.equal(r.status, 401);
});

test("가까운 배끼리만 보이고, 인사·거래·채팅이 오간다", async () => {
  const a = await join_("ann"), b = await join_("bob"), c = await join_("cat");
  await sync(a.tok, me({ name: "앤", x: 10, y: 10 }));
  await sync(c.tok, me({ name: "캣", x: 40, y: 30 }));
  const sb = await sync(b.tok, me({ name: "밥", x: 11, y: 10 }));
  assert.deepEqual(sb.nearby.map((n) => n.name), ["앤"]);
  // 멀리 있는 사람에겐 인사 불가
  assert.equal((await call("/api/greet", { to: c.id, text: "hi" }, a.tok)).status, 400);
  assert.equal((await call("/api/greet", { to: b.id, text: "안녕하세요" }, a.tok)).status, 200);
  const sb2 = await sync(b.tok, me({ name: "밥", x: 11, y: 10 }));
  const g = sb2.deliveries.find((d) => d.kind === "greet");
  assert.equal(g.payload.text, "안녕하세요");
  const cl = await call("/api/claim", { ids: [g.id] }, b.tok);
  assert.equal(cl.deliveries.length, 1);
  assert.equal((await call("/api/claim", { ids: [g.id] }, b.tok)).deliveries.length, 0, "두 번 가져갈 수 없다");

  // 거래: 앤이 멸치 2개 + 골드 0 을 내놓고 골드 30을 원한다
  const off = await call("/api/trade/offer", { to: b.id, give: { items: { 멸치: 2 } }, want: { gold: 30 } }, a.tok);
  assert.equal(off.status, 200);
  const sb3 = await sync(b.tok, me({ name: "밥", x: 11, y: 10 }));
  assert.equal(sb3.trades.incoming.length, 1);
  assert.equal((await call("/api/trade/accept", { id: off.id }, c.tok)).status, 400, "제3자는 수락 불가");
  assert.equal((await call("/api/trade/accept", { id: off.id }, b.tok)).status, 200);
  assert.equal((await call("/api/trade/accept", { id: off.id }, b.tok)).status, 400, "두 번 수락 불가");
  const da = (await sync(a.tok, me({ name: "앤", x: 10, y: 10 }))).deliveries.find((d) => d.kind === "trade_done");
  assert.equal(da.payload.gain.gold, 30);
  const db_ = (await sync(b.tok, me({ name: "밥", x: 11, y: 10 }))).deliveries.find((d) => d.kind === "trade_done");
  assert.equal(db_.payload.gain.items["멸치"], 2);
  assert.equal(db_.payload.cost.gold, 30);

  // 거절하면 제안자에게 환불 우편이 간다
  const off2 = await call("/api/trade/offer", { to: b.id, give: { gold: 50 }, want: {} }, a.tok);
  assert.equal((await call("/api/trade/decline", { id: off2.id }, b.tok)).status, 200);
  const ref = (await sync(a.tok, me({ name: "앤", x: 10, y: 10 }))).deliveries.find((d) => d.kind === "trade_refund");
  assert.equal(ref.payload.gain.gold, 50);

  // 채팅
  assert.equal((await call("/api/chat", { channel: "world", text: "<b>안녕</b>" }, a.tok)).status, 200);
  const s = await sync(b.tok, me({ name: "밥", x: 11, y: 10 }), { world: 0 });
  assert.equal(s.chat.world.at(-1).text, "b안녕/b");
  assert.equal((await call("/api/chat", { channel: "crew:" + a.id, text: "x" }, c.tok)).status, 403);
});

test("병 편지는 남이 주워 가고 답장이 돌아온다", async () => {
  const a = await join_("dan"), b = await join_("eve");
  await sync(a.tok, me({ name: "댄" })); await sync(b.tok, me({ name: "이브" }));
  assert.equal((await call("/api/bottle/find", {}, a.tok)).bottle, null, "자기 병은 못 줍는다");
  assert.equal((await call("/api/bottle/send", { text: "누구든 읽어 주세요" }, a.tok)).status, 200);
  const f = await call("/api/bottle/find", {}, b.tok);
  assert.equal(f.bottle.text, "누구든 읽어 주세요");
  assert.equal((await call("/api/bottle/find", {}, b.tok)).bottle, null, "한 번 주운 병은 사라진다");
  assert.equal((await call("/api/bottle/reply", { id: f.bottle.id, text: "읽었어요!" }, b.tok)).status, 200);
  assert.equal((await call("/api/bottle/reply", { id: f.bottle.id, text: "또" }, b.tok)).status, 400);
  const d = (await sync(a.tok, me({ name: "댄" }))).deliveries;
  assert.ok(d.some((x) => x.kind === "bottle_found"));
  assert.equal(d.find((x) => x.kind === "bottle_reply").payload.text, "읽었어요!");
});

test("선원이 되어 일하면 선장에게 결과가 가고 월급이 쌓인다", async () => {
  const cap = await join_("fred"), mate = await join_("gina");
  await sync(cap.tok, me({ name: "프레드" }));
  assert.equal((await call("/api/crew/invite", { username: "gina" }, cap.tok)).status, 200);
  const inv = (await sync(mate.tok, me({ name: "지나" }))).crew.invitesIn[0];
  assert.ok(inv);
  assert.equal((await call("/api/crew/respond", { id: inv.id, accept: true }, mate.tok)).status, 200);
  const s = await sync(mate.tok, me({ name: "지나" }));
  assert.equal(s.crew.memberOf.captain, "fred");
  assert.ok(s.crew.memberOf.ship.online);
  const w = await call("/api/crew/duty", { duty: "fish" }, mate.tok);
  assert.equal(w.status, 200);
  assert.equal((await call("/api/crew/duty", { duty: "fish" }, mate.tok)).status, 400, "쿨다운");
  const cd = (await sync(cap.tok, me({ name: "프레드" }))).deliveries.find((d) => d.kind === "crew_work");
  assert.ok(Object.keys(cd.payload.items).length);
  assert.equal((await call("/api/crew/withdraw", {}, mate.tok)).gold, 6);
  // 선원 채널은 같은 배 사람만
  assert.equal((await call("/api/chat", { channel: "crew:" + cap.id, text: "출항!" }, mate.tok)).status, 200);
  assert.equal((await call("/api/crew/dismiss", { id: mate.id }, cap.tok)).status, 200);
  assert.equal((await sync(mate.tok, me({ name: "지나" }))).crew.memberOf, null);
});

test("클라우드 저장", async () => {
  const a = await join_("hana");
  assert.equal((await call("/api/save", undefined, a.tok)).data, null);
  assert.equal((await call("/api/save", { data: '{"x":1}' }, a.tok, "PUT")).status, 200);
  assert.equal((await call("/api/save", undefined, a.tok)).data, '{"x":1}');
});
