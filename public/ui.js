/* ui.js — 창 닫기, 퀘스트 창, 집, 파도 장면
   game.js 의 전역(S, I, cv, fx, say, start, bt …)을 쓰고, renderAll()/live()가 아래 훅을 부른다. */

/* ===== 창 닫기: 지도와 행동 말고는 모두 닫고 다시 열 수 있다 (브라우저에 기억) ===== */
const Win=(()=>{
 const KEY="adrift.win",N={sea:"바다",log:"기록",crew:"함께하는 선원",qtrk:"퀘스트",chat:"채팅"};
 let closed=new Set();try{closed=new Set(JSON.parse(localStorage.getItem(KEY)||"[]").filter(k=>N[k]))}catch(e){}
 const save=()=>{try{localStorage.setItem(KEY,JSON.stringify([...closed]))}catch(e){}};
 function apply(){document.querySelectorAll("[data-win]").forEach(el=>{const id=el.dataset.win;
  if(!el.querySelector(":scope>.wx")){const b=document.createElement("button");b.type="button";b.className="wx";b.textContent="×";b.title="창 닫기";b.setAttribute("aria-label",(N[id]||"")+" 창 닫기");b.onclick=()=>close(id);el.insertBefore(b,el.firstChild)}
  el.classList.toggle("wclosed",closed.has(id))});fill()}
 function close(id){closed.add(id);save();apply()}
 function open(id){closed.delete(id);save();apply()}
 function fill(){const m=document.getElementById("wml");if(!m)return;const wb=document.getElementById("wbtn");if(wb)wb.className=closed.size?"has":"";
  m.innerHTML=`<div class="wmh">창</div>`+Object.keys(N).filter(k=>document.querySelector(`[data-win="${k}"]`)).map(k=>`<button type="button" class="wm${closed.has(k)?"":" on"}" onclick="Win.toggle('${k}')"><i>${closed.has(k)?"□":"■"}</i>${N[k]}</button>`).join("")+`<button type="button" class="wm" onclick="Win.all()">모두 열기</button>`}
 function menu(){const m=document.getElementById("winmenu");m.hidden=!m.hidden;fill()}
 document.addEventListener("click",e=>{const m=document.getElementById("winmenu");if(m&&!m.hidden&&!e.target.closest("#winmenu,#wbtn"))m.hidden=true});
 return{apply,close,open,menu,toggle:id=>closed.has(id)?open(id):close(id),all:()=>{closed.clear();save();apply()},isClosed:id=>closed.has(id)}})();

/* ===== 집: 태어난 섬(첫걸음 섬)에 평생 한 채. 1~3단계로 키운다 ===== */
const Home=(()=>{
 const LV=[null,
  {n:"작은 오두막",sto:10,min:60,fr:.5,cook:1,cmin:6,water:4,fix:15,k:"작은 화덕",d:"한 칸짜리 오두막. 비바람은 피할 수 있다."},
  {n:"아늑한 집",sto:30,min:45,fr:1,cook:2,cmin:6,water:6,fix:22,k:"큰 화덕",d:"침대와 큰 화덕이 있는 집. 요리를 한 번에 두 접시 만든다."},
  {n:"큰 집",sto:60,min:30,fr:1,cook:2,cmin:4,water:8,fix:30,k:"집 조리실",d:"넓은 창고와 조리실, 작업대가 갖춰진 집. 자고 나면 기분이 좋아진다."}];
 const UP=[null,null,{g:250,w:8},{g:800,w:20}];
 const RM=[["bed","침실","자고, 쉬고, 저장한다",'<path d="M3 18V8M3 14h18v4M21 14v-3a3 3 0 00-3-3h-7v6M7 11.5a1.5 1.5 0 110 .01"/>'],
  ["kit","주방","큰 화덕에서 요리한다",'<path d="M7 14V9a3 3 0 015-2 3 3 0 015 2v5zM7 14v6h10v-6"/>'],
  ["sto","창고","배와 함께 쓰는 공유 창고",'<path d="M3 8l9-4 9 4v12H3zM3 8l9 4 9-4M12 12v8"/>'],
  ["work","작업대","배를 고치고 키운다",'<path d="M14 6l4 4-9 9H5v-4zM12 8l4 4M16 4l4 4"/>'],
  ["cab","선장실","캐릭터·칭호·장비를 본다",'<circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-4 3-6 7-6s7 2 7 6"/>'],
  ["map","해도실","출항 계획을 세운다",'<path d="M9 4l-6 2v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14"/>'],
  ["mail","우편함","병 편지가 도착한다",'<path d="M3 6h18v13H3zM3 7l9 7 9-7"/>'],
  ["well","우물","마실 물을 길어 둔다",'<path d="M5 9h14v11H5zM8 9V6l4-3 4 3v3M12 13v4"/>']];
 let sel="bed",dest="";
 const lv=()=>LV[S&&S.hl?S.hl:1];
 const here=()=>!!S&&!S.over&&S.isl!==null&&S.isl===S.home;   // 첫 섬에 상륙해 있을 때
 const inside=()=>here()&&!!S.inh;                                     // 그중 집 안에 있을 때
 const busy=()=>!!S.act||S.over||!!S.pend||!!S.bt;
 const need=o=>`${o.g}G · 목재 ${o.w}개`;
 function upgrade(){const nx=S.hl+1,o=UP[nx];if(!o||busy())return;if(S.gold<o.g||(S.inv.목재||0)<o.w)return say("증축에 쓸 재료가 모자라다 ("+need(o)+").");S.gold-=o.g;S.inv.목재-=o.w;if(S.inv.목재<=0)delete S.inv.목재;S.hl=nx;ct("house");say(`집을 「${LV[nx].n}」(으)로 키웠다! ${LV[nx].d}`);if(window.fxBig)fxBig("집 증축",LV[nx].n,"relic");renderAll()}
 function sleep(){if(busy())return;if(S.hun<15||S.thi<10)return say("배가 고프거나 목이 말라 잠이 오지 않는다. 먼저 먹고 마시자.");const L=lv();
  start("푹 자기",L.min,()=>{const miss=hpm()-S.hp;S.hp=Math.min(hpm(),S.hp+Math.ceil(miss*L.fr));S.fa=0;S.hun=Math.max(5,S.hun-12);S.thi=Math.max(10,S.thi-12);ct("sleep");if(S.hl>=3)addEf("행복",300);say(`푹 자고 일어났다. 체력이 ${L.fr>=1?"가득 찼다":"많이 돌아왔다"}, 피로가 사라졌다.${S.hl>=3?" 기분이 좋다.":""}`)})}
 function sip(){if(S.thi>=99)return say("지금은 목이 마르지 않다.");S.thi=100;ct("drink");say("우물물로 목을 시원하게 축였다. 목마름이 가셨다.");renderAll()}
 function fill(){if(busy())return;const n=lv().water;start("물통 채우기",3,()=>{add("식수",n);ct("well");say(`우물에서 물을 길어 물통을 채웠다. 식수 +${n}`)})}
 function fix(){if(busy())return;const miss=hm()-S.hull;if(miss<=0)return say("선체가 멀쩡하다.");const per=lv().fix,have=S.inv.목재||0,w=Math.min(have,Math.ceil(miss/per));if(w<=0)return say("정비할 목재가 없다.");
  S.inv.목재-=w;if(S.inv.목재<=0)delete S.inv.목재;start("선체 정비",40,()=>{S.hull=Math.min(hm(),S.hull+w*per*(1+.12*(lv("fix")-1)));addXp("fix",3);say(`작업대에서 선체를 손봤다. (목재 ${w}개)`)})}
 function depart(){const i=+dest;if(dest===""||isNaN(i)||busy())return;if(!I[i]||!S.seen.has(i))return;if(S.isl!==null)leave();S.view="deck";goIsl(i);}
 function room(k,z){
  const L=lv();
  if(k==="bed")return `<div class="sub sm">${L.d}</div>`+bt(`푹 자기 (${L.min}분 · 체력 ${L.fr>=1?"전부":"절반"} 회복${S.hl>=3?" · 기분 좋음":""})`,"Home.sleep()",z,1)+bt("지금 저장","manualSave()");
  if(k==="kit")return `<div class="sub sm">${L.k} — 요리를 한 번에 ${L.cook}접시 만들고, 조리 시간은 ${L.cmin}분이다.</div>`+bt("주방 열기","go('kitchen')",0,1);
  if(k==="sto")return `<div class="sub sm">창고 ${tot(S.sto)} / ${capS()}칸 (집 덕분에 +${L.sto}칸). 배의 선원도 같은 창고를 쓴다.</div>`+bt("창고 열기","go('inv')",0,1);
  if(k==="work"){const miss=Math.ceil(hm()-S.hull);return `<div class="sub sm">선체 ${Math.round(S.hull)} / ${hm()} · 정비 1회에 목재 ${L.fix}만큼 고친다. 목재 ${S.inv.목재||0}개.</div>`+bt(`선체 정비 (40분 · 목재 ${Math.max(0,Math.min(S.inv.목재||0,Math.ceil(Math.max(0,miss)/L.fix)))}개)`,"Home.fix()",z||miss<=0||!(S.inv.목재>0),1)+(S.hl>=2?bt("무기 연마 (12분)","sharpen()",z||!S.eq.w)+(SH[S.lv+1]?bt(`배 개조 — ${SH[S.lv+1].n} ${yc(SH[S.lv+1])}G`,"up()",z||S.gold<yc(SH[S.lv+1])):""):`<div class="sub sm">집을 2단계로 키우면 무기 연마와 배 개조도 할 수 있다.</div>`)}
  if(k==="map"){const ks=I.map((w,i)=>S.seen.has(i)&&w.k&&i!==S.home?i:-1).filter(i=>i>=0);if(dest===""||!ks.includes(+dest))dest=ks[0]!=null?String(ks[0]):"";
   const sl=`<select onchange="Home.setPick(this.value)">${ks.length?ks.map(i=>`<option value="${i}" ${String(i)===dest?"selected":""}>${esc(I[i].n)}</option>`).join(""):`<option value="">갈 수 있는 섬이 없다</option>`}</select>`;
   return `<div class="sub sm">지난 항해 기록을 펼쳐 놓고 이번 목적지를 고른다. 항로는 지도를 눌러 잡아도 된다.</div><div class="row"><span>원정 횟수</span><span>${S.rec.n}번</span></div><div class="row"><span>항구에서 가장 멀리</span><span>${S.rec.far}해리</span></div><div class="row"><span>발견한 섬</span><span>${S.seen.size}곳</span></div><div style="margin-top:8px">${sl}${bt("출항","Home.depart()",z||!ks.length,1)}</div>`}
  if(k==="cab")return `<div class="sub sm">나의 능력치와 칭호, 배·장비, 수첩을 본다.</div>`+bt("선장실 열기","S.cab='char';go('cabin')",0,1);
  if(k==="mail")return `<div class="sub sm">받은 병 편지 ${S.mail.length}통.</div>`+bt("편지·도감 열기","S.cab='dex';go('cabin')",0,1);
  if(k==="well")return `<div class="sub sm">맑은 우물. 마시는 건 공짜다. 물통은 한 번에 ${L.water}개씩 채운다.</div>`+bt("물 마시기 (목마름 전부)","Home.sip()",S.thi>=99,1)+bt("물통 채우기 (3분)","Home.fill()",z);
  return ""}
 function render(){const e=document.getElementById("v-home");if(!e)return;if(!inside()){e.innerHTML="";return}
  const L=lv(),nx=UP[S.hl+1],z=busy(),r=RM.find(x=>x[0]===sel)||RM[0];
  const lst=RM.map(([k,n,d,ic])=>`<button class="rr${k===sel?" on":""}" onclick="Home.go('${k}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ic}</svg><div><b>${n}</b><span>${d}</span></div></button>`).join("");
  const dots=[1,2,3].map(i=>`<i class="${i<=S.hl?"on":""}"></i>`).join("");
  e.innerHTML=`<div class="card"><h2>내 집 <span class="sub">· ${esc(I[S.home].n)} · ${L.n}</span> <span class="hd">${dots}</span></h2><div class="sub sm">${L.d}</div>
   <div class="rl" style="margin-top:10px">${lst}</div></div>
   <div class="card" style="margin-top:14px"><h2>${r[1]}</h2>${room(sel,z)}<div id="prog5"></div></div>
   <div class="card" style="margin-top:14px"><h2>문밖으로</h2><div class="sub sm">집을 나서면 섬이다. 부두에서 배에 오르면 항해할 수 있다.</div>${bt("집을 나선다","Home.leave()",z,1)}</div>
   <div class="card" style="margin-top:14px"><h2>집 키우기</h2>${nx?`<div class="row"><span>${LV[S.hl+1].n}</span><span class="sub sm">${need(nx)}</span></div><div class="sub sm">${LV[S.hl+1].d} 창고 +${LV[S.hl+1].sto-L.sto}칸, 자는 시간 ${LV[S.hl+1].min}분.</div>`+bt("집 키우기","Home.upgrade()",z||S.gold<nx.g||(S.inv.목재||0)<nx.w,1):`<div class="sub sm">더 키울 수 없는 가장 큰 집이다.</div>`}</div>`}
 return{here,inside,enter:()=>{if(busy())return;S.inh=true;S.view="home";renderAll()},leave:()=>{if(busy())return;S.inh=false;S.view="island";S.bld="home";renderAll()},sto:()=>S&&S.hl?LV[S.hl].sto:0,cookY:()=>inside()?lv().cook:1,cookMin:()=>inside()?lv().cmin:6,kname:()=>lv().k,upgrade,sleep,sip,fill,fix,depart,render,
  go:k=>{sel=k;renderAll()},setPick:v=>{dest=v}}})();

/* ===== 퀘스트: 받아야 시작되고, 쓰러뜨리듯 한 번에 쏟아지지 않는다 ===== */
const Q=(()=>{
 const AT={any:"어디서나",port:"섬의 부두에서",home:"내 집에서",town:"마을 섬에서"};
 /* 0~13 은 예전 '항해 수첩'(GOALS)과 같은 순서 — 저장된 완료 기록(S.gd)을 그대로 쓴다 */
 const QD=[
  {c:"수첩",n:"첫 낚시를 해 보자",by:"항구지기 마리",at:"port",s:"갑판에서 낚싯줄을 던져 보세요. 오늘 저녁거리가 걸릴지도 몰라요.",req:[],o:[["낚시하기","fish",1]]},
  {c:"수첩",n:"직접 낚시를 성공시키자",by:"항구지기 마리",at:"port",s:"'직접 낚시'는 타이밍 게임이에요. 막대가 초록 구간에 있을 때 챔질!",req:[0],o:[["직접 낚시로 물고기 낚기","fgh",1]]},
  {c:"수첩",n:"주방에서 요리를 만들어 보자",by:"선술집 주인 도담",at:"port",s:"재료를 두세 개 섞으면 새 요리법을 알아낼 수도 있어. 실패하면 그것도 추억이지.",req:[0],o:[["요리 만들기","cook",1]]},
  {c:"수첩",n:"음식을 먹어 보자",by:"선술집 주인 도담",at:"port",s:"배가 비면 힘도 안 나. 만든 걸 먹어서 허기를 채워 봐.",req:[2],o:[["음식 먹기","eat",1]]},
  {c:"수첩",n:"가까운 섬에 상륙하자",by:"늙은 어부 해강",at:"port",s:"해도의 섬을 누르면 부두로 항로가 잡힌다네. 닿으면 상륙할 수 있지.",req:[0],o:[["다른 섬에 상륙하기","isl2",1]]},
  {c:"수첩",n:"섬을 탐색해 보자",by:"늙은 어부 해강",at:"port",s:"섬에 내렸으면 둘러봐야지. 뭐가 나올지는 아무도 모른다네.",req:[4],o:[["섬에서 탐색하기","srch",1]]},
  {c:"수첩",n:"망보기를 해 보자",by:"망루지기 소나",at:"port",s:"멀리 보려면 돛대 위로 올라가야 해요. 먼바다의 윤곽이 보일 거예요.",req:[0],o:[["망보기","look",1]]},
  {c:"수첩",n:"보물을 인양하자",by:"망루지기 소나",at:"port",s:"해도의 ? 표시는 표류하는 보물 통이에요. 가까이 가서 끌어올려 봐요.",req:[6],o:[["보물 인양하기","tre",1]]},
  {c:"수첩",n:"물건을 팔아 보자",by:"장사꾼 보람",at:"town",s:"쓸데없는 물건은 시장에 가져와. 오늘 시세가 좋으면 더 쳐주지.",req:[4],o:[["물건 팔기","sell",1]]},
  {c:"수첩",n:"병 편지를 띄워 보자",by:"장사꾼 보람",at:"port",s:"병 속에 짧은 편지를 넣어 바다에 띄워 봐. 누군가 답장을 보낼지도 몰라.",req:[4],o:[["병 편지 띄우기","sent",1]]},
  {c:"수첩",n:"수동 조타로 5해리 항해하자",by:"늙은 어부 해강",at:"port",s:"자동 항해는 편하지만, 직접 키를 잡아야 배운다네. 바람을 읽어 보게.",req:[6],o:[["수동 조타로 항해","mnm",5,"해리"]]},
  {c:"수첩",n:"수배 의뢰를 맡아 보자",by:"게시판 경비병",at:"town",s:"마을 광장 게시판에 수배서가 붙어 있다. 한 건 맡아 보겠나?",req:[8],o:[["수배 의뢰 맡기","acc",1]]},
  {c:"수첩",n:"해류를 타고 3해리 가자",by:"항해사 파도",at:"port",s:"바다에는 흐름이 있어. 수동 조타로 해류를 따라가면 배가 훨씬 빨라지지.",req:[10],o:[["해류를 타고 항해","cur",3,"해리"]]},
  {c:"수첩",n:"해저 도시를 탐험하자",by:"연구가 이슬",at:"port",s:"가라앉은 도시가 있다는 소문이 사실일까요? 잠수해서 직접 확인해 주세요.",req:[7,12],o:[["해저 도시 탐험 완료","dive",1]]},
  {c:"의뢰",n:"목을 축이자",by:"항구지기 마리",at:"port",s:"바다 위에서 제일 무서운 건 목마름이에요. 우물에서 물을 길어 두고, 마르면 마시세요.",req:[],o:[["물 마시기","drink",1],["물 길어 오기","well",1]]},
  {c:"의뢰",n:"집 단장하기",by:"늙은 어부 해강",at:"home",s:"자네 집이 꽤 낡았군. 목재와 돈을 모아 한 칸 늘려 보게. 침대도 좋아지고, 요리도 두 접시씩 나올 걸세.",req:[14],o:[["집을 2단계로 키우기","hl",2]]},
  {c:"의뢰",n:"큰 집을 짓자",by:"늙은 어부 해강",at:"home",s:"이왕 하는 김에 제대로 짓게. 넓은 창고와 조리실이 있으면 항해가 한결 든든하지.",req:[15],o:[["집을 3단계로 키우기","hl",3]]},
  {c:"의뢰",n:"첫 원정",by:"망루지기 소나",at:"port",s:"항구에서 멀리 나갔다가 무사히 돌아오면 원정 보너스를 받아요. 돌아올 힘은 남겨 두세요.",req:[6],o:[["원정 마치고 귀항하기","exped",1]]},
  {c:"의뢰",n:"먼 바다로",by:"항해사 파도",at:"port",s:"항구에서 열 해리쯤 떨어지면 바다 색이 달라져. 피로와 귀항 여유를 잘 보게.",req:[17],o:[["항구에서 10해리 떨어지기","far",10,"해리"]]},
  {c:"의뢰",n:"든든한 하루",by:"선술집 주인 도담",at:"port",s:"잘 먹는 선장이 오래 가는 법이지. 요리하고 먹는 걸 익숙해질 때까지 해 보게.",req:[3],o:[["요리 만들기","cook",5],["음식 먹기","eat",5]]},
  {c:"의뢰",n:"섬사람들 사이에서",by:"장사꾼 보람",at:"port",s:"섬마다 소문이 달라. 마을 사람과 이야기하고, 섬도 몇 군데 들러 보면 좋은 소식을 들을 수 있지.",req:[4],o:[["마을 사람과 대화하기","talk",3],["섬에 상륙하기","isl",3]]}];
 const RW=["g:15","g:20","g:15","g:10","g:30","i:목재:2","g:15","g:40","g:15","m:1","g:25","g:30","g:30","g:60","i:식수:3;g:20","g:80;i:목재:4","g:200;m:2","g:60","g:120","g:50;i:향신료:1","g:40;i:약초:2"];
 QD.forEach((q,i)=>{q.id="q"+i;q.i=i;q.r=RW[i]});
 const RWT=r=>r.split(";").map(e=>{const[a,b,c]=e.split(":");return a==="g"?b+" 골드":a==="i"?c+"개 "+b:a==="m"?"명예 "+b:""}).filter(Boolean).join(" · ");
 let tab="new",sel="",fil="all";
 const st=q=>q.i<14&&S.gd.has(q.i)?2:(S.qs[q.id]||0);
 const prog=q=>q.o.map(([l,k,th,u])=>{const c=Math.min(th,cv(k));return{l,c:u?Math.floor(c*10)/10:Math.floor(c),th,u:u||"",ok:cv(k)>=th}});
 const ready=q=>prog(q).every(p=>p.ok);
 const unmet=q=>q.req.filter(r=>st(QD[r])!==2);
 const atOk=q=>{const a=q.at;if(a==="any")return true;if(S.inC)return false;if(a==="home")return Home.inside();if(a==="town")return S.isl!==null&&(I[S.isl].t==="마을"||S.isl===S.home);return S.isl!==null||S.dk>=0}; /* port: 부두 */
 const trk=()=>QD.find(x=>x.id===S.qtk&&(st(x)===1||st(x)===3));
 const avail=()=>QD.filter(q=>st(q)===0&&!unmet(q).length);
 const acting=()=>QD.filter(q=>st(q)===1||st(q)===3);
 const done=()=>QD.filter(q=>st(q)===2);
 function check(){if(!S||!S.qs)return;let ch=false;QD.forEach(q=>{const s=st(q);if(s===1&&ready(q)){S.qs[q.id]=3;ch=true;if(window.fxBig)fxBig("퀘스트 완료",q.n+" — 보상을 받을 수 있다","ok");say("퀘스트 완료 — 「"+q.n+"」 퀘스트 창에서 보상을 받을 수 있다.")}else if(s===3&&!ready(q)){S.qs[q.id]=1;ch=true}});if(ch)renderAll()}
 function accept(id){const q=QD.find(x=>x.id===id);if(!q||st(q)!==0||unmet(q).length||!atOk(q))return;S.qs[id]=1;if(!trk())S.qtk=id;
  say(`퀘스트 수락 — 「${q.n}」(${q.by})`);if(window.fxBig)fxBig("퀘스트 수락",q.n,"new");tab="act";sel=id;check();renderAll();render()}
 function claim(id){const q=QD.find(x=>x.id===id);if(!q||!ready(q)||(st(q)!==1&&st(q)!==3))return;if(q.i<14)S.gd.add(q.i);else S.qs[id]=2;
  if(q.i<14)delete S.qs[id];say(`퀘스트 완료 — 「${q.n}」 ${fx(q.r)}`);flush();if(window.fxBig)fxBig("보상",RWT(q.r),"relic");if(S.qtk===id)S.qtk="";const nx=acting()[0];if(nx&&!S.qtk)S.qtk=nx.id;sel="";renderAll();render()}
 function drop(id){const q=QD.find(x=>x.id===id);if(!q||(st(q)!==1&&st(q)!==3))return;delete S.qs[id];if(S.qtk===id)S.qtk="";say(`퀘스트를 포기했다 — 「${q.n}」`);renderAll();render()}
 function track(id){S.qtk=S.qtk===id?"":id;renderAll();render()}
 const bar=p=>`<div class="qb"><i style="width:${Math.min(100,p.c/p.th*100)}%"></i></div>`;
 const objs=q=>prog(q).map(p=>`<div class="qo${p.ok?" ok":""}"><i>${p.ok?"◆":"◇"}</i><span>${esc(p.l)}</span><b>${p.c}/${p.th}${p.u}</b>${bar(p)}</div>`).join("");
 function lock(q){const m=unmet(q);return m.length?"먼저 「"+m.map(r=>QD[r].n).join("」, 「")+"」을(를) 끝내야 한다":!atOk(q)?AT[q.at]+" 받을 수 있다":""}
 function mark(q){const s=st(q);return s===2?'<i class="m d">✓</i>':s===3?'<i class="m r">?</i>':s===1?'<i class="m p">…</i>':atOk(q)?'<i class="m n">!</i>':'<i class="m l">·</i>'}
 function list(){let L=tab==="act"?acting().sort((a,b)=>(st(b)===3)-(st(a)===3)):tab==="done"?done():avail().sort((a,b)=>atOk(b)-atOk(a));
  if(fil!=="all")L=L.filter(q=>q.c===fil);
  const bounty=tab==="act"&&(fil==="all"||fil==="수배")?S.quests.map((x,j)=>`<button class="qi${sel==="b"+j?" on":""}" onclick="Q.sel('b${j}')"><i class="m p">…</i><span>${esc(x.name)}<small>수배 · ${x.reward}G</small></span></button>`).join(""):"";
  return L.map(q=>`<button class="qi${sel===q.id?" on":""}${tab==="new"&&!atOk(q)?" lk":""}" onclick="Q.sel('${q.id}')">${mark(q)}<span>${esc(q.n)}<small>${q.c} · ${esc(q.by)}</small></span>${S.qtk===q.id?'<em title="추적 중">◎</em>':""}</button>`).join("")+bounty||`<div class="sub sm" style="padding:14px 6px">${tab==="act"?"진행 중인 퀘스트가 없다. '받을 수 있음' 탭에서 의뢰를 받아 보자.":tab==="done"?"아직 끝낸 퀘스트가 없다.":"지금 받을 수 있는 퀘스트가 없다. 다른 퀘스트를 끝내면 새 의뢰가 열린다."}</div>`}
 function detail(){
  if(/^b\d+$/.test(sel)){const x=S.quests[+sel.slice(1)];if(!x)return"";return `<h3>${esc(x.name)} <span class="tg2">수배</span></h3><div class="sub sm">의뢰처: 마을 광장 게시판</div><div class="qs">${esc(x.crime)}(으)로 수배된 자다. ${x.state==="captured"?"포박했다. "+esc(I[x.home].n)+"의 게시판에 인도하자.":"바다 어딘가에서 배를 탄 채 도망 다닌다. 해도의 ⚑ 표시를 따라가 추적하자."}</div><div class="qh">보상</div><div class="qr">${x.reward} 골드 · 명예 +5</div>`}
  const q=QD.find(x=>x.id===sel);if(!q)return `<div class="qe"><div class="big">◇</div>왼쪽에서 퀘스트를 고르면 자세한 내용이 나온다.</div>`;
  const s=st(q),lk=s===0?lock(q):"";
  let b="";
  if(s===0)b=`<button class="pri" ${lk?"disabled":""} onclick="Q.accept('${q.id}')">수락</button>${lk?`<div class="sub sm">${lk}</div>`:""}`;
  else if(s===1||s===3)b=`<button class="pri" ${s===3?"":"disabled"} onclick="Q.claim('${q.id}')">보상 받기</button><button onclick="Q.track('${q.id}')">${S.qtk===q.id?"추적 해제":"추적"}</button><button class="d" onclick="Q.drop('${q.id}')">포기</button>`;
  else b=`<div class="sub sm">이미 끝낸 퀘스트다.</div>`;
  return `<h3>${esc(q.n)} <span class="tg2">${q.c}</span></h3><div class="sub sm">의뢰인 ${esc(q.by)} · ${AT[q.at]} 받는다</div><div class="qs">${esc(q.s)}</div><div class="qh">목표</div>${objs(q)}<div class="qh">보상</div><div class="qr">${RWT(q.r)}</div><div class="qa">${b}</div>`}
 function render(){const b=document.getElementById("qwb");if(!b||document.getElementById("qwin").hidden)return;
  const n=[avail().filter(atOk).length,acting().length+S.quests.length,done().length];
  const h=`<div class="qt"><h2>퀘스트</h2><span class="sub sm">수첩 ${S.gd.size}/14 · 완료 ${done().length}/${QD.length}</span><button class="wx2" onclick="Q.close()" aria-label="닫기">×</button></div>
  <div class="qtabs">${[["new","받을 수 있음",n[0]],["act","진행 중",n[1]],["done","완료",n[2]]].map(([k,l,c])=>`<button class="${tab===k?"on":""}" onclick="Q.tab('${k}')">${l}<b>${c}</b></button>`).join("")}<span class="sp"></span>${["all","수첩","의뢰","수배"].map(f=>`<button class="f${fil===f?" on":""}" onclick="Q.fil('${f}')">${f==="all"?"전체":f}</button>`).join("")}</div>
  <div class="qbody"><div class="ql">${list()}</div><div class="qd">${detail()}</div></div>`;if(b._h===h)return;b._h=h;const ql=b.querySelector(".ql"),sc=ql?ql.scrollTop:0;b.innerHTML=h;const n2=b.querySelector(".ql");if(n2)n2.scrollTop=sc}
 function open(){tab=acting().length&&!avail().filter(atOk).length?"act":avail().filter(atOk).length?"new":acting().length?"act":"new";if(!sel||!QD.find(x=>x.id===sel))sel="";document.getElementById("qwin").hidden=false;render()}
 function close(){document.getElementById("qwin").hidden=true}
 const qw=document.getElementById("qwin");qw.addEventListener("mousedown",e=>{if(e.target===qw)close()});document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!qw.hidden)close()});
 let ptab="q";
 function trackHTML(){if(!S||!S.qs)return"";const nA=avail().filter(atOk).length,cur=trk()||acting()[0];
  const tabs=`<div class="qtt"><button class="${ptab==="q"?"on":""}" onclick="Q.ptab('q')">퀘스트${nA?` <i class="m n">!</i>`:""}</button><button class="${ptab==="b"?"on":""}" onclick="Q.ptab('b')">보스</button></div>`;
  if(ptab==="b"){const bh=window.Online&&Online.bossHTML?Online.bossHTML():"";return tabs+(bh||`<div class="sub sm">주간 해역 보스는 온라인에 접속해 있을 때 나타난다.</div>`)}
  let h="";
  if(cur){const rd=st(cur)===3;h+=`<div class="qtk"><div class="qn">${rd?'<i class="m r">?</i>':'<i class="m p">…</i>'}<b>${esc(cur.n)}</b></div>${objs(cur)}${rd?`<button class="pri" onclick="Q.claim('${cur.id}')">보상 받기</button>`:`<div class="sub sm">보상 ${RWT(cur.r)}</div>`}</div>`}
  else h+=`<div class="sub sm">${nA?"받을 수 있는 퀘스트가 있다.":"추적 중인 퀘스트가 없다."}</div>`;
  if(S.quests.length)h+=`<h3>맡은 수배</h3>`+S.quests.map(x=>`<div class="q"><i>◆</i><span><b>${esc(x.name)}</b> <span class="sub sm">${x.state==="captured"?"포박 완료 → "+esc(I[x.home].n)+"에 인도":"추적 중"}</span></span><small>${x.reward}G</small></div>`).join("");
  h+=`<div class="qlink"><button onclick="Q.open()">퀘스트 창 열기</button></div>`;return tabs+h}
 function track$(){const e=document.getElementById("qst");if(!e)return;const h=trackHTML();if(e._h!==h){e._h=h;e.innerHTML=h}
  const bg=document.getElementById("qbadge");if(bg&&S&&S.qs){const n=avail().filter(atOk).length+QD.filter(q=>st(q)===3).length;bg.hidden=!n;bg.textContent=n}}
 return{ptab:t=>{ptab=t;const e=document.getElementById("qst");if(e)e._h=null;track$()},open,close,render,accept,claim,drop,track,check,track$,tab:t=>{tab=t;sel="";render()},sel:id=>{sel=id;render()},fil:f=>{fil=f;render()},QD,fix(){S.qs=(S.qs&&typeof S.qs==="object")?S.qs:{};const ok={};QD.forEach(q=>{const v=S.qs[q.id];if(v===1||v===3||(q.i>=14&&v===2))ok[q.id]=v});S.qs=ok;if(typeof S.qtk!=="string"||!QD.find(q=>q.id===S.qtk))S.qtk=""}}})();

/* ===== 파도 장면: 항해 중에만 움직이고, 바다의 세기만큼 배가 흔들린다 ===== */
const Sea=(()=>{
 let ph=0,last=0,ls=0,raf=0,col=null,coltod="",dirty=true,lastSail=null;
 const cs=(n)=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();
 function colors(){const t=document.documentElement.getAttribute("data-tod")||"day";if(coltod===t&&col)return col;coltod=t;col={sea:cs("--sea"),sh:cs("--sh"),hi:cs("--hi"),ink:cs("--ink"),sub:cs("--sub"),line:cs("--line"),acc:cs("--acc"),acc2:cs("--acc2"),card:cs("--card"),s1:cs("--sky1"),s2:cs("--sky2")};dirty=true;return col}
 const level=()=>Math.min(2,(S.ws||1)/1.0+(typeof weekEv==="function"&&weekEv().n==="폭풍 주간"?.35:0));   // 0.4~2
 const label=()=>{const k=level();return k<.7?"잔잔한 바다":k<1.1?"보통 파도":k<1.5?"거친 파도":"폭풍우"};
 function visible(){const c=document.getElementById("sea");if(!c)return false;const card=c.closest("[data-win]");return S&&S.view==="deck"&&!document.getElementById("v-deck").hidden&&!(card&&card.classList.contains("wclosed"))&&!document.getElementById("game").hidden&&!document.hidden}
 const going=()=>typeof S!=="undefined"&&!!S&&!!S.t&&!!S.sail&&S.isl===null&&!S.inC;
 function draw(now){if(typeof S==="undefined"||!S||!S.t)return;const c=document.getElementById("sea");if(!c)return;const sailing=going();
  const dt=Math.min(.1,(now-last)/1000||0);last=now;if(!visible()){dirty=true;return}
  if(!sailing&&now-ls>3000){dirty=true;ls=now}
  if(sailing){ph+=dt*(.9+Math.min(2.2,Math.max(0,(typeof kn==="function"?kn():3))/6));dirty=true}else if(lastSail!==sailing)dirty=true;lastSail=sailing;
  const r=c.getBoundingClientRect(),W=Math.max(10,Math.round(r.width)),H=Math.max(10,Math.round(r.height)),dpr=Math.min(2,devicePixelRatio||1);if(c.width!==W*dpr||c.height!==H*dpr){c.width=W*dpr;c.height=H*dpr;dirty=true}
  const k=colors();if(!dirty)return;dirty=false;const g=c.getContext("2d");g.setTransform(dpr,0,0,dpr,0,0);
  const L=level(),amp=sailing?L:L*.25,hz=H*.48;   // 정박 중엔 아주 작게 일렁이는 모양만 남기고 멈춘다
  const sk=g.createLinearGradient(0,0,0,hz+H*.1);sk.addColorStop(0,k.s1);sk.addColorStop(1,k.s2);g.fillStyle=k.sea;g.fillRect(0,0,W,H);g.fillStyle=sk;g.fillRect(0,0,W,hz+4);
  const night=(document.documentElement.getAttribute("data-tod")||"day")==="night";
  if(night){g.fillStyle=k.ink;for(let i=0;i<26;i++){g.globalAlpha=.25+.5*((i*37)%10)/10;g.fillRect((i*97%100)/100*W,(i*53%46)/100*H,1.4,1.4)}g.globalAlpha=1}
  g.fillStyle=k.acc;g.globalAlpha=night?.0:.8;g.beginPath();g.arc(W*.84,H*.22,H*.07,0,7);g.fill();g.globalAlpha=1;if(night){g.fillStyle=k.ink;g.globalAlpha=.85;g.beginPath();g.arc(W*.84,H*.22,H*.06,0,7);g.fill();g.fillStyle=k.s2;g.beginPath();g.arc(W*.84+H*.03,H*.22-H*.015,H*.055,0,7);g.fill();g.globalAlpha=1}
  const F=[];for(let i=0;i<4;i++){const y0=hz+i*H*.11,a=(3+i*3.2)*amp,len=54+i*30,sp=(.7+i*.3),p0=i*1.9;F.push(x=>y0+Math.sin(x/len+ph*sp+p0)*a+Math.sin(x/(len*.43)+ph*sp*1.7+p0*2)*a*.35)}
  F.forEach((f,i)=>{g.beginPath();g.moveTo(0,H);for(let x=0;x<=W;x+=3)g.lineTo(x,f(x));g.lineTo(W,H);g.closePath();g.fillStyle=k.acc2;g.globalAlpha=.1+i*.1;g.fill();g.globalAlpha=1;
   g.beginPath();for(let x=0;x<=W;x+=3)x?g.lineTo(x,f(x)):g.moveTo(x,f(x));g.strokeStyle=k.card;g.globalAlpha=.55;g.lineWidth=1.1;g.stroke();g.globalAlpha=1;
   if(i===1)boat(g,k,f,W,H,amp,sailing,ph)});
  const t=document.getElementById("seat");if(t)t.textContent="· "+(sailing?label():label()+" (정박)")}
 function boat(g,k,f,W,H,amp,sailing,ph){const bx=W*.36,y=f(bx),sl=(f(bx+10)-f(bx-10))/20,sc=1+.18*(S.lv||0)+H/320,rock=sailing?Math.sin(ph*1.3)*.07*amp:0;
  g.save();g.translate(bx,y-1);g.rotate(Math.atan(sl)*(.7+.5*amp)+rock);g.scale(sc,sc);
  g.fillStyle=k.ink;g.beginPath();g.moveTo(-20,0);g.lineTo(20,0);g.lineTo(14,8);g.lineTo(-14,8);g.closePath();g.fill();
  g.strokeStyle=k.ink;g.lineWidth=1.4;g.beginPath();g.moveTo(0,0);g.lineTo(0,-30);g.stroke();
  g.fillStyle=k.card;g.strokeStyle=k.sub;g.lineWidth=.8;g.beginPath();g.moveTo(2,-29);g.lineTo(2,-4);g.lineTo(17,-4);g.closePath();g.fill();g.stroke();g.beginPath();g.moveTo(-2,-26);g.lineTo(-2,-4);g.lineTo(-14,-4);g.closePath();g.fill();g.stroke();g.restore()}
 /* 항해 중에만 프레임 반복(rAF). 그 밖에는 0.4초마다 정지 화면이 바뀌었는지만 살핀다 */
 function frame(now){raf=0;draw(now);if(going()&&visible())raf=requestAnimationFrame(frame)}
 function start(){setInterval(()=>{if(raf||typeof S==="undefined"||!S||!S.t)return;if(going()&&visible())raf=requestAnimationFrame(frame);else if(visible())draw(performance.now());else dirty=true},400)}
 return{start,mark:()=>{dirty=true}}})();

/* ===== 항해 음악: 항해 중에만 흐른다 (音楽：ユーフルカ https://youfulca.com/) ===== */
const Bgm=(()=>{let a=null,pend=false;const V=.35;
 const want=()=>typeof S!=="undefined"&&!!S&&!!S.t&&!!S.sail&&S.isl===null&&!S.inC&&!S.over&&!document.getElementById("game").hidden&&!(window.Online&&Online.crewMode)&&typeof muted==="function"&&!muted();
 function tick(){if(want()){if(!a){a=new Audio("audio/voyage.mp3");a.loop=true;a.preload="auto";a.volume=0}
   if(a.paused&&!pend){pend=true;a.play().then(()=>{pend=false}).catch(()=>{pend=false})}   // 사용자가 화면을 누르기 전이면 거절된다 → 다음 틱에 다시
   if(!a.paused)a.volume=Math.min(V,a.volume+.03)}
  else if(a&&!a.paused){a.volume=Math.max(0,a.volume-.06);if(a.volume<=.001)a.pause()}}
 setInterval(tick,250);return{tick,el:()=>a}})();

/* renderAll()/live()가 부르는 훅 */
function uiRender(){Home.render();if(Home.inside()&&(S.view==="kitchen"||S.view==="cabin")){const e=document.getElementById("v-"+S.view);if(e)e.insertAdjacentHTML("afterbegin",`<div class="backh"><button onclick="go('home')">← 집으로</button></div>`)}Q.track$();Q.render();Sea.mark()}
window.Win=Win;window.Bgm=Bgm;window.Home=Home;window.Q=Q;window.Sea=Sea;Win.apply();Sea.start();
