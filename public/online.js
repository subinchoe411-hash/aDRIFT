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
const plain=h=>String(h).replace(/<[^>]*>/g,"").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/\s+/g," ").trim().slice(0,100);

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
let timer=0,since={},busy=false,lastInput=Date.now(),idle=false;
const IDLE_MS=10*60*1000;   // 10분간 입력이 없으면 동기화를 멈춘다 (열어 둔 탭 때문에 서버가 계속 켜져 있지 않도록)
["pointerdown","keydown","touchstart"].forEach(ev=>addEventListener(ev,()=>{lastInput=Date.now();if(idle){idle=false;const b=$("olidle");if(b)b.hidden=true;schedule(0)}},{passive:true}));
function schedule(ms){clearTimeout(timer);if(!O.on)return;
  if(ms!==0&&Date.now()-lastInput>IDLE_MS){idle=true;let b=$("olidle");if(!b){b=document.createElement("div");b.id="olidle";b.style.cssText="position:fixed;left:50%;transform:translateX(-50%);top:8px;z-index:30;background:var(--bg);border:1px solid var(--line);padding:6px 14px;font-size:12px";b.textContent="자리 비움 — 화면을 누르면 온라인 연결을 다시 시작합니다.";document.body.appendChild(b)}b.hidden=false;return}
  timer=setTimeout(()=>sync(),ms==null?(document.hidden?30000:(O.crewMode?(O.hot&&O.hot()?2500:4500):gameOn()?(O.hot&&O.hot()?2500:5000):20000)):ms)}
O.syncNow=()=>schedule(0);
/* ===== 배 창고 동기화 =====
   서버가 정본이다. 선장 화면은 '마지막으로 받은 창고(stoB)'와 지금 S.sto 의 차이만 올린다.
   선원이 그사이 넣고 뺀 것은 서버 값 위에 선장의 변화를 얹어 합친다. 응답이 끊겨도 같은 seq 로 다시 보내 두 번 반영되지 않는다. */
let stoB=null,stoInf=null,stoForce=false,stoSeq=Date.now();
const sdiff=(a,b)=>{const d={};for(const k of new Set([...Object.keys(a),...Object.keys(b)])){const v=(a[k]||0)-(b[k]||0);if(v)d[k]=v}return d};
const sapply=(o,d)=>{const r={...o};for(const k in d){const n=(r[k]||0)+d[k];if(n>0)r[k]=n;else delete r[k]}return r};
O.stoReset=force=>{stoB=null;stoInf=null;stoForce=!!force};
O.stoOut=()=>{if(!S||!S.sto)return undefined;const cap=capS();
  if(!stoB)return{init:{...S.sto},reset:stoForce||undefined,seq:++stoSeq,cap};
  if(!stoInf){const d=sdiff(S.sto,stoB);if(Object.keys(d).length)stoInf={seq:++stoSeq,d}}
  return stoInf?{d:stoInf.d,seq:stoInf.seq,cap}:{cap}};
O.stoIn=(r,sent)=>{const s=r.sto;if(!s||!S||!S.sto)return;const before=JSON.stringify(S.sto);
  if(!stoB){S.sto=sapply({},s.items);stoForce=false}
  else{const ap=!sent.d||s.seq>=sent.seq,extra=sdiff(S.sto,ap?sapply(stoB,sent.d||{}):stoB);S.sto=sapply(s.items,extra);if(stoInf){if(ap)stoInf=null;else{stoSeq=Math.max(stoSeq,s.seq);stoInf.seq=++stoSeq}}}
  stoB={...s.items};
  if(JSON.stringify(S.sto)!==before){renderAll();saveGame()}};
function myState(){
  const loc=S.inC?"city":(S.isl!==null||S.dk>=0)?"port":"sea",isl=S.isl!==null?S.isl:S.dk;
  return {name:C.name,ship:SH[S.lv].n,lv:S.lv,x:S.x,y:S.y,hd:S.hd,loc,isl:loc==="port"?isl:-1,
    snap:{h:Math.round(S.hull),hm:hm(),f:Math.round(S.hun),p:Math.round(S.hp),pm:hpm(),d:Math.floor(S.t/1440)+1,sail:!!S.sail,
      wl:wlabel(),kn:Math.round(kn()*10)/10,in:loc==="port"&&I[isl]?I[isl].n:"",seen:[...S.seen].slice(0,100),logs:S.logs.slice(0,14).map(plain),...(O.snapExtra?O.snapExtra():{})}}}
async function sync(){
  if(!O.on||!tok||busy)return;busy=true;let ok=false;
  try{
    const active=gameOn();
    const so=active?O.stoOut():undefined;
    const r=await api("/sync",{me:active?myState():undefined,since,crew:O.crewMode?true:undefined,sto:so,isnv:O.isnv});
    O.data=r;O.off=r.now-Date.now();ok=true;
    if(r.isn){O.isnv=r.isn.v;O.isn=r.isn.list;reNames()}
    if(active&&!O._bp){O._bp=1;bossPoll()}
    if(active&&so)O.stoIn(r,so);
    for(const ch in r.chat){const a=r.chat[ch];if(a.length)since[ch]=a[a.length-1].id;chatAdd(ch,a)}
    if(active)await takeDeliveries(r.deliveries);else if(O.crewMode&&O.crewDeliveries)await O.crewDeliveries(r.deliveries);
    noticeNearby(r);renderDock();O.renderCrew&&O.renderCrew();O.renderCrewInfo&&O.renderCrewInfo();if(!active&&!O.crewMode&&!$("title").hidden)decorateTitle()
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
async function takeDeliveries(list){
  if(!list||!list.length)return;
  const got=(await api("/claim",{ids:list.map(d=>d.id)})).deliveries;
  for(const d of got)applyOne(d);
  if(got.length){renderAll();saveGame()}}
function applyOne(d){
  const p=d.payload||{};
  try{
  switch(d.kind){
  case "greet":say(`※ <b>${esc(p.name)}</b>(${esc(p.ship)}): “${esc(p.text)}”`);break;
  case "trade_done":{const paid=take(p.cost||{gold:0,items:{}});gain(p.gain||{gold:0,items:{}});
    say(`※ ${esc(p.with)}와(과)의 거래가 성사되었다. 받은 것: ${fmtB(p.gain||{})}${(p.cost&&(p.cost.gold||Object.keys(p.cost.items||{}).length))?` / 건넨 것: ${fmtB(p.cost)}`:""}${paid?"":" (내놓을 것이 모자라 있는 만큼만 건넸다)"}`);break}
  case "trade_refund":gain(p.gain||{});say(`※ ${esc(p.why||"거래가 취소되었다")}. 맡겨 둔 ${fmtB(p.gain||{})}이(가) 돌아왔다.`);break;
  case "boss_reward":gain({gold:p.gold,items:p.items});say(`※ ${esc(p.text||"주간 보스 보상이 도착했다.")} 골드 ${Math.floor(+p.gold||0)}${Object.keys(p.items||{}).length?", "+Object.keys(p.items).map(esc).join(", "):""}`);fxBig("주간 보스 보상","함께 쓰러뜨린 보상이 도착했다","relic");break;
  case "purse":S.gold+=Math.floor(+p.gold||0);say(`※ 선원 월급 ${Math.floor(+p.gold||0)}G를 찾았다.`);break;
  case "bottle_found":{const b=S.out.find(x=>x.srv&&!x.r);if(b)b.r=1;say("※ 누군가 당신의 병 편지를 주웠다!");break}
  case "bottle_reply":S.mail.unshift({from:cleanStr(p.from,30),text:cleanStr(p.text,80),t:clock(),re:cleanStr(p.re,80)});S.mail.length=Math.min(S.mail.length,40);
    say(`※ ${esc(p.from)}의 답장: “${esc(p.text)}”`);break;
  default:O.applyExtra&&O.applyExtra(d)
  }}catch(e){}}

/* ================= 마주침 패널 ================= */
const GREET=["안녕하세요!","순풍을 빌어요.","좋은 항해 되세요!","거래하실래요?","함께 항해해요!"];
let prevNear=new Set(),dockOpen=false,nearSig="";
function dock(){let e=$("olb");if(e)return e;
  e=document.createElement("div");e.id="olb";e.hidden=true;
  e.style.cssText="position:fixed;right:12px;bottom:12px;z-index:9;max-width:94vw";
  e.innerHTML=`<div id="olp" class="card" hidden style="width:min(380px,94vw);max-height:68vh;overflow:auto;margin-bottom:8px;text-align:left"></div><div style="text-align:right"><button id="olbtn" class="pri" onclick="Online.toggleDock()" style="margin:0;box-shadow:0 8px 20px -8px var(--shadow)"></button></div>`;
  document.body.appendChild(e);return e}
O.toggleDock=()=>{dockOpen=!dockOpen;nearSig="";renderDock()};
function noticeNearby(r){
  if(!gameOn())return;const ids=new Set(r.nearby.map(n=>n.id));
  for(const n of r.nearby)if(!prevNear.has(n.id)){say(`※ 다른 배가 가까이 있다: <b>${esc(n.name)}</b>의 ${esc(n.ship)}. (오른쪽 아래 '바다 위의 사람들'에서 인사·거래)`);O.crewLine&&O.crewLine("ship",{n:n})}
  prevNear=ids}
const dirs=["북","북동","동","남동","남","남서","서","북서"];
function whereTxt(n){if(n.loc==="port")return "같은 부두";const dx=dl(n.x-S.x,WW),dy=dl(n.y-S.y,WH),a=(Math.atan2(dx,-dy)*180/Math.PI+360)%360;return `${dirs[Math.round(a/45)%8]}쪽 ${n.d}해리`}
function renderDock(){
  const d=dock(),on=O.on&&gameOn()&&O.data;d.hidden=!on;if(!on)return;
  const r=O.data,inT=r.trades.incoming.length,inv=r.crew.invitesIn.length,badge=r.nearby.length+inT+inv;
  $("olbtn").textContent=`바다 위의 사람들${badge?` (${badge})`:""}`;
  $("olp").hidden=!dockOpen;if(!dockOpen)return;
  const sig=JSON.stringify([r.nearby.map(n=>[n.id,n.loc]),r.trades,r.crew.captainOf,r.crew.invitesIn,r.crew.invitesOut,r.crew.me&&r.crew.me.purse]);
  if(sig===nearSig){document.querySelectorAll("#olp [data-w]").forEach(e=>{const n=r.nearby.find(x=>x.id===+e.dataset.w);if(n)e.textContent=whereTxt(n)});return}
  nearSig=sig;
  const gs=id=>`<select onchange="Online.greetSel(${id},this)"><option value="">인사하기…</option>${GREET.map(g=>`<option>${esc(g)}</option>`).join("")}<option value="__c">직접 쓰기…</option></select>`;
  let h=`<h2 style="margin-top:0">마주친 배</h2>`+(r.nearby.length?r.nearby.map(n=>`<div class="seat"><b>${esc(n.name)}</b> <span class="sub sm">${esc(n.ship)} · <span data-w="${n.id}">${whereTxt(n)}</span></span><div style="margin-top:6px">${gs(n.id)} <button onclick="Online.openTrade(${n.id})">거래 제안</button></div></div>`).join(""):`<div class="sub sm">가까이에 다른 배가 없다. 같은 바다에서 서로 가까워지거나, 같은 부두에 닿으면 만날 수 있다.</div>`);
  if(inT||r.trades.outgoing.length){h+=`<h2>거래</h2>`;
    h+=r.trades.incoming.map(t=>{const can=canPay(t.want);return `<div class="seat"><b>${esc(t.name)}</b>이(가) 제안한다<div class="sm">받는 것: ${fmtB(t.give)}<br>줄 것: ${fmtB(t.want)}</div><div style="margin-top:6px"><button class="pri" ${can?"":"disabled"} onclick="Online.accept(${t.id})">수락</button><button onclick="Online.decline(${t.id})">거절</button>${can?"":`<span class="sub sm">줄 것이 모자라다</span>`}</div></div>`}).join("");
    h+=r.trades.outgoing.map(t=>`<div class="seat sub">→ <b>${esc(t.name)}</b>에게 제안 중<div class="sm">내놓은 것: ${fmtB(t.give)} / 원하는 것: ${fmtB(t.want)}</div><button onclick="Online.cancelTrade(${t.id})">제안 거두기</button></div>`).join("")}
  h+=`<h2>내 선원</h2>`+(r.crew.captainOf.length?r.crew.captainOf.map(m=>`<div class="row"><span>${m.online?"● ":"○ "}${esc(m.name)} <span class="sub sm">${m.role?esc(m.role):"직책 미정"}</span></span><a onclick="Online.dismiss(${m.id})">내리게 하기</a></div>`).join(""):`<div class="sub sm">선원이 없다. 친구를 초대하면 직책을 맡아 일하고, 전투와 잠수도 함께한다. 선원의 직책이 맞으면 선택지가 유리해진다.</div>`)
   +r.crew.invitesOut.map(i=>`<div class="row sub sm"><span>초대 중: ${esc(i.memberName)}</span><a onclick="Online.cancelInvite(${i.id})">취소</a></div>`).join("")
   +`<div class="row" style="margin-top:6px"><input id="ci-name" placeholder="초대할 아이디" maxlength="16" style="flex:1;min-width:0" list="ci-dl"><datalist id="ci-dl">${r.roster.map(x=>`<option value="${esc(x.username)}">`).join("")}</datalist><button onclick="Online.invite()">초대</button></div>`;
  if(inv)h+=`<h2>선원 제안</h2>`+r.crew.invitesIn.map(i=>`<div class="seat"><b>${esc(i.captainName)}</b> 선장이 배에 타 달라고 한다.<div style="margin-top:6px"><button class="pri" onclick="Online.respond(${i.id},true)">수락</button><button onclick="Online.respond(${i.id},false)">거절</button></div><div class="sub sm">수락하면 타이틀 화면에서 '선원으로 탑승'할 수 있다.</div></div>`).join("");
  const pu=r.crew.me?r.crew.me.purse:0;if(pu>0)h+=`<h2>선원 월급</h2><div class="row"><span>${pu}G가 쌓여 있다</span><button onclick="Online.withdraw()">내 항해로 찾기</button></div>`;
  $("olp").innerHTML=h}
const doit=async(fn,after)=>{try{await fn();after&&after()}catch(e){if(gameOn())say("※ "+esc(e.message));else toast(e.message)}O.syncNow()};
O.greetSel=(id,sel)=>{let t=sel.value;sel.selectedIndex=0;if(!t)return;if(t==="__c"){t=prompt("건넬 인사 (40자)","");if(!t)return}
  doit(()=>api("/greet",{to:id,text:String(t).slice(0,40)}),()=>say("※ 인사를 건넸다."))};
O.decline=id=>doit(()=>api("/trade/decline",{id}));
O.cancelTrade=id=>doit(()=>api("/trade/cancel",{id}));
O.accept=id=>{const t=O.data.trades.incoming.find(x=>x.id===id);if(!t||!canPay(t.want))return;doit(()=>api("/trade/accept",{id}))};
O.invite=()=>{const u=$("ci-name").value.trim();if(u)doit(()=>api("/crew/invite",{username:u}),()=>say(`※ ${esc(u)}에게 선원 제안을 보냈다.`))};
O.cancelInvite=id=>doit(()=>api("/crew/cancel",{id}));
O.dismiss=id=>{if(confirm("이 선원을 배에서 내리게 할까요?"))doit(()=>api("/crew/dismiss",{id}))};
O.respond=(id,accept)=>doit(()=>api("/crew/respond",{id,accept}),()=>{if(accept&&gameOn())say("※ 선원 제안을 받아들였다. 타이틀 화면에서 선원으로 탑승할 수 있다.")});
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
  try{await api("/trade/offer",{to,give,want});$("trm")&&$("trm").remove();say(`※ 거래를 제안했다. 내놓은 것: ${fmtB(give)} / 원하는 것: ${fmtB(want)}`);saveGame()}
  catch(e){gain(give);renderAll();msg.textContent=e.message}
  O.syncNow()};

/* ================= 병 편지 ================= */
O.sendBottle=async(text,gift)=>{try{await api("/bottle/send",{text,gift:gift||undefined})}catch(e){if(gift)add(gift.k,gift.n);const b=S.out.find(x=>x.srv&&!x.r&&x.text===text);if(b)b.srv=0;say("(서버에 띄우지 못했다: "+esc(e.message)+" — 이 병은 파도가 알아서 데려간다)")}};
O.pickBottle=async()=>{
  try{const r=await api("/bottle/find",{});
    if(r.bottle){S.mail.unshift({from:cleanStr(r.bottle.from,30),text:cleanStr(r.bottle.text,80),t:clock(),bid:r.bottle.id});S.mail.length=Math.min(S.mail.length,40);
      say(`※ 누군가 띄운 병이다. <b>${esc(r.bottle.from)}</b>: “${esc(r.bottle.text)}” (선장실에서 답장할 수 있다)`);
      const g=r.bottle.gift;if(g&&knownItem(g.k)){add(g.k,Math.min(3,g.n|0)||1);say(`※ 병 속에 <b>${esc(g.k)}</b>이(가) 들어 있었다!`);fxBig("병 속의 선물",g.k,"ok")}renderAll();return}}catch(e){}
  const bb=pick(BOT);S.mail.unshift({from:bb[0],text:bb[1],t:clock()});S.mail.length=Math.min(S.mail.length,40);
  say(`※ ${esc(bb[0])}: “${esc(bb[1])}” ${bb[2]?fx(bb[2]):""}`);renderAll()};
O.reply=async bid=>{
  const t=prompt("답장 (60자)","");if(!t)return;const m=S.mail.find(x=>x.bid===bid);
  try{await api("/bottle/reply",{id:bid,text:t.slice(0,60)});if(m)m.rp=1;say("※ 답장을 병에 담아 바다에 띄웠다.");renderAll();saveGame()}catch(e){say("※ "+esc(e.message))}};


/* ================= 섬 이름 · 주간 보스 ================= */
function reNames(){if(!O.isn||typeof I==="undefined"||!I||!I.length)return;O.isn.forEach(x=>{const w=I[x.isl];if(w){if(w.n0===undefined)w.n0=w.n;w.n=x.name;w.by=x.uname}});if(typeof renderAll==="function"&&gameOn())renderAll()}
O.reNames=reNames;
O.nameIsland=async()=>{const el=$("isnm"),name=el?el.value.trim():"";if(!name||S.isl===null)return;
  try{await api("/island/name",{isl:S.isl,name});say(`※ 이 섬에 「${esc(name)}」이라는 이름을 붙였다. 모두의 해도에 남는다.`);fxBig("섬 이름",name,"relic");O.syncNow()}catch(e){say("※ "+esc(e.message))}};
const _gw=window.genWorld;if(_gw)window.genWorld=function(){const r=_gw.apply(this,arguments);try{reNames()}catch(e){}return r};
async function bossPoll(){if(!O.on||!gameOn())return;try{O.boss=await api("/boss");if(typeof rGoals==="function")rGoals()}catch(e){}}
setInterval(bossPoll,60000);O.bossPoll=bossPoll;
O.bossHTML=()=>{const b=O.boss;if(!b||!O.on)return "";const left=Math.max(0,b.hp-b.dmg),pc=Math.round(left/b.hp*100),can=typeof S!=="undefined"&&S&&S.isl===null&&!S.inC&&!S.bt&&!S.act&&!S.pend;
  return `<h3>이번 주 해역 보스</h3><div class="row"><span><b>${esc(b.name)}</b></span><span class="sub sm">남은 체력 ${left} / ${b.hp}</span></div><div class="bar${pc<25?" w":""}"><i style="width:${pc}%"></i></div><div class="sub sm">모두의 피해가 합산된다 · 참여 ${b.fighters}명 · 내 피해 ${b.mine}</div>`+
   (b.done?(b.mine>0&&!b.claimed?`<button class="pri" onclick="Online.bossClaim()">쓰러뜨린 보상 받기</button>`:`<div class="sub sm">${b.mine>0?"보상을 받았다.":"이번 주 보스는 쓰러졌다."} 다음 주(월요일 0시)에 새 보스가 나타난다.</div>`):`<button class="pri" onclick="Online.bossFight()" ${can?"":"disabled"}>보스에게 도전 (바다에서)</button>`)};
O.bossFight=()=>{const b=O.boss;if(!b||b.done||S.isl!==null||S.inC||S.bt)return;MON.wboss=WBOSS[b.kind]||WBOSS[0];startBattle("wboss")};
O.bossHit=async dmg=>{try{O.boss=await api("/boss/hit",{dmg:Math.max(1,Math.min(400,dmg))});say(`※ ${esc(O.boss.name)}에게 입힌 피해 ${dmg}이(가) 모두의 합산에 더해졌다. (남은 체력 ${Math.max(0,O.boss.hp-O.boss.dmg)})`);if(O.boss.done)fxBig("보스 격파","모두의 힘으로 쓰러뜨렸다","relic");rGoals()}catch(e){say("※ "+esc(e.message))}};
O.bossClaim=async()=>{try{await api("/boss/claim",{});O.bossPoll();O.syncNow()}catch(e){say("※ "+esc(e.message))}};
/* ================= 채팅 ================= */
const CH={world:[]};let curCh="world";const unread={};
function chName(ch){return ch==="world"?"월드":ch.startsWith("place:")?"이곳":"선원"}
function chatAdd(ch,list){
  const a=CH[ch]||(CH[ch]=[]);
  for(const m of list){if(!a.some(x=>x.id===m.id)){a.push(m);if(ch!==curCh)unread[ch]=1}}
  a.splice(0,Math.max(0,a.length-60));renderChat()}
function myCrewCh(){const r=O.data;if(!r)return null;return r.crew.memberOf?"crew:"+r.crew.memberOf.captainId:(r.crew.captainOf.length?"crew:"+O.user.id:null)}
function renderChat(){
  const box=$("chl");if(!box||!O.on)return;
  const cc=myCrewCh(),pc=O.data&&O.data.place||null;if(curCh!=="world"&&curCh!==cc&&curCh!==pc)curCh="world";
  const h=$("chh");if(h){h.innerHTML=`채팅 <span style="font-weight:400">`+[["world",1],[pc,!!pc],[cc,!!cc]].filter(x=>x[1]).map(([c])=>`<a onclick="Online.setCh('${c}')" style="${c===curCh?"font-weight:700":""}">${chName(c)}${unread[c]?" ●":""}</a>`).join("")+`</span>`}
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
  if(c&&c.memberOf)h+=`<div style="margin-top:10px"><button class="pri" onclick="Online.enterCrew()" style="padding:8px 22px">선원으로 탑승 — ${esc(c.memberOf.captain)} 선장의 ${esc(c.memberOf.ship?c.memberOf.ship.ship:"배")}</button><div class="sub sm" style="margin-top:4px">직책을 맡아 선장을 돕고, 전투와 잠수도 함께합니다.</div></div>`;
  if(c&&c.invitesIn.length)h+=c.invitesIn.map(i=>`<div class="sm" style="margin-top:8px"><b>${esc(i.captainName)}</b> 선장이 선원으로 초대했습니다. <button class="pri" onclick="Online.respond(${i.id},true)">수락</button><button onclick="Online.respond(${i.id},false)">거절</button></div>`).join("");
  if(c&&c.me&&c.me.purse>0)h+=`<div class="sm sub" style="margin-top:8px">선원 월급 ${c.me.purse}G가 쌓여 있습니다. 내 항해를 시작하면 '바다 위의 사람들'에서 찾을 수 있습니다.</div>`;
  e.innerHTML=h}

O.gameOn=gameOn;O.srvNow=srvNow;O.plain=plain;O.renderChat=()=>renderChat();
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
