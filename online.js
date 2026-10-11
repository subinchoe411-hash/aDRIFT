/* 표류여행 온라인: 서버가 있으면 로그인 → 마주침(인사·거래) · 병 편지 · 채팅 · 선원 시점.
   서버가 없으면(정적 호스팅) 아무것도 하지 않고 기존 혼자 하기 그대로 돌아간다. */
(()=>{
"use strict";
const TOK="adrift:tok";
const O=window.Online={on:false,user:null,data:null,off:0,crewMode:false};
let tok="";try{tok=localStorage.getItem(TOK)||""}catch(e){}
const ST=(k,v)=>{try{v==null?localStorage.removeItem(k):localStorage.setItem(k,v)}catch(e){}};
const gameOn=()=>typeof S!=="undefined"&&!!S&&!S.over&&!$("game").hidden;
const srvNow=()=>Date.now()+O.off;
const plain=h=>String(h).replace(/<[^>]*>/g," ").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/\s+/g," ").trim().slice(0,100);

async function api(path,body,method){
  const r=await fetch("/api"+path,{method:method||(body===undefined?"GET":"POST"),headers:{"content-type":"application/json",...(tok?{authorization:"Bearer "+tok}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  let j=null;try{j=await r.json()}catch(e){}
  if(!j||typeof j!=="object"){const er=new Error("서버 응답이 올바르지 않습니다.");er.status=r.status;throw er}
  if(!r.ok){const er=new Error(j.error||"요청에 실패했습니다.");er.status=r.status;if(r.status===401&&tok&&path!=="/login"&&path!=="/register")sessionLost();throw er}
  return j}
O.api=api;
function sessionLost(){tok="";ST(TOK);O.on=false;O.user=null;showAuth("로그인이 만료되었습니다. 다시 로그인해 주세요.")}

/* ================= 로그인 / 가입 ================= */
function authBox(){let e=$("auth");if(e)return e;e=document.createElement("div");e.id="auth";e.className="ov";document.body.appendChild(e);return e}
function showAuth(msg,tab){
  const e=authBox(),reg=tab==="reg";e.hidden=false;
  e.innerHTML=`<div style="max-width:340px;width:100%;text-align:left">
   <h1 style="text-align:center">표류여행</h1>
   <div class="subtabs" style="justify-content:center"><button class="${reg?"":"on"}" onclick="Online.authTab('login')">로그인</button><button class="${reg?"on":""}" onclick="Online.authTab('reg')">초대 코드로 가입</button></div>
   ${reg?`<label class="sm sub">초대 코드</label><input id="a-code" placeholder="XXXX-XXXX-XXXX" style="width:100%;margin-bottom:8px;text-transform:uppercase" autocomplete="off">`:""}
   <label class="sm sub">아이디</label><input id="a-user" maxlength="16" style="width:100%;margin-bottom:8px" autocomplete="username">
   <label class="sm sub">비밀번호${reg?" (6자 이상)":""}</label><input id="a-pw" type="password" maxlength="72" style="width:100%;margin-bottom:8px" autocomplete="${reg?"new-password":"current-password"}">
   <div id="a-msg" class="sm" style="color:var(--warn);min-height:18px">${esc(msg||"")}</div>
   <button class="pri" onclick="Online.authGo(${reg})" style="width:100%;margin-top:6px">${reg?"계정 만들기":"들어가기"}</button>
   <div style="text-align:center;margin-top:14px"><a onclick="Online.offline()">혼자서 오프라인으로 하기 (온라인 기능 없음)</a></div></div>`;
  const f=e.querySelector("#a-pw");if(f)f.onkeydown=ev=>{if(ev.key==="Enter")O.authGo(reg)}}
O.authTab=t=>showAuth("",t);
O.offline=()=>{$("auth").hidden=true;O.on=false};
O.authGo=async reg=>{
  const g=i=>{const x=$(i);return x?x.value:""},m=$("a-msg");m.textContent="";
  try{
    const r=await api(reg?"/register":"/login",reg?{code:g("a-code"),username:g("a-user"),password:g("a-pw")}:{username:g("a-user"),password:g("a-pw")});
    tok=r.token;ST(TOK,tok);await loggedIn(r.user)}
  catch(e){m.textContent=e.message}};
O.logout=async()=>{try{await api("/logout",{})}catch(e){}tok="";ST(TOK);location.reload()};

async function loggedIn(user){
  O.user=user;O.on=true;window.ONLINE_UID=user.id;$("auth")&&($("auth").hidden=true);
  await cloudPull();renderTitle();schedule(0)}

/* ================= 클라우드 저장 ================= */
let cloudDirty=false,cloudAt=0;
async function cloudPull(){
  try{const r=await api("/save");if(!r.data)return;const d=JSON.parse(r.data);if(!d||d.seed!==WORLD.seed)return;
    const loc=peekSave();if(!loc||(d.at||0)>(loc.at||0)+1000){localStorage.setItem(SAVE_KEY(),r.data);localStorage.setItem(SAVE_KEY()+":sum",chk32(r.data))}}catch(e){}}
async function cloudPush(){
  if(!O.on||!cloudDirty)return;cloudDirty=false;
  try{const raw=localStorage.getItem(SAVE_KEY());if(raw&&raw.length<1.2e6){await api("/save",{data:raw},"PUT");cloudAt=Date.now()}}catch(e){cloudDirty=true}}
O.clearCloud=()=>{if(O.on&&tok)fetch("/api/save",{method:"PUT",keepalive:true,headers:{"content-type":"application/json",authorization:"Bearer "+tok},body:JSON.stringify({data:""})}).catch(()=>{})};
setInterval(()=>{if(cloudDirty&&Date.now()-cloudAt>120000)cloudPush()},15000);
document.addEventListener("visibilitychange",()=>{if(document.hidden)cloudPush()});

/* ================= 동기화 ================= */
let timer=0,since={},busy=false;
function schedule(ms){clearTimeout(timer);timer=setTimeout(()=>sync(),ms==null?(document.hidden?30000:5000):ms)}
O.syncNow=()=>schedule(0);
function myState(){
  const loc=S.inC?"city":(S.isl!==null||S.dk>=0)?"port":"sea",isl=S.isl!==null?S.isl:S.dk;
  return {name:C.name,ship:SH[S.lv].n,lv:S.lv,x:S.x,y:S.y,hd:S.hd,loc,isl:loc==="port"?isl:-1,
    snap:{h:Math.round(S.hull),hm:hm(),f:Math.round(S.hun),p:Math.round(S.hp),pm:hpm(),d:Math.floor(S.t/1440)+1,sail:!!S.sail,
      wl:wlabel(),kn:Math.round(kn()*10)/10,in:loc==="port"&&I[isl]?I[isl].n:"",seen:[...S.seen].slice(0,100),logs:S.logs.slice(0,6).map(plain)}}}
async function sync(){
  if(!O.on||!tok||busy)return;busy=true;let ok=false;
  try{
    const active=gameOn();
    const r=await api("/sync",{me:active?myState():undefined,since});
    O.data=r;O.off=r.now-Date.now();ok=true;
    for(const ch in r.chat){const a=r.chat[ch];if(a.length)since[ch]=a[a.length-1].id;chatAdd(ch,a)}
    if(active)await takeDeliveries(r.deliveries);
    noticeNearby(r);renderDock();renderCrewUI();if(!active&&!O.crewMode&&!$("title").hidden)decorateTitle()
  }catch(e){}
  busy=false;schedule()}

/* ================= 우편함 적용 ================= */
const fmtB=b=>[b.gold?`골드 ${b.gold}`:"",...Object.entries(b.items||{}).map(([k,v])=>`${esc(k)} ${v}`)].filter(Boolean).join(", ")||"없음";
function gain(b){
  if(b.gold>0)S.gold+=Math.floor(b.gold);
  for(const k in (b.items||{})){if(knownItem(k)){const n=Math.floor(+b.items[k]);if(n>0&&n<=99)add(k,n)}}}
function take(b){
  let full=true;if(b.gold>0){if(S.gold<b.gold)full=false;S.gold=Math.max(0,S.gold-b.gold)}
  for(const k in (b.items||{})){let n=b.items[k];for(const box of [S.inv,S.sto]){const t=Math.min(n,box[k]||0);if(t>0){box[k]-=t;n-=t;if(box[k]<=0)delete box[k]}}if(n>0)full=false}
  return full}
const avail=k=>Math.max(0,(S.inv[k]||0)-(S.eq&&(S.eq.w===k||S.eq.a===k)?1:0));
const canPay=b=>S.gold>=(b.gold||0)&&Object.entries(b.items||{}).every(([k,n])=>(S.inv[k]||0)+(S.sto[k]||0)>=n);
const FXOK=/^[fhsq]:-?\d{1,2}$/;
async function takeDeliveries(list){
  if(!list||!list.length)return;
  const got=(await api("/claim",{ids:list.map(d=>d.id)})).deliveries;
  for(const d of got)applyOne(d);
  if(got.length){renderAll();saveGame()}}
function applyOne(d){
  const p=d.payload||{};
  try{
  switch(d.kind){
  case "greet":say(`👋 <b>${esc(p.name)}</b>(${esc(p.ship)}): “${esc(p.text)}”`);break;
  case "trade_done":{const paid=take(p.cost||{gold:0,items:{}});gain(p.gain||{gold:0,items:{}});
    say(`🤝 ${esc(p.with)}와(과)의 거래가 성사되었다. 받은 것: ${fmtB(p.gain||{})}${(p.cost&&(p.cost.gold||Object.keys(p.cost.items||{}).length))?` / 건넨 것: ${fmtB(p.cost)}`:""}${paid?"":" (내놓을 것이 모자라 있는 만큼만 건넸다)"}`);break}
  case "trade_refund":gain(p.gain||{});say(`🤝 ${esc(p.why||"거래가 취소되었다")}. 맡겨 둔 ${fmtB(p.gain||{})}이(가) 돌아왔다.`);break;
  case "purse":S.gold+=Math.floor(+p.gold||0);say(`💰 선원 월급 ${Math.floor(+p.gold||0)}G를 찾았다.`);break;
  case "bottle_found":{const b=S.out.find(x=>x.srv&&!x.r);if(b)b.r=1;say("🍾 누군가 당신의 병 편지를 주웠다!");break}
  case "bottle_reply":S.mail.unshift({from:cleanStr(p.from,30),text:cleanStr(p.text,80),t:clock(),re:cleanStr(p.re,80)});S.mail.length=Math.min(S.mail.length,40);
    say(`✉ ${esc(p.from)}의 답장: “${esc(p.text)}”`);break;
  case "crew_work":{let r="";const parts=[];
    if(p.items)for(const k in p.items){if(knownItem(k)){add(k,Math.min(9,Math.floor(+p.items[k])||0));parts.push(`${esc(k)} ${p.items[k]}`)}}
    if(p.fx&&FXOK.test(p.fx)){r=fx(p.fx);if(S.hull>hm())S.hull=hm()}
    say(`⚓ 선원 <b>${esc(p.by)}</b>(${esc(p.duty)}): ${esc(p.text)} ${parts.join(", ")} ${r}`);break}
  }}catch(e){}}

/* ================= 마주침 패널 ================= */
const GREET=["안녕하세요!","순풍을 빌어요.","좋은 항해 되세요!","거래하실래요?","함께 항해해요!"];
let prevNear=new Set(),dockOpen=false,nearSig="";
function dock(){let e=$("olb");if(e)return e;
  e=document.createElement("div");e.id="olb";e.hidden=true;
  e.style.cssText="position:fixed;right:12px;bottom:12px;z-index:9;max-width:94vw";
  e.innerHTML=`<div id="olp" class="card" hidden style="background:var(--bg);width:min(380px,94vw);max-height:68vh;overflow:auto;margin-bottom:8px;text-align:left"></div><div style="text-align:right"><button id="olbtn" class="pri" onclick="Online.toggleDock()" style="background:var(--bg);margin:0"></button></div>`;
  document.body.appendChild(e);return e}
O.toggleDock=()=>{dockOpen=!dockOpen;nearSig="";renderDock()};
function noticeNearby(r){
  if(!gameOn())return;const ids=new Set(r.nearby.map(n=>n.id));
  for(const n of r.nearby)if(!prevNear.has(n.id))say(`⛵ 다른 배가 가까이 있다: <b>${esc(n.name)}</b>의 ${esc(n.ship)}. (오른쪽 아래 '바다 위의 사람들'에서 인사·거래)`);
  prevNear=ids}
const dirs=["북","북동","동","남동","남","남서","서","북서"];
function whereTxt(n){if(n.loc==="port")return "같은 부두";const dx=dl(n.x-S.x,WW),dy=dl(n.y-S.y,WH),a=(Math.atan2(dx,-dy)*180/Math.PI+360)%360;return `${dirs[Math.round(a/45)%8]}쪽 ${n.d}해리`}
function renderDock(){
  const d=dock(),on=O.on&&gameOn()&&O.data;d.hidden=!on;if(!on)return;
  const r=O.data,inT=r.trades.incoming.length,inv=r.crew.invitesIn.length,badge=r.nearby.length+inT+inv;
  $("olbtn").textContent=`⚓ 바다 위의 사람들${badge?` (${badge})`:""}`;
  $("olp").hidden=!dockOpen;if(!dockOpen)return;
  const sig=JSON.stringify([r.nearby.map(n=>[n.id,n.loc]),r.trades,r.crew.captainOf,r.crew.invitesIn,r.crew.invitesOut,r.crew.me&&r.crew.me.purse]);
  if(sig===nearSig){document.querySelectorAll("#olp [data-w]").forEach(e=>{const n=r.nearby.find(x=>x.id===+e.dataset.w);if(n)e.textContent=whereTxt(n)});return}
  nearSig=sig;
  const gs=id=>`<select onchange="Online.greetSel(${id},this)"><option value="">인사하기…</option>${GREET.map(g=>`<option>${esc(g)}</option>`).join("")}<option value="__c">직접 쓰기…</option></select>`;
  let h=`<h2 style="margin-top:0">마주친 배</h2>`+(r.nearby.length?r.nearby.map(n=>`<div class="seat"><b>${esc(n.name)}</b> <span class="sub sm">${esc(n.ship)} · <span data-w="${n.id}">${whereTxt(n)}</span></span><div style="margin-top:6px">${gs(n.id)} <button onclick="Online.openTrade(${n.id})">거래 제안</button></div></div>`).join(""):`<div class="sub sm">가까이에 다른 배가 없다. 같은 바다에서 서로 가까워지거나, 같은 부두에 닿으면 만날 수 있다.</div>`);
  if(inT||r.trades.outgoing.length){h+=`<h2>거래</h2>`;
    h+=r.trades.incoming.map(t=>{const can=canPay(t.want);return `<div class="seat"><b>${esc(t.name)}</b>이(가) 제안한다<div class="sm">받는 것: ${fmtB(t.give)}<br>줄 것: ${fmtB(t.want)}</div><div style="margin-top:6px"><button class="pri" ${can?"":"disabled"} onclick="Online.accept(${t.id})">수락</button><button onclick="Online.decline(${t.id})">거절</button>${can?"":`<span class="sub sm">줄 것이 모자라다</span>`}</div></div>`}).join("");
    h+=r.trades.outgoing.map(t=>`<div class="seat sub">→ <b>${esc(t.name)}</b>에게 제안 중<div class="sm">내놓은 것: ${fmtB(t.give)} / 원하는 것: ${fmtB(t.want)}</div><button onclick="Online.cancelTrade(${t.id})">제안 거두기</button></div>`).join("")}
  h+=`<h2>내 선원</h2>`+(r.crew.captainOf.length?r.crew.captainOf.map(m=>`<div class="row"><span>${m.online?"● ":"○ "}${esc(m.name)}</span><a onclick="Online.dismiss(${m.id})">내리게 하기</a></div>`).join(""):`<div class="sub sm">선원이 없다. 친구를 초대하면 그 사람이 내 배의 선원으로 낚시·요리·망보기·수리를 거든다.</div>`)
   +r.crew.invitesOut.map(i=>`<div class="row sub sm"><span>초대 중: ${esc(i.memberName)}</span><a onclick="Online.cancelInvite(${i.id})">취소</a></div>`).join("")
   +`<div class="row" style="margin-top:6px"><input id="ci-name" placeholder="초대할 아이디" maxlength="16" style="flex:1;min-width:0" list="ci-dl"><datalist id="ci-dl">${r.roster.map(x=>`<option value="${esc(x.username)}">`).join("")}</datalist><button onclick="Online.invite()">초대</button></div>`;
  if(inv)h+=`<h2>선원 제안</h2>`+r.crew.invitesIn.map(i=>`<div class="seat"><b>${esc(i.captainName)}</b> 선장이 배에 타 달라고 한다.<div style="margin-top:6px"><button class="pri" onclick="Online.respond(${i.id},true)">수락</button><button onclick="Online.respond(${i.id},false)">거절</button></div><div class="sub sm">수락하면 타이틀 화면에서 '선원으로 탑승'할 수 있다.</div></div>`).join("");
  const pu=r.crew.me?r.crew.me.purse:0;if(pu>0)h+=`<h2>선원 월급</h2><div class="row"><span>${pu}G가 쌓여 있다</span><button onclick="Online.withdraw()">내 항해로 찾기</button></div>`;
  $("olp").innerHTML=h}
const doit=async(fn,after)=>{try{await fn();after&&after()}catch(e){if(gameOn())say("⚠ "+esc(e.message));else toast(e.message)}O.syncNow()};
O.greetSel=(id,sel)=>{let t=sel.value;sel.selectedIndex=0;if(!t)return;if(t==="__c"){t=prompt("건넬 인사 (40자)","");if(!t)return}
  doit(()=>api("/greet",{to:id,text:String(t).slice(0,40)}),()=>say("👋 인사를 건넸다."))};
O.decline=id=>doit(()=>api("/trade/decline",{id}));
O.cancelTrade=id=>doit(()=>api("/trade/cancel",{id}));
O.accept=id=>{const t=O.data.trades.incoming.find(x=>x.id===id);if(!t||!canPay(t.want))return;doit(()=>api("/trade/accept",{id}))};
O.invite=()=>{const u=$("ci-name").value.trim();if(u)doit(()=>api("/crew/invite",{username:u}),()=>say(`⚓ ${esc(u)}에게 선원 제안을 보냈다.`))};
O.cancelInvite=id=>doit(()=>api("/crew/cancel",{id}));
O.dismiss=id=>{if(confirm("이 선원을 배에서 내리게 할까요?"))doit(()=>api("/crew/dismiss",{id}))};
O.respond=(id,accept)=>doit(()=>api("/crew/respond",{id,accept}),()=>{if(accept&&gameOn())say("⚓ 선원 제안을 받아들였다. 타이틀 화면에서 선원으로 탑승할 수 있다.")});
O.withdraw=()=>doit(()=>api("/crew/withdraw",{}));

/* ---- 거래 제안 창 ---- */
O.openTrade=to=>{
  const n=O.data.nearby.find(x=>x.id===to);if(!n)return;knownItem("");
  const names=[...ITEMSET].filter(k=>/^[가-힣A-Za-z0-9 ·'-]{1,16}$/.test(k)).sort();
  const mine=Object.keys(S.inv).filter(k=>avail(k)>0).sort();
  let m=$("trm");if(m)m.remove();m=document.createElement("div");m.id="trm";m.className="modal";
  m.innerHTML=`<div class="card" style="width:min(560px,94vw);max-height:90vh;overflow:auto;text-align:left"><h2 style="margin-top:0">${esc(n.name)}와(과) 거래</h2>
   <div class="two"><div><div class="gt">내가 줄 것</div>
    <div class="row"><span>골드 <span class="sub sm">(보유 ${S.gold})</span></span><input id="tg-g" type="number" min="0" max="${S.gold}" value="0" style="width:90px"></div>
    ${mine.length?mine.map(k=>`<div class="row"><span>${esc(k)} <span class="sub sm">×${avail(k)}</span></span><input class="tg-i" data-k="${esc(k)}" type="number" min="0" max="${avail(k)}" value="0" style="width:64px"></div>`).join(""):`<div class="sub sm">소지품이 없다. (창고의 물건은 소지품으로 옮겨야 한다)</div>`}</div>
   <div><div class="gt">받고 싶은 것</div>
    <div class="row"><span>골드</span><input id="tw-g" type="number" min="0" value="0" style="width:90px"></div>
    ${[0,1,2].map(()=>`<div class="row"><input class="tw-n" list="tw-dl" placeholder="품목 이름" style="flex:1;min-width:0"><input class="tw-q" type="number" min="1" max="99" value="1" style="width:64px"></div>`).join("")}
    <datalist id="tw-dl">${names.map(k=>`<option value="${esc(k)}">`).join("")}</datalist></div></div>
   <div class="sub sm" style="margin:8px 0">제안한 물건은 맡겨지고(소지품에서 빠진다), 상대가 30분 안에 받아들이면 교환된다. 거절·취소·만료되면 돌려받는다. 내놓을 것 없이 받기만 원하면 부탁, 받을 것 없이 주기만 하면 선물이 된다.</div>
   <div id="tr-msg" class="sm" style="color:var(--warn);min-height:18px"></div>
   <button class="pri" onclick="Online.sendTrade(${to})">제안하기</button><button onclick="$('trm').remove()">닫기</button></div>`;
  document.body.appendChild(m)};
O.sendTrade=async to=>{
  const msg=$("tr-msg"),give={gold:Math.max(0,Math.floor(+$("tg-g").value)||0),items:{}},want={gold:Math.max(0,Math.floor(+$("tw-g").value)||0),items:{}};
  document.querySelectorAll(".tg-i").forEach(e=>{const n=Math.floor(+e.value)||0;if(n>0)give.items[e.dataset.k]=Math.min(n,avail(e.dataset.k))});
  const ws=[...document.querySelectorAll(".tw-n")],wq=[...document.querySelectorAll(".tw-q")];
  ws.forEach((e,i)=>{const k=e.value.trim();if(k){if(!knownItem(k)){msg.textContent=`'${k}'은(는) 이 세계에 없는 물건이다.`;want.bad=1;return}want.items[k]=(want.items[k]||0)+Math.max(1,Math.min(99,Math.floor(+wq[i].value)||1))}});
  if(want.bad)return;
  if(!canPay(give)||give.gold>S.gold){msg.textContent="내놓을 것이 모자라다.";return}
  if(Object.keys(give.items).length>5||Object.keys(want.items).length>5){msg.textContent="품목은 5개까지.";return}
  take(give);renderAll(); // 맡기는 순간 소지품에서 뺀다
  try{await api("/trade/offer",{to,give,want});$("trm")&&$("trm").remove();say(`🤝 거래를 제안했다. 내놓은 것: ${fmtB(give)} / 원하는 것: ${fmtB(want)}`);saveGame()}
  catch(e){gain(give);renderAll();msg.textContent=e.message}
  O.syncNow()};

/* ================= 병 편지 ================= */
O.sendBottle=async text=>{try{await api("/bottle/send",{text})}catch(e){const b=S.out.find(x=>x.srv&&!x.r&&x.text===text);if(b)b.srv=0;say("(서버에 띄우지 못했다: "+esc(e.message)+" — 이 병은 파도가 알아서 데려간다)")}};
O.pickBottle=async()=>{
  try{const r=await api("/bottle/find",{});
    if(r.bottle){S.mail.unshift({from:cleanStr(r.bottle.from,30),text:cleanStr(r.bottle.text,80),t:clock(),bid:r.bottle.id});S.mail.length=Math.min(S.mail.length,40);
      say(`✉ 누군가 띄운 병이다. <b>${esc(r.bottle.from)}</b>: “${esc(r.bottle.text)}” (선장실에서 답장할 수 있다)`);renderAll();return}}catch(e){}
  const bb=pick(BOT);S.mail.unshift({from:bb[0],text:bb[1],t:clock()});S.mail.length=Math.min(S.mail.length,40);
  say(`✉ ${esc(bb[0])}: “${esc(bb[1])}” ${bb[2]?fx(bb[2]):""}`);renderAll()};
O.reply=async bid=>{
  const t=prompt("답장 (60자)","");if(!t)return;const m=S.mail.find(x=>x.bid===bid);
  try{await api("/bottle/reply",{id:bid,text:t.slice(0,60)});if(m)m.rp=1;say("✉ 답장을 병에 담아 바다에 띄웠다.");renderAll();saveGame()}catch(e){say("⚠ "+esc(e.message))}};

/* ================= 채팅 ================= */
const CH={world:[]};let curCh="world";const unread={};
function chName(ch){return ch==="world"?"월드":"선원"}
function chatAdd(ch,list){
  const a=CH[ch]||(CH[ch]=[]);
  for(const m of list){if(!a.some(x=>x.id===m.id)){a.push(m);if(ch!==curCh)unread[ch]=1}}
  a.splice(0,Math.max(0,a.length-60));renderChat()}
function myCrewCh(){const r=O.data;if(!r)return null;return r.crew.memberOf?"crew:"+r.crew.memberOf.captainId:(r.crew.captainOf.length?"crew:"+O.user.id:null)}
function renderChat(){
  const box=$("chl");if(!box||!O.on)return;
  const cc=myCrewCh();if(curCh!=="world"&&curCh!==cc)curCh="world";
  const h=$("chh");if(h){h.innerHTML=`채팅 <span style="font-weight:400">`+[["world",1],[cc,!!cc]].filter(x=>x[1]).map(([c])=>`<a onclick="Online.setCh('${c}')" style="${c===curCh?"font-weight:700":""}">${chName(c)}${unread[c]?" ●":""}</a>`).join("")+`</span>`}
  const list=(CH[curCh]||[]).slice().reverse();
  box.innerHTML=list.map(m=>`<div>[${esc(m.name)}] ${esc(m.text)}</div>`).join("")||`<div>(아직 아무도 말하지 않았다)</div>`}
O.setCh=c=>{curCh=c;unread[c]=0;renderChat()};
function chatSend(text){
  if(!text)return;const ch=curCh;
  api("/chat",{channel:ch,text}).then(()=>O.syncNow()).catch(e=>{const a=CH[ch]||(CH[ch]=[]);a.push({id:-Date.now(),name:"안내",text:e.message});renderChat()})}
function hookChat(){
  const ct=$("ct"),orig=ct.onkeydown;
  ct.onkeydown=e=>{if(!O.on)return orig&&orig(e);if(e.key!=="Enter")return;const t=cleanStr(ct.value,80).trim();if(!t)return;ct.value="";chatSend(t)};
  const hh=ct.closest(".card")&&ct.closest(".card").querySelector("h2");if(hh)hh.id="chh"}

/* ================= 세이브/게임 훅 ================= */
function hookGame(){
  const sg=window.saveGame;window.saveGame=function(){const r=sg.apply(this,arguments);if(r&&O.on)cloudDirty=true;return r};
  const eg=window.endGame;window.endGame=function(){const r=eg.apply(this,arguments);O.clearCloud();return r};
  const rt=window.renderTitle;window.renderTitle=function(){rt.apply(this,arguments);decorateTitle()};
  const ms=window.manualSave;window.manualSave=function(){ms.apply(this,arguments);if(O.on){cloudDirty=true;cloudPush()}};
  const ng=window.startGame;window.startGame=function(){O.crewMode=false;const r=ng.apply(this,arguments);schedule(0);return r};
  const rs=window.resume;window.resume=function(){O.crewMode=false;const r=rs.apply(this,arguments);schedule(0);return r}}

/* ================= 타이틀 ================= */
function toast(t){const b=$("tbtn");if(!b)return;let e=$("olt-m");if(!e){e=document.createElement("div");e.id="olt-m";e.className="sm";e.style.color="var(--warn)";b.after(e)}e.textContent=t}
function decorateTitle(){
  const b=$("tbtn");if(!b||!O.on||!O.user)return;let e=$("olt");
  if(!e){e=document.createElement("div");e.id="olt";e.style.cssText="margin-top:18px;border-top:1px solid var(--line);padding-top:12px";b.after(e)}
  const r=O.data,c=r&&r.crew;let h=`<div class="sm"><b>${esc(O.user.username)}</b> 님으로 접속 중 · 저장은 계정에 보관됩니다 <a onclick="Online.logout()">로그아웃</a></div>`;
  if(c&&c.memberOf)h+=`<div style="margin-top:10px"><button class="pri" onclick="Online.enterCrew()" style="padding:8px 22px">⚓ 선원으로 탑승 — ${esc(c.memberOf.captain)} 선장의 ${esc(c.memberOf.ship?c.memberOf.ship.ship:"배")}</button></div>`;
  if(c&&c.invitesIn.length)h+=c.invitesIn.map(i=>`<div class="sm" style="margin-top:8px"><b>${esc(i.captainName)}</b> 선장이 선원으로 초대했습니다. <button class="pri" onclick="Online.respond(${i.id},true)">수락</button><button onclick="Online.respond(${i.id},false)">거절</button></div>`).join("");
  if(c&&c.me&&c.me.purse>0)h+=`<div class="sm sub" style="margin-top:8px">선원 월급 ${c.me.purse}G가 쌓여 있습니다. 내 항해를 시작하면 '바다 위의 사람들'에서 찾을 수 있습니다.</div>`;
  e.innerHTML=h}

/* ================= 선원 시점 ================= */
const DUTY=[["fish","🎣 낚시","선장의 창고로 생선을 올려 보낸다 (75초)"],["cook","🍲 식사 준비","선장의 허기를 달랜다 (2분)"],["lookout","🔭 망보기","선장의 해도에 새 섬이나 ? 표시가 뜬다 (2분)"],["repair","🔨 선체 수리","배의 선체를 조금 고친다 (2분30초)"]];
let crewLog=[],crewTick=0,worldDrawn=false;
function crewBox(){let e=$("crewv");if(e)return e;e=document.createElement("div");e.id="crewv";e.className="scr";e.hidden=true;e.style.maxWidth="900px";document.body.appendChild(e);return e}
O.enterCrew=()=>{
  O.crewMode=true;["title","create","game"].forEach(x=>$(x).hidden=true);
  if(!worldDrawn){try{genWorld();worldDrawn=true}catch(e){}}
  crewBox().hidden=false;crewLog=[];renderCrewUI();clearInterval(crewTick);crewTick=setInterval(()=>renderCrewTimers(),1000);schedule(0)};
O.exitCrew=()=>{O.crewMode=false;clearInterval(crewTick);crewBox().hidden=true;worldDrawn=false;show("title");renderTitle()};
O.leaveShip=()=>{if(confirm("이 배에서 내릴까요? 쌓인 월급은 그대로 남습니다."))api("/crew/leave",{}).then(()=>{O.exitCrew();schedule(0)}).catch(e=>toast(e.message))};
O.duty=async k=>{try{const r=await api("/crew/duty",{duty:k});crewLog.unshift(`${new Date().toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit"})} ${r.msg}${r.wage?` (월급 +${r.wage}G)`:""}`);crewLog.length=Math.min(8,crewLog.length)}catch(e){crewLog.unshift("⚠ "+e.message)}schedule(0);renderCrewUI()};
const pct=(v,m)=>Math.max(0,Math.min(100,Math.round(100*v/Math.max(1,m))));
const bar=(v,m,col)=>`<div class="bar" style="background:var(--hi);margin:2px 0 8px"><i style="display:block;height:100%;width:${pct(v,m)}%;background:${col||"var(--acc)"}"></i></div>`;
function crewMap(sh){
  if(typeof I==="undefined"||!I.length)return "";const seen=new Set((sh.snap&&sh.snap.seen)||[]);
  let s=`<svg viewBox="0 0 ${WW*K} ${WH*K}" style="cursor:default"><rect width="${WW*K}" height="${WH*K}" fill="var(--sh)" stroke="none"/>`;
  I.forEach((w,i)=>{if(seen.has(i)||i===0)s+=`<path d="${w.p}" fill="var(--land)" stroke="var(--sub)" stroke-width="1.5"/>`});
  s+=`<g transform="translate(${sh.x*K} ${sh.y*K}) rotate(${sh.hd})"><path d="M0,-30 L18,22 L0,13 L-18,22Z" fill="var(--warn)" stroke="var(--bg)" stroke-width="3"/></g></svg>`;return s}
function renderCrewUI(){
  if(!O.crewMode||!O.data)return;const c=O.data.crew,m=c.memberOf,e=crewBox();
  if(!m){e.innerHTML=`<h1 style="font-size:20px">선원 시점</h1><p class="sub">이제 어느 배에도 타고 있지 않습니다.</p><button onclick="Online.exitCrew()">타이틀로</button>`;return}
  const sh=m.ship,sn=(sh&&sh.snap)||{},me=c.me||{purse:0,xp:0,tasks:0,rank:"견습 선원",cd:{},dayLeft:0};
  const ago=sh?Math.max(0,Math.round((srvNow()-sh.at)/60000)):0;
  const state=!sh?"아직 항해 기록이 없다":sh.online?(sh.loc==="port"?`${esc(sn.in||"어느 부두")}에 정박 중`:sn.sail?`항해 중 · ${sn.kn||0}노트 · ${esc(sn.wl||"")}`:"바다에 닻을 내리고 있다"):`선장이 자리를 비웠다 (${ago}분 전 마지막 신호) — 일은 쌓아 두면 돌아와서 받는다`;
  const old=$("cr-in"),keep=old?old.value:"";
  e.innerHTML=`<div class="vh"><svg viewBox="0 0 48 48"><path d="M24 6v28M14 14h20M10 34c0 6 6 8 14 8s14-2 14-8M10 34l6-4M38 34l-6-4"/></svg><div><div class="vt">${esc(sh?sh.ship:"배")} — ${esc(m.captain)} 선장</div><div class="sub sm">나는 <b>${esc(me.rank)}</b> · 일한 횟수 ${me.tasks} · 동료 ${m.shipmates.filter(x=>x!==O.user.username).map(esc).join(", ")||"없음"}</div></div></div>
  <div class="two"><div class="col">
   <div class="card"><h2 style="margin-top:0">배 상태 ${sh&&sh.online?"<span class='sm' style='color:var(--acc)'>● 선장 접속 중</span>":""}</h2><div class="sm sub" style="margin-bottom:8px">${state}</div>
    ${sn.h!=null?`<div class="row"><span>선체</span><span class="sm">${sn.h}/${sn.hm}</span></div>${bar(sn.h,sn.hm)}<div class="row"><span>허기 (선장)</span><span class="sm">${sn.f}/100</span></div>${bar(sn.f,100)}<div class="row"><span>체력 (선장)</span><span class="sm">${sn.p}/${sn.pm}</span></div>${bar(sn.p,sn.pm)}<div class="sub sm">항해 ${sn.d}일째</div>`:`<div class="sub sm">선장이 아직 출항하지 않았다.</div>`}
   </div>
   ${sh?`<div class="card"><h2 style="margin-top:0">해도 <span class="sub sm" style="font-weight:400">(선장이 본 바다만 보인다)</span></h2>${crewMap(sh)}</div>`:""}
  </div><div class="col">
   <div class="card"><h2 style="margin-top:0">갑판 일</h2><div class="sub sm" style="margin-bottom:6px">일을 하면 결과가 선장에게 전해지고, 나는 월급이 쌓입니다. (오늘 더 받을 수 있는 월급 ${me.dayLeft}G)</div>
    ${DUTY.map(([k,t,d])=>`<div class="row"><span>${t}<br><span class="sub sm">${d}</span></span><button id="du-${k}" data-k="${k}" onclick="Online.duty('${k}')">하기</button></div>`).join("")}
    <div class="lg sm sub" style="margin-top:8px;max-height:130px">${crewLog.map(x=>`<div>${esc(x)}</div>`).join("")||"<div>아직 한 일이 없다.</div>"}</div>
    <div class="row" style="margin-top:6px"><span>쌓인 월급 <b>${me.purse}G</b></span><span class="sub sm">내 항해에서 찾는다</span></div></div>
   <div class="card"><h2 style="margin-top:0">선장의 항해일지</h2><div class="lg sm">${(sn.logs||[]).map(x=>`<div>${esc(x)}</div>`).join("")||"<div>(기록 없음)</div>"}</div></div>
   <div class="card"><h2 style="margin-top:0">선원 채팅</h2><div id="cr-chl" class="sub sm lg" style="max-height:140px"></div><input id="cr-in" maxlength="80" placeholder="말을 입력하고 Enter" style="width:100%;margin-top:6px"></div>
  </div></div>
  <div style="margin-top:16px"><button onclick="Online.exitCrew()">타이틀로 (배는 그대로 탑승 중)</button><button onclick="Online.leaveShip()">배에서 내리기</button></div>`;
  const inp=$("cr-in");inp.value=keep;inp.onkeydown=ev=>{if(ev.key!=="Enter")return;const t=cleanStr(inp.value,80).trim();if(!t)return;inp.value="";const ch="crew:"+m.captainId;
    api("/chat",{channel:ch,text:t}).then(()=>schedule(0)).catch(er=>{crewLog.unshift("⚠ "+er.message);renderCrewUI()})};
  const cl=$("cr-chl");cl.innerHTML=((CH["crew:"+m.captainId]||[]).slice().reverse().map(x=>`<div>[${esc(x.name)}] ${esc(x.text)}</div>`).join(""))||"<div>(아직 아무도 말하지 않았다)</div>";
  if(keep)inp.focus();renderCrewTimers()}
function renderCrewTimers(){
  if(!O.crewMode||!O.data||!O.data.crew.me)return;const cd=O.data.crew.me.cd||{};
  for(const [k] of DUTY){const b=$("du-"+k);if(!b)continue;const left=Math.ceil(((cd[k]||0)-srvNow())/1000);b.disabled=left>0;b.textContent=left>0?`${left}초`:"하기"}}
function renderCrewUIKeep(){renderCrewUI()}

/* ================= 시작 ================= */
async function boot(){
  hookGame();hookChat();
  try{
    const r=await fetch("/api/me",{headers:tok?{authorization:"Bearer "+tok}:{}});
    let j=null;try{j=await r.json()}catch(e){}
    if(!j||typeof j!=="object")return;             // 서버가 없는 정적 호스팅: 혼자 하기
    if(r.ok&&j.user){await loggedIn(j.user)}else{showAuth("")}
  }catch(e){}}
boot();
})();
