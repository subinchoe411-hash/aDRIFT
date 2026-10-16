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
let spare = [];
const join_ = async (name) => {
  // 관리자 API 는 10분에 30번까지라서 초대 코드를 20개씩 받아 두고 쓴다
  if (!spare.length) spare = (await call("/api/admin/invites", { count: 20 })).codes;
  const r = await call("/api/register", { code: spare.pop(), username: name, password: "secret1" });
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
  assert.equal(w.cond, 100, "컨디션 제한은 없다");
  const d = (await sync(cap.tok, me({ name: "선장" }))).deliveries.find((x) => x.kind === "crew_work");
  assert.match(d.payload.fx, /^f:\d+$/);
  assert.equal(d.payload.role, "요리사");
  assert.equal(d.payload.by, "요리왕");
  assert.ok(d.payload.text.includes("요리왕") && !d.payload.text.includes("mate2"), "항해일지 문구에 아이디가 아닌 캐릭터 이름");

  // 새 일들이 모두 동작한다
  for (const duty of ["navigate", "haggle", "dive", "repair", "lookout", "fish"]) {
    const r = await call("/api/crew/duty", { duty }, mate.tok);
    assert.equal(r.status, 200, duty + " " + JSON.stringify(r));
  }
  // 지원(전투 중)도 컨디션 없이 쿨다운만으로 동작한다
  await sync(cap.tok, me({ name: "선장", snap: { bt: { t: "상어", rd: 1, en: [], al: [] } } }));
  for (const kind of ["fire", "mend"]) assert.equal((await call("/api/crew/support", { kind }, mate.tok)).status, 200, kind);
  assert.equal((await call("/api/crew/duty", { duty: "cook" }, mate.tok)).status, 400, "쿨다운 중");

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

test("배 창고: 선장 변화 반영, 선원 넣기·꺼내기, 중복 전송 무시", async () => {
  const cap = await join_("stoc"), mate = await join_("stom");
  await call("/api/crew/invite", { username: "stom" }, cap.tok);
  const inv = (await sync(mate.tok, me({}))).crew.invitesIn[0];
  await call("/api/crew/respond", { id: inv.id, accept: true }, mate.tok);
  // 처음 올리면 선장 화면의 창고가 그대로 서버 창고가 된다
  let r = await sync(cap.tok, me({ name: "선장" }));
  assert.equal(r.sto, undefined);
  r = await call("/api/sync", { me: me({}), sto: { init: { 소금: 3, 쌀: 2 }, seq: 1000, cap: 20 } }, cap.tok);
  assert.deepEqual(r.sto.items, { 소금: 3, 쌀: 2 });
  // 선원은 같은 창고를 본다
  const view = (await sync(mate.tok, me({}))).crew.memberOf.sto;
  assert.deepEqual(view.items, { 소금: 3, 쌀: 2 });
  // 선원이 꺼내고 넣는다
  assert.equal((await call("/api/ship/sto", { k: "소금", n: 2, dir: "take" }, mate.tok)).items["소금"], 1);
  assert.equal((await call("/api/ship/sto", { k: "소금", n: 5, dir: "take" }, mate.tok)).status, 400, "없는 만큼은 못 꺼낸다");
  assert.equal((await call("/api/ship/sto", { k: "멸치", n: 4, dir: "put" }, mate.tok)).items["멸치"], 4);
  assert.equal((await call("/api/ship/sto", { k: "멸치", n: 99, dir: "put" }, mate.tok)).status, 400, "정원 초과");
  assert.equal((await call("/api/ship/sto", { k: "<b>", n: 1, dir: "put" }, mate.tok)).status, 400);
  // 선장 변화(차이)는 선원의 변화 위에 더해지고, 같은 seq 를 다시 보내도 한 번만 적용된다
  const d = { sto: { d: { 쌀: -1, 소금: 2 }, seq: 1001, cap: 20 } };
  r = await call("/api/sync", { me: me({}), ...d }, cap.tok);
  assert.deepEqual(r.sto.items, { 소금: 3, 쌀: 1, 멸치: 4 });
  r = await call("/api/sync", { me: me({}), ...d }, cap.tok);
  assert.deepEqual(r.sto.items, { 소금: 3, 쌀: 1, 멸치: 4 });
  // 탑승 중이 아니면 쓸 수 없다
  const out = await join_("stoo");
  assert.equal((await call("/api/ship/sto", { k: "소금", n: 1, dir: "take" }, out.tok)).status, 400);
  // 동시에 꺼내도 총량보다 많이 나가지 않는다
  const rs = await Promise.all(Array.from({ length: 6 }, () => call("/api/ship/sto", { k: "멸치", n: 1, dir: "take" }, mate.tok)));
  const okN = rs.filter((x) => x.status === 200).length;
  assert.ok(okN <= 4, "ok=" + okN);
  const fin = (await sync(mate.tok, me({}))).crew.memberOf.sto.items["멸치"] || 0;
  assert.equal(fin, 4 - okN);
});

test("장소 채팅: 같은 섬에 있는 사람끼리만", async () => {
  const a = await join_("plca"), b = await join_("plcb"), c = await join_("plcc");
  const at = (n) => me({ loc: "port", isl: n });
  await sync(a.tok, at(3)); await sync(b.tok, at(3)); await sync(c.tok, at(4));
  const ra = await sync(a.tok, at(3));
  assert.equal(ra.place, "place:3");
  assert.equal((await call("/api/chat", { channel: "place:3", text: "안녕" }, a.tok)).status, 200);
  assert.equal((await call("/api/chat", { channel: "place:3", text: "침입" }, c.tok)).status, 403, "다른 섬에서는 못 쓴다");
  await new Promise((r) => setTimeout(r, 1100));
  assert.equal((await call("/api/chat", { channel: "place:99", text: "x" }, a.tok)).status, 403);
  const seen = (r) => (r.chat["place:3"] || []).map((m) => m.text);
  assert.deepEqual(seen(await sync(b.tok, at(3))), ["안녕"]);
  const rc = await sync(c.tok, at(4));
  assert.equal(rc.place, "place:4"); assert.deepEqual(rc.chat["place:3"], undefined);
  const sea = await sync(a.tok, me({ loc: "sea" }));
  assert.equal(sea.place, null);
});

test("선원 월급 받기: 한 번만, 지갑으로 옮겨진다", async () => {
  const cap = await join_("colc"), mate = await join_("colm");
  await call("/api/crew/invite", { username: "colm" }, cap.tok);
  const inv = (await sync(mate.tok, me({}))).crew.invitesIn[0];
  await call("/api/crew/respond", { id: inv.id, accept: true }, mate.tok);
  await call("/api/crew/role", { role: "낚시꾼", name: "수집가" }, mate.tok);
  assert.equal((await call("/api/crew/collect", {}, mate.tok)).status, 400, "월급이 없으면 못 받는다");
  await call("/api/crew/duty", { duty: "fish" }, mate.tok);
  const pu = (await sync(mate.tok, me({}))).crew.me.purse;
  assert.ok(pu > 0, "purse=" + pu);
  const rs = await Promise.all([call("/api/crew/collect", {}, mate.tok), call("/api/crew/collect", {}, mate.tok)]);
  assert.equal(rs.filter((x) => x.status === 200).length, 1, "동시에 눌러도 한 번만");
  assert.equal(rs.find((x) => x.status === 200).gold, pu);
  assert.equal((await sync(mate.tok, me({}))).crew.me.purse, 0);
});

test("병 편지 선물: 주운 사람에게만 한 번", async () => {
  const a = await join_("gifta"), b = await join_("giftb");
  await sync(a.tok, me({}));
  assert.equal((await call("/api/bottle/send", { text: "선물 받아요", gift: { k: "<b>", n: 1 } }, a.tok)).status, 400, "이상한 물건 이름");
  assert.equal((await call("/api/bottle/send", { text: "선물 받아요", gift: { k: "소금", n: 9 } }, a.tok)).status, 200);
  const f = await call("/api/bottle/find", {}, b.tok);
  assert.equal(f.bottle.text, "선물 받아요");
  assert.deepEqual(f.bottle.gift, { k: "소금", n: 3 }, "개수는 최대 3개로 줄어든다");
  assert.equal((await call("/api/bottle/find", {}, b.tok)).bottle, null, "같은 병은 다시 못 줍는다");
});

test("섬 이름: 그 섬에 닿은 사람만, 한 섬에 한 번만, 바뀐 때만 목록이 온다", async () => {
  const a = await join_("isna"), b = await join_("isnb"), far = await join_("isnc");
  const at = (n) => me({ loc: "port", isl: n });
  await sync(a.tok, at(7)); await sync(b.tok, at(7)); await sync(far.tok, me({ loc: "sea" }));
  assert.equal((await call("/api/island/name", { isl: 7, name: "푸른 만" }, far.tok)).status, 400, "바다에 있으면 안 된다");
  assert.equal((await call("/api/island/name", { isl: 7, name: "<b>" }, a.tok)).status, 400, "이름 형식");
  assert.equal((await call("/api/island/name", { isl: 7, name: "푸른 만" }, a.tok)).status, 200);
  assert.equal((await call("/api/island/name", { isl: 7, name: "붉은 만" }, b.tok)).status, 400, "이미 이름이 있다");
  const s1 = await call("/api/sync", { me: at(7), isnv: "0" }, b.tok);
  assert.equal(s1.isn.list.find((x) => x.isl === 7).name, "푸른 만");
  assert.match(s1.isn.list.find((x) => x.isl === 7).uname, /선장/);
  const s2 = await call("/api/sync", { me: at(7), isnv: s1.isn.v }, b.tok);
  assert.equal(s2.isn, undefined, "같은 버전이면 목록을 다시 보내지 않는다");
});

test("주간 보스: 피해 합산, 쓰러뜨리면 참여자가 한 번씩 보상", async () => {
  const a = await join_("bossa"), b = await join_("bossb"), c = await join_("bossc");
  const st0 = await call("/api/boss", undefined, a.tok);
  assert.equal(st0.hp, 3000); assert.ok(st0.name);
  assert.equal((await call("/api/boss/hit", { dmg: 9999 }, a.tok)).dmg, 400, "한 번에 최대 400");
  assert.equal((await call("/api/boss/hit", { dmg: 10 }, a.tok)).status, 429, "15초에 한 번");
  assert.equal((await call("/api/boss/hit", { dmg: 100 }, b.tok)).dmg, 500, "서로의 피해가 합산");
  assert.equal((await call("/api/boss/claim", {}, a.tok)).status, 400, "쓰러지기 전엔 보상 없음");
  // 쓰러질 때까지 (서로 다른 사람이 번갈아, 속도 제한을 피해 여러 계정 사용)
  const users = [a, b, c];
  for (let i = 0; i < 12 && !(await call("/api/boss", undefined, a.tok)).done; i++) {
    const u = await join_("bossx" + i);
    users.push(u);
    await call("/api/boss/hit", { dmg: 400 }, u.tok);
  }
  const fin = await call("/api/boss", undefined, a.tok);
  assert.equal(fin.done, true); assert.equal(fin.dmg, 3000, "남은 체력까지만 합산");
  const late = await join_("bossy"); assert.equal((await call("/api/boss/hit", { dmg: 50 }, late.tok)).status, 400, "이미 쓰러짐");
  assert.equal((await call("/api/boss/claim", {}, c.tok)).status, 400, "참여하지 않으면 보상 없음");
  const rs = await Promise.all([call("/api/boss/claim", {}, a.tok), call("/api/boss/claim", {}, a.tok)]);
  assert.equal(rs.filter((x) => x.status === 200).length, 1, "동시에 눌러도 한 번만");
  const d = (await sync(a.tok, me({}))).deliveries.find((x) => x.kind === "boss_reward");
  assert.ok(d && d.payload.gold >= 200 && Object.keys(d.payload.items).length === 1);
});

test("선단: 만들기·초대·수락, 서로의 위치가 멀어도 보이고, 선단 채팅은 구성원만", async () => {
  const a = await join_("flta"), b = await join_("fltb"), c = await join_("fltc");
  await sync(a.tok, me({ name: "가", x: 5, y: 5 })); await sync(b.tok, me({ name: "나", x: 50, y: 35 })); await sync(c.tok, me({ name: "다", x: 20, y: 20 }));
  assert.equal((await call("/api/fleet/create", { name: "<b>" }, a.tok)).status, 400);
  assert.equal((await call("/api/fleet/invite", { username: "fltb" }, a.tok)).status, 400, "선단이 없으면 초대 못 함");
  assert.equal((await call("/api/fleet/create", { name: "푸른 돛" }, a.tok)).status, 200);
  assert.equal((await call("/api/fleet/create", { name: "또 하나" }, a.tok)).status, 400, "이미 선단에 있음");
  assert.equal((await call("/api/fleet/invite", { username: "fltb" }, a.tok)).status, 200);
  assert.equal((await call("/api/fleet/invite", { username: "fltb" }, a.tok)).status, 400, "중복 초대");
  const sb = await sync(b.tok, me({ name: "나", x: 50, y: 35 }));
  assert.equal(sb.fleet.invites[0].fleet, "푸른 돛");
  assert.equal((await call("/api/fleet/respond", { id: sb.fleet.invites[0].id, accept: true }, b.tok)).status, 200);
  const sa = await sync(a.tok, me({ name: "가", x: 5, y: 5 }));
  assert.equal(sa.fleet.mine.members.length, 2);
  const mb = sa.fleet.mine.members.find((m) => m.user === "fltb");
  assert.equal(mb.x, 50, "멀리 있어도 위치가 보인다");
  assert.ok(sa.chat["fleet:" + sa.fleet.mine.id], "선단 채팅 채널");
  const fid = sa.fleet.mine.id;
  assert.equal((await call("/api/chat", { channel: "fleet:" + fid, text: "다들 모여라" }, a.tok)).status, 200);
  assert.equal((await call("/api/chat", { channel: "fleet:" + fid, text: "나도 끼자" }, c.tok)).status, 403, "구성원이 아니면 못 쓴다");
  await new Promise((r) => setTimeout(r, 1100));
  const sb2 = await sync(b.tok, me({ name: "나", x: 50, y: 35 }));
  assert.ok(sb2.chat["fleet:" + fid].some((m) => m.text === "다들 모여라"));
  assert.equal((await sync(c.tok, me({ name: "다" }))).fleet.mine, null, "다른 사람에겐 안 보인다");
  // 선단장이 나가면 남은 사람이 이어받는다
  assert.equal((await call("/api/fleet/leave", {}, a.tok)).status, 200);
  assert.equal((await sync(b.tok, me({ name: "나" }))).fleet.mine.owner, b.id);
  assert.equal((await call("/api/fleet/leave", {}, b.tok)).status, 200);
  assert.equal((await call("/api/fleet/leave", {}, b.tok)).status, 400);
});
