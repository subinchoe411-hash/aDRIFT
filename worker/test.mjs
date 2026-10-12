// node --test worker/test.mjs
// 임시 DB 로 `wrangler dev`(실제 Workers 런타임 + 로컬 D1)를 띄워 주요 흐름을 점검한다.
// 이미 떠 있는 서버를 시험하려면 TEST_BASE / TEST_ADMIN_KEY 를 준다.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 8800 + Math.floor(Math.random() * 150), BASE = process.env.TEST_BASE || `http://127.0.0.1:${PORT}`, KEY = process.env.TEST_ADMIN_KEY || "test-admin-key-0123";
let proc;
test.before(async () => {
  if (!process.env.TEST_BASE) proc = spawn("npx", ["wrangler", "dev", "--local", "--port", String(PORT), "--ip", "127.0.0.1",
    "--persist-to", mkdtempSync(join(tmpdir(), "adrift-")), "--var", `ADMIN_KEY:${KEY}`, "--var", "REG_LIMIT:1000"], { stdio: "ignore" });
  for (let i = 0; i < 150; i++) { try { await fetch(BASE + "/api/me"); return; } catch { await new Promise((r) => setTimeout(r, 300)); } }
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

test("선원 개편: 직책, 컨디션, 일 7종, 월급 보너스", async () => {
  const cap = await join_("cap2"), mate = await join_("mate2");
  await sync(cap.tok, me({ name: "선장" }));
  await call("/api/crew/invite", { username: "mate2" }, cap.tok);
  const inv = (await sync(mate.tok, me({ name: "선원" }))).crew.invitesIn[0];
  await call("/api/crew/respond", { id: inv.id, accept: true }, mate.tok);

  assert.equal((await call("/api/crew/role", { role: "마법사", name: "아무개" }, mate.tok)).status, 400, "없는 직책");
  assert.equal((await call("/api/crew/role", { role: "요리사", name: "요리왕" }, mate.tok)).status, 200);
  assert.equal((await call("/api/crew/role", { role: "망꾼", name: "눈매" }, mate.tok)).status, 400, "승선 중에는 직책을 바꿀 수 없다");
  let s = await sync(mate.tok, me({ name: "선원" }));
  assert.equal(s.crew.me.role, "요리사");
  assert.equal(s.crew.me.cond, 100);
  let c = (await sync(cap.tok, me({ name: "선장" }))).crew.captainOf[0];
  assert.equal(c.role, "요리사");
  assert.equal(c.name, "요리왕", "선장에게는 아이디가 아니라 선원 캐릭터 이름이 보인다");
  assert.equal(c.online, false, "선원 화면에 들어오기 전엔 접속 중이 아님");
  await call("/api/sync", { crew: true }, mate.tok);
  c = (await sync(cap.tok, me({ name: "선장" }))).crew.captainOf[0];
  assert.equal(c.online, true, "선원 화면의 신호가 선장에게 접속 중으로 보임");

  // 자기 직책의 일은 보너스: 식사 허기 8~15 → x1.5, 월급 +2
  const w = await call("/api/crew/duty", { duty: "cook" }, mate.tok);
  assert.equal(w.status, 200);
  assert.equal(w.bonus, true);
  assert.equal(w.wage, 5 + 2);
  assert.equal(w.cond, 88);
  const d = (await sync(cap.tok, me({ name: "선장" }))).deliveries.find((x) => x.kind === "crew_work");
  assert.match(d.payload.fx, /^f:\d+$/);
  assert.equal(d.payload.role, "요리사");
  assert.equal(d.payload.by, "요리왕");
  assert.ok(d.payload.text.includes("요리왕") && !d.payload.text.includes("mate2"), "항해일지 문구에 아이디가 아닌 캐릭터 이름");

  // 새 일들이 모두 동작하고, 컨디션이 바닥나면 쉬어야 한다
  for (const duty of ["navigate", "haggle", "dive", "repair", "lookout", "fish"]) {
    const r = await call("/api/crew/duty", { duty }, mate.tok);
    assert.equal(r.status, 200, duty + " " + JSON.stringify(r));
  }
  // 지원(전투 중)까지 하면 컨디션이 바닥난다
  await sync(cap.tok, me({ name: "선장", snap: { bt: { t: "상어", rd: 1, en: [], al: [] } } }));
  for (const kind of ["fire", "mend"]) assert.equal((await call("/api/crew/support", { kind }, mate.tok)).status, 200, kind);
  const tired = await call("/api/crew/duty", { duty: "cook" }, mate.tok);
  assert.equal(tired.status, 400);
  assert.match(tired.error, /컨디션/);
  const rest = await call("/api/crew/rest", {}, mate.tok);
  assert.equal(rest.status, 200);
  assert.ok(rest.cond >= 30);
  assert.equal((await call("/api/crew/rest", {}, mate.tok)).status, 400, "쉬는 것도 쿨다운");

  // 배에서 내리면 직책이 비워지고, 다시 탑승하면 새로 정한다
  assert.equal((await call("/api/crew/leave", {}, mate.tok)).status, 200);
  assert.equal((await call("/api/crew/role", { role: "망꾼", name: "눈매" }, mate.tok)).status, 400, "탑승 전에는 직책을 정할 수 없다");
  await call("/api/crew/invite", { username: "mate2" }, cap.tok);
  const inv2 = (await sync(mate.tok, me({ name: "선원" }))).crew.invitesIn[0];
  await call("/api/crew/respond", { id: inv2.id, accept: true }, mate.tok);
  assert.equal((await sync(mate.tok, me({ name: "선원" }))).crew.me.role, "");
  assert.equal((await call("/api/crew/role", { role: "망꾼", name: "눈매" }, mate.tok)).status, 200);
  const mid = (await sync(cap.tok, me({ name: "선장" }))).crew.captainOf[0].id;
  assert.equal((await call("/api/crew/dismiss", { id: mid }, cap.tok)).status, 200);
  assert.equal((await sync(mate.tok, me({ name: "선원" }))).crew.me.role, "", "선장이 내리게 해도 직책이 비워진다");
});

test("전투·잠수 지원, 장면 건의, 공동 보상, 배식, 선원 보관함", async () => {
  const cap = await join_("cap3"), mate = await join_("mate3"), other = await join_("other3");
  await call("/api/crew/invite", { username: "mate3" }, cap.tok);
  await sync(cap.tok, me({ name: "선장" }));
  const inv = (await sync(mate.tok, me({ name: "선원" }))).crew.invitesIn[0];
  await call("/api/crew/respond", { id: inv.id, accept: true }, mate.tok);

  // 선장이 싸우고 있지 않으면 지원할 수 없다
  assert.equal((await call("/api/crew/support", { kind: "fire" }, mate.tok)).status, 400);
  await sync(cap.tok, me({ name: "선장", snap: { bt: { t: "상어", rd: 1, en: [{ n: "상어", hp: 70, mhp: 70 }], al: [] } } }));
  const f = await call("/api/crew/support", { kind: "fire" }, mate.tok);
  assert.equal(f.status, 200);
  assert.ok(f.power >= 10);
  assert.equal((await call("/api/crew/support", { kind: "fire" }, mate.tok)).status, 400, "지원 쿨다운");
  assert.equal((await call("/api/crew/support", { kind: "air" }, mate.tok)).status, 400, "잠수 중이 아니면 공기 보급 불가");
  const dv = (await sync(cap.tok, me({ name: "선장" }))).deliveries.find((x) => x.kind === "crew_support");
  assert.equal(dv.payload.kind, "fire");
  assert.equal((await call("/api/crew/support", { kind: "fire" }, other.tok)).status, 400, "선원이 아니면 불가");

  // 장면 건의
  await sync(cap.tok, me({ name: "선장", snap: { sc: { t: "소용돌이", o: ["밧줄", "해류", "돌파"] } } }));
  assert.equal((await call("/api/crew/advise", { opt: 5 }, mate.tok)).status, 400);
  assert.equal((await call("/api/crew/advise", { opt: 1 }, mate.tok)).status, 200);
  const adv = (await sync(cap.tok, me({ name: "선장" }))).deliveries.find((x) => x.kind === "crew_advice");
  assert.equal(adv.payload.opt, 1);

  // 공동 보상: 이 선장의 선원에게만
  const m = (await sync(cap.tok, me({ name: "선장" }))).crew.captainOf[0];
  const co = await call("/api/crew/coop", { kind: "battle", ids: [m.id, other.id] }, cap.tok);
  assert.deepEqual(co.credited, [m.id]);
  assert.equal((await call("/api/crew/coop", { kind: "battle", ids: [m.id] }, cap.tok)).status, 429, "분당 한 번");
  assert.equal((await call("/api/crew/coop", { kind: "x", ids: [m.id] }, cap.tok)).status, 400);
  const note = (await sync(mate.tok, me({ name: "선원" }))).deliveries.find((x) => x.kind === "coop_note");
  assert.match(note.payload.text, /월급 \+15G/);

  // 배식
  assert.equal((await call("/api/crew/serve", { item: "고등어구이" }, mate.tok)).status, 200);
  assert.equal((await call("/api/crew/serve", { item: "<script>" }, mate.tok)).status, 400);
  const sv = (await sync(cap.tok, me({ name: "선장" }))).deliveries.find((x) => x.kind === "crew_work" && x.payload.duty === "배식");
  assert.equal(sv.payload.items["고등어구이"], 1);

  // 선원 보관함 저장
  assert.equal((await call("/api/crewstate", undefined, mate.tok)).data, null);
  assert.equal((await call("/api/crewstate", { data: '{"bag":{"멸치":2}}' }, mate.tok, "PUT")).status, 200);
  assert.equal((await call("/api/crewstate", undefined, mate.tok)).data, '{"bag":{"멸치":2}}');
});
