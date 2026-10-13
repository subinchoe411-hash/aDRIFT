/* 표류여행 선원 시스템.
   - 선장 쪽: 배에 탄 선원의 직책이 장면 선택지를 돕고, 전투·잠수에 함께하며, 항해일지에 선원들의 모습이 남는다.
   - 선원 쪽: 선장의 배를 같은 화면 틀(갑판·주방·선원실·소지품)으로 보며 직책에 맞는 일을 한다.
   online.js 다음에 불러온다. 서버가 없으면 아무 일도 하지 않는다. */
(()=>{
"use strict";
const O=window.Online;if(!O)return;
const RANKS=["견습 선원","갑판원","숙련 선원","갑판장"],RXP=[0,20,60,150];
const ROLES=[
 ["낚시꾼","","낚시 수확↑ · 전투 때 포격 지원이 강해짐"],
 ["요리사","","식사 효과↑ · 전투 때 응급처치가 강해짐"],
 ["망꾼","","망보기에서 더 많이 발견 · 교란 지원이 오래감"],
 ["정비공","","수리량↑ · 방패 태세 지원이 2턴 지속"],
 ["항해사","","항로 점검으로 배가 크게 빨라짐"],
 ["상인","","물물교환 수익↑"],
 ["잠수부","","잠수 수색↑ · 공기 보급·구조 줄 지원이 강해짐"]];
const ROLE_TXT=Object.fromEntries(ROLES.map(r=>[r[0],r]));
const DUTY=[
 ["fish","","낚시","낚시꾼","생선을 선장에게 올린다 (한 마리는 내 몫)"],
 ["cook","","식사 준비","요리사","선장의 허기를 달랜다"],
 ["lookout","","망보기","망꾼","새 섬이나 보물 단서를 찾는다"],
 ["repair","","선체 수리","정비공","선체를 고친다"],
 ["navigate","","항로 점검","항해사","배가 한동안 빨라진다"],
 ["haggle","","물물교환","상인","선장에게 용돈을 벌어 준다"],
 ["dive","","잠수 수색","잠수부","바닥을 훑어 조개·해초를 건진다"]];
const BSUP=[["fire","","포격 지원","적 하나를 크게 때린다"],["mend","","응급처치","가장 다친 사람을 치료한다"],["guard","","방패 태세","선장 앞을 막아 피해를 줄인다"],["distract","","교란","적이 한 턴 움직이지 못한다"]];
const DSUP=[["air","","공기 보급","선장의 산소를 채운다"],["rescue","","구조 줄","선장의 체력을 회복시킨다"]];
const plain=t=>O.plain(t);
// 받침에 따라 이/가, 은/는, 을/를, 과/와 를 맞춘다 (한글이 아니면 받침 없음으로 본다)
const batchim=w=>{const ch=String(w).trim().slice(-1),c=ch.charCodeAt(0);if(/[0-9]/.test(ch))return "013678".includes(ch);return c>=0xac00&&c<=0xd7a3&&(c-0xac00)%28!==0};
const JS={"이(가)":["이","가"],"은(는)":["은","는"],"을(를)":["을","를"],"과(와)":["과","와"]};
const jo=(w,m)=>JS[m][batchim(w)?0:1];
// 템플릿의 {A} {B} {N} {I} 를 채운다. 뒤에 조사 표기가 붙어 있으면 이름 끝소리에 맞춘다 (이름은 <b> 로 감싼다)
function fillTpl(t,v){return t.replace(/\{([ABNI])\}(이\(가\)|은\(는\)|을\(를\)|과\(와\))?/g,(_,k,m)=>{const w=v[k]==null?"":String(v[k]);return "<b>"+esc(w)+"</b>"+(m?jo(w,m):"")})}
const aboard=()=>{const r=O.data;return r&&r.crew?r.crew.captainOf.filter(m=>m.online):[]};

/* ================================================================
   선장 쪽
   ================================================================ */
// 배에 탄 선원의 직책은 선장이 그 직책을 가진 것처럼 쳐 준다 (게임 본체의 hasRole 이 부른다)
O.crewHas=r=>aboard().some(m=>m.role===r);
O.crewWho=r=>{if(!O.crewHas(r))return "";const q=RQ[r];const self=q?(q[1]?lv(q[1])>=3:C.st[q[0]]>=5):false;if(self)return "";const m=aboard().find(x=>x.role===r);return ` (선원 ${esc(m.name)})`};
O.advMark=i=>{const a=S.pend&&S.pend.adv&&S.pend.adv[i];return a&&a.length?` ★${a.length>1?"×"+a.length:""}`:""};
O.advBonus=i=>{const a=S.pend&&S.pend.adv&&S.pend.adv[i];return a?Math.min(.1,.05*a.length):0};

// 선원이 볼 수 있게 올리는 배 상태
O.snapExtra=()=>{
 const x={hr:Math.round(HRF()*10)/10,wind:Math.round(S.wind),ws:Math.round(S.ws*10)/10,vr:Math.round(vis()*10)/10};
 if(S.tx!==null){x.tx=Math.round(S.tx*10)/10;x.ty=Math.round(S.ty*10)/10;try{x.dst=Math.round(remD()*10)/10}catch(e){}}
 if(S.act)x.act=S.act.n;
 if(S.bt&&!S.bt.done){const b=S.bt;x.bt={t:b.t,rd:b.rd,tg:b.tg,en:b.en.map(e=>({n:e.n,hp:Math.max(0,Math.round(e.hp)),mhp:e.mhp})),al:b.al.map(a=>({n:a.n,hp:Math.max(0,Math.round(hpv(a))),mhp:Math.round(mhv(a)),role:a.role||""})),log:b.log.slice(-3).map(plain)}}
 if(S.inC)x.dv={n:S.inC.n,z:DN[S.dist],air:Math.max(0,S.air),mx:S.airMax,hp:Math.round(S.hp),pm:hpm()};
 if(S.pend)x.sc={t:plain(S.pend.t).slice(0,140),o:S.pend.o.map(o=>plain(o[0]).slice(0,36))};
 return x};
// 전투·잠수·장면 중엔 선원과 더 자주 주고받는다
O.hot=()=>{
 if(O.crewMode){const m=O.data&&O.data.crew.memberOf,sn=m&&m.ship&&m.ship.snap;return !!(sn&&(sn.bt||sn.dv||sn.sc))}
 return gameOn()&&aboard().length>0&&!!(S.bt||S.inC||S.pend)};
function gameOn(){return O.gameOn()}

/* ---- 항해일지에 남는 선원들의 모습 ---- */
const CL={
 depart:["{A}이(가) 닻줄을 있는 힘껏 끌어올린다. 닻이 물 위로 올라오자 배가 천천히 움직이기 시작한다.","\"출항합니다!\" {A}의 외침에 맞춰 돛이 활짝 펴지고 배가 바다로 미끄러져 나간다.","{A}이(가) 돛줄을 당기자 돛이 바람을 가득 머금는다. {B}이(가) 키 곁에서 고개를 끄덕인다.","항구가 점점 멀어진다. {A}이(가) 뱃전에 기대 오래도록 뭍을 바라본다.","{A}이(가) 뱃노래를 흥얼거리며 밧줄을 정리한다. 배가 파도를 가르기 시작했다."],
 anchor:["{A}이(가) 닻을 던지자 사슬이 철렁이며 바다 밑으로 사라진다. 배가 천천히 멈춰 선다.","돛이 접히고 배가 파도에 가만히 흔들린다. {A}이(가) \"한숨 돌리겠군요\" 하고 웃는다.","닻이 바닥에 걸렸다. {A}이(가) 사슬을 한 번 당겨 보고 \"튼튼합니다\" 하고 보고한다."],
 dock:["부두에 닿자 {A}이(가) 먼저 뛰어내려 밧줄을 묶는다. {I}의 냄새가 코끝에 닿는다.","{I}의 부두가 보인다. {A}이(가) 환호하며 손을 흔든다.","{A}이(가) 계류 밧줄을 던지고, 부두의 사내가 받아 말뚝에 건다. 무사히 {I}에 닿았다."],
 land:["{A}이(가) 널빤지를 내려 길을 낸다. \"먼저 다녀오십시오, 선장님. 배는 저희가 지키겠습니다.\"","{A}이(가) 뭍을 향해 고개를 숙이고 인사한다. 잠시 다리를 펴고 싶은 눈치다.","{A}이(가) 배에 남아 번을 서기로 했다. 선장은 뭍으로 오른다."],
 leave:["{A}이(가) 돌아오는 선장을 보고 손을 흔든다. \"무사하셨군요!\"","배로 돌아오자 {A}이(가) 따뜻한 차를 내밀었다. 뭍의 먼지가 씻기는 기분이다.","{A}이(가) \"다녀오셨습니까\" 하며 닻줄을 풀 채비를 한다."],
 meal:["{A}과(와) 갑판에 둘러앉아 함께 식사를 했다. 혼자 먹을 때보다 음식이 훨씬 맛있다.","{A}이(가) 옆에서 숟가락을 놓고 이야기보따리를 풀었다. 웃음이 터진다.","식사하는 동안 {A}이(가) 지난 항해의 모험담을 늘어놓았다. 어느새 그릇이 비었다.","{A}이(가) 말없이 소금통을 건넨다. 작은 배려에 마음이 놓인다."],
 dawn:["동이 튼다. {A}이(가) 갑판을 닦다 말고 붉게 물든 수평선을 올려다본다.","새벽 안개 사이로 해가 떠오른다. {A}이(가) \"오늘도 순풍이길\" 하고 중얼거린다."],
 noon:["해가 머리 위에 걸렸다. {A}이(가) 모자를 깊이 눌러쓰고 갑판에 물을 뿌린다.","한낮의 바다가 눈부시게 반짝인다. {A}이(가) 눈을 가늘게 뜨고 돛을 살핀다."],
 dusk:["노을이 바다를 붉게 물들인다. {A}이(가) 갑판에 앉아 말없이 그 빛을 바라본다.","해가 수평선에 닿는다. {A}이(가) 등불에 불을 붙이며 \"오늘도 무사했군요\" 한다."],
 night:["밤이 깊었다. {A}이(가) 야간 당직을 자청하고 돛대 아래 등불 곁에 앉는다.","별이 쏟아진다. {A}이(가) 별자리를 하나씩 짚으며 조용히 이름을 읊는다.","파도 소리뿐인 밤. {A}이(가) 낮은 목소리로 고향 노래를 부른다."],
 amb:["{A}이(가) 갑판을 닦으며 콧노래를 흥얼거린다.","{A}이(가) {B}에게 \"저 구름 모양 좀 보세요\" 하며 웃는다.","갈매기 한 마리가 돛대에 앉자 {A}이(가) 빵 부스러기를 던져 준다.","{A}이(가) 밧줄을 고쳐 매며 \"이 배는 정말 튼튼하군요\" 하고 선체를 쓰다듬는다.","{A}이(가) 뱃전에서 물고기 떼가 지나가는 걸 가리킨다. \"오늘 저녁은 풍성하겠는데요.\"","바람이 방향을 살짝 틀었다. {A}이(가) 돛줄을 당겨 각도를 맞춘다.","{A}과(와) {B}이(가) 고향 이야기를 나누는 소리가 바람에 실려 온다.","{A}이(가) 낡은 나침반을 꺼내 한참 들여다보더니 \"방향이 맞습니다\" 하고 고개를 끄덕인다.","배가 파도를 넘을 때마다 {A}이(가) 비틀거리다가 웃음을 터뜨린다.","{A}이(가) 해적왕 이야기를 들려주고 있다. 다들 귀를 쫑긋 세운다.","{A}이(가) 갑판 한쪽에서 졸다가 파도 소리에 화들짝 깼다.","저 멀리 고래의 물줄기가 솟는다. {A}이(가) \"선장님, 저기 보세요!\" 하고 손짓한다.","{A}이(가) 키 옆에서 선장에게 따뜻한 차를 건넨다. \"좀 쉬세요, 배는 제가 보겠습니다.\"","돛이 팽팽하게 부푼다. {A}이(가) 신이 나서 \"오늘 바람이 최고입니다!\" 하고 외친다.","{A}이(가) 갑판 아래에서 낡은 노래책을 찾아냈다. 한 곡조 흥얼대자 {B}이(가) 장단을 맞춘다."],
 storm:["{A}이(가) 돛줄에 매달려 \"돛을 붙잡겠습니다!\" 하고 소리친다. 파도가 갑판을 덮친다.","폭풍 속에서 {A}과(와) {B}이(가) 서로의 허리띠를 붙잡고 버틴다.","{A}이(가) 거센 빗속에서 선장을 향해 외친다. \"배는 저희가 지킵니다!\""],
 ghost:["{A}이(가) 얼굴이 하얗게 질려 선장의 소매를 붙잡는다. \"선장님... 저기, 저 배... 불빛이 없습니다.\"","등줄기가 서늘하다. {A}이(가) 떨리는 손으로 등불을 높이 든다.","{A}이(가) 낮은 목소리로 기도문을 외기 시작한다. 안개가 더 짙어진다."],
 scene:["{A}이(가) 긴장한 표정으로 다가온다. \"선장님, 어떻게 하시겠습니까?\"","{A}이(가) 조용히 선장 곁에 서서 상황을 살핀다. 다들 선장의 결정을 기다린다.","{A}과(와) {B}이(가) 눈빛을 주고받는다. 선택은 선장의 몫이다."],
 sceneGhost:["{A}이(가) 옷깃을 여미며 뒤로 한 걸음 물러난다. 이 배는 어딘가 이상하다."],
 ship:["돛대 위에서 {A}이(가) 외친다. \"배다! {N}의 배입니다!\"","{A}이(가) 망원경을 들고 한참 보더니 말한다. \"{N}의 배군요. 깃발이 평화롭습니다.\"","{A}이(가) 손을 크게 흔든다. \"{N}! 어이, {N}!\""],
 btStart:["{A}이(가) 갑판 위로 뛰어나와 무기를 움켜쥔다. \"선장님, 저도 함께 싸우겠습니다!\"","{A}이(가) 선실에서 방패를 끌어안고 뛰쳐나온다. \"등은 제가 지키겠습니다!\"","{A}이(가) 이를 악물고 선장 곁에 선다. \"여기까지 같이 온 배입니다. 끝까지 함께하겠습니다.\"","{A}이(가) 허리춤의 칼을 뽑아 들며 외친다. \"덤벼라!\"","{A}이(가) 떨리는 손으로 무기를 쥐고도 한 걸음 앞으로 나선다. \"저, 저도 있습니다!\""],
 btWin:["함성이 터졌다! {A}이(가) 주먹을 불끈 쥐고 {B}과(와) 어깨를 부딪친다.","숨을 몰아쉬던 {A}이(가) 선장에게 엄지를 치켜든다. \"해냈습니다, 선장님!\"","싸움이 끝나자 {A}이(가) 털썩 주저앉아 웃음을 터뜨린다. \"다들 무사하군요!\""],
 btLose:["{A}이(가) 쓰러진 선장을 부축해 선실로 옮긴다. \"버티십시오, 선장님!\"","{A}이(가) 이를 악물고 선장의 상처를 동여맨다."],
 btFlee:["{A}이(가) 돛줄을 당기며 외친다. \"전속력으로 빠집니다!\" 배가 적에게서 멀어진다."],
 dvIn:["{A}이(가) 선장의 허리에 줄을 단단히 묶어 준다. \"줄을 세 번 당기면 바로 끌어올리겠습니다.\"","선장이 숨을 들이쉬고 물에 뛰어든다. {A}이(가) 수면에서 줄을 잡고 기다린다."],
 dvOut:["{A}이(가) 줄을 당겨 선장을 끌어올린다. \"무사하셨군요!\"","수면 위로 솟자 {A}이(가) 담요를 덮어 준다. 차가운 몸이 서서히 녹는다."],
 dvClear:["수면의 {A}이(가) 줄을 느슨하게 풀어 주며 \"이제 더 깊이 가셔도 됩니다!\" 하고 외친다.","돌파에 성공하자 줄 끝에서 {A}의 환호가 전해진다."],
};
const RL={ // 직책에 따른 일상 대사
 낚시꾼:["{A}이(가) 고물에서 낚싯바늘을 손질하며 지난 월척 이야기를 늘어놓는다.","{A}이(가) 바다 빛깔을 읽고 \"저 아래 큰 놈이 있겠는데요\" 하고 입맛을 다신다."],
 요리사:["{A}이(가) 선실에서 소금을 헤아리며 \"오늘은 뭘 끓일까요\" 하고 중얼거린다.","{A}이(가) 향신료 냄새를 맡으며 흡족한 미소를 짓는다."],
 망꾼:["{A}이(가) 돛대 위에서 손차양을 하고 수평선을 한참 바라본다.","{A}이(가) 망원경을 닦으며 \"오늘은 시야가 좋습니다\" 하고 외친다."],
 정비공:["{A}이(가) 망치로 삐걱이는 판자를 두드리며 \"이만하면 한동안 버티겠습니다\" 한다.","{A}이(가) 선체 아래쪽을 살피며 이음새에 기름칠을 한다."],
 항해사:["{A}이(가) 해도 위에 컴퍼스를 대고 선을 긋는다. \"순조롭습니다, 선장님.\"","{A}이(가) 바람의 방향을 손끝으로 재며 돛줄 각도를 고친다."],
 상인:["{A}이(가) 장부를 펴 놓고 계산을 하다가 \"이 정도면 이문이 남겠군요\" 하고 웃는다.","{A}이(가) 다음 항구에서 팔 물건을 머릿속으로 꼽아 본다."],
 잠수부:["{A}이(가) 뱃전에서 숨을 길게 들이쉬며 잠수 준비 운동을 한다.","{A}이(가) 맑은 물 속을 들여다보며 \"바닥이 훤히 보입니다\" 하고 감탄한다."]};
const lastAt={};
function pickCrew(){const cr=aboard();if(!cr.length)return null;const A=cr[R(cr.length)],others=cr.filter(m=>m.id!==A.id);return{A,B:others.length?pick(others):A,cr}}
function crewText(kind,o){
 o=o||{};const p=pickCrew();if(!p||!CL[kind])return "";
 const pool=p.cr.length>1?CL[kind]:CL[kind].filter(x=>!x.includes("{B}"));   // 선원이 한 명이면 "A과 B" 문장은 쓰지 않는다
 let t=pick(pool.length?pool:CL[kind]);if(kind==="amb"&&p.A.role&&RL[p.A.role]&&rnd()<.5)t=pick(RL[p.A.role]);
 return fillTpl(t,{A:p.A.name,B:p.B.name,N:(o.n&&o.n.name)||"",I:o.isl||""})}
function crewLine(kind,o){
 if(!gameOn()||!aboard().length)return;
 o=o||{};const gap=o.gap==null?6:o.gap;if(S.t-(lastAt[kind]||-999)<gap)return;
 const t=crewText(kind,o);if(!t)return;lastAt[kind]=S.t;say("※ "+t)}
O.crewLine=crewLine;

/* ---- 게임 함수에 선원 이야기를 얹는다 ---- */
function wrap(name,fn){const orig=window[name];if(typeof orig!=="function")return;window[name]=function(){return fn.call(this,orig,arguments)}}
function install(){
 wrap("toggle",(orig,a)=>{const was=S.sail,r=orig.apply(null,a);if(S.sail&&!was)crewLine("depart",{gap:3});else if(!S.sail&&was&&S.dk<0&&S.isl===null)crewLine("anchor",{gap:3});return r});
 wrap("land",(orig,a)=>{const r=orig.apply(null,a);if(S.isl!==null)crewLine("land",{gap:3});return r});
 wrap("leave",(orig,a)=>{const was=S.isl,r=orig.apply(null,a);if(was!==null&&S.isl===null)crewLine("leave",{gap:3});return r});
 wrap("eat",(orig,a)=>{const r=orig.apply(null,a);if(rnd()<.6)crewLine("meal",{gap:30});return r});
 wrap("ghost",(orig,a)=>{const r=orig.apply(null,a);crewLine("ghost",{gap:0});return r});
 wrap("sc",(orig,a)=>{const r=orig.apply(null,a);if(S.pend&&!S.bt){const s0=SC[a[0]];crewLine(s0&&s0.gh?"sceneGhost":"scene",{gap:12})}return r});
 // 전투: 선원이 아군으로 선다
 wrap("startBattle",(orig,a)=>{const r=orig.apply(null,a);if(S.bt&&!S.bt.done)joinBattle();return r});
 wrap("eTurn",(orig,a)=>{const b=S.bt;if(!b||b.done)return;if(b._cr!==b.rd){b._cr=b.rd;crewRound()}if(!S.bt||S.bt.done)return;return orig.apply(null,a)});
 wrap("bEnd",(orig,a)=>{const b=S.bt,kind=a[0];const r=orig.apply(null,a);if(b)afterBattle(b,kind);return r});
 // 해저 도시: 수면에서 줄을 잡는 선원
 wrap("enterC",(orig,a)=>{const r=orig.apply(null,a);if(S.inC)crewLine("dvIn",{gap:0});return r});
 wrap("leaveC",(orig,a)=>{const was=!!S.inC,r=orig.apply(null,a);if(was)crewLine("dvOut",{gap:0});return r});
 wrap("clearDist",(orig,a)=>{const c=S.inC&&S.inC.cs.cl,i=S.dist,was=c&&c[i],r=orig.apply(null,a);if(S.inC&&!was&&S.inC.cs.cl[i]){crewLine("dvClear",{gap:0});report("dive")}return r});
 setInterval(watch,1000)}
let nextAmb=0,lastHr=-1,lastStorm=0,lastDk=-1;
const PHASE={5:"dawn",12:"noon",18:"dusk",22:"night"};
function watch(){
 if(!gameOn()||O.crewMode||!aboard().length){return}
 const hr=Math.floor(HRF());
 if(hr!==lastHr){if(lastHr>=0&&PHASE[hr]&&S.dk<0&&S.isl===null&&!S.inC)crewLine(PHASE[hr],{gap:60});lastHr=hr}
 const st=(S.ct&&S.ct.storm)||0;if(st>lastStorm){if(lastStorm>0||st>0)crewLine("storm",{gap:10});lastStorm=st}
 if(S.dk!==lastDk){if(S.dk>=0&&lastDk<0&&I[S.dk])crewLine("dock",{isl:I[S.dk].n,gap:5});lastDk=S.dk}
 if(S.sail&&!S.bt&&!S.inC&&!S.pend&&S.isl===null){if(S.t>=nextAmb){if(nextAmb)crewLine("amb",{gap:10});nextAmb=S.t+25+R(30)}}else if(!nextAmb||S.t>nextAmb+90)nextAmb=S.t+15}

/* ---- 전투 ---- */
const rankN=r=>Math.max(0,RANKS.indexOf(r));
function mkAlly(m){const r=rankN(m.rank);return{n:m.name,role:"선원"+(m.role?"·"+m.role:""),hp:40+r*12,mhp:40+r*12,atk:7+r*2,def:1+Math.floor(r/2),crew:m.id,st:{},q:[],acted:0}}
function joinBattle(){
 const b=S.bt,cr=aboard().slice(0,4);if(!cr.length)return;let i0=R(CL.btStart.length);
 cr.forEach(m=>{b.al.push(mkAlly(m));bl(`선원 ${m.name}${jo(m.name,"이(가)")} 갑판으로 뛰어나왔다!`);say("※ "+fillTpl(CL.btStart[(i0++)%CL.btStart.length],{A:m.name}))});
 renderAll()}
function crewRound(){
 const b=S.bt;if(!b||b.done)return;
 if(b.gd>0){b.def=true;b.gd--}
 for(const a of b.al.slice(1)){
  if(hpv(a)<=0)continue;const en=b.en.filter(e=>e.hp>0);if(!en.length)break;
  const tg=(b.en[b.tg]&&b.en[b.tg].hp>0)?b.en[b.tg]:en[0],q=a.q.shift(),kind=q?q.kind:"atk",pw=q?q.power:0;a.acted++;
  if(kind==="atk")bHit(tg,bDmg(a.atk,tg.def),a.n);
  else if(kind==="fire"){bl(`${a.n}${jo(a.n,"이(가)")} 포를 끌어 겨눈다!`);bHit(tg,bDmg(a.atk*1.4+pw*.8,tg.def),a.n+"(포격)")}
  else if(kind==="mend"){const w=bWeak();if(w)bHeal(w,pw,a.n+"의 응급처치")}
  else if(kind==="guard"){b.def=true;b.gd=Math.max(0,pw-1);bl(`${a.n}${jo(a.n,"이(가)")} 방패를 들고 선장 앞을 막아섰다!`)}
  else if(kind==="distract"){const t2=en.slice().sort((x,y)=>y.hp-x.hp)[0];t2.st.stun=Math.max(t2.st.stun||0,pw);bl(`${a.n}${jo(a.n,"이(가)")} 소리를 질러 ${t2.n}의 시선을 끈다! (${t2.n}${jo(t2.n,"이(가)")} 잠시 움직이지 못한다)`)}
  if(hpv(a)<=0)bl(`${a.n}${jo(a.n,"이(가)")} 쓰러졌다!`)}
 if(b.en.every(e=>e.hp<=0))bEnd("win")}
function afterBattle(b,kind){
 const al=b.al.slice(1);if(!al.length)return;
 const acted=al.filter(a=>a.acted>0&&a.crew);
 if(kind==="win"){
  const t=crewText("btWin");if(t)say("※ "+t);
  if(acted.length){const extra=acted.length*12+(al.every(a=>hpv(a)>0)?8:0);S.gold+=extra;say(`※ 함께 싸운 보람이 있다. 선원들이 전리품을 더 챙겨 왔다. (골드 +${extra})`);report("battle",acted.map(a=>a.crew));saveGame();renderAll()}}
 else if(kind==="lose"){const t=crewText("btLose");if(t)say("※ "+t)}
 else if(kind==="flee"){const t=crewText("btFlee");if(t)say("※ "+t)}}
async function report(kind,ids){
 try{ids=ids||aboard().map(m=>m.id);if(!ids.length)return;await O.api("/crew/coop",{kind,ids})}catch(e){}}

/* ---- 우편: 선원의 일·지원·건의 ---- */
const FX1=/^[fhsqbg]:-?\d{1,3}(?:\.\d)?$/;
const SUPNAME={fire:"포격 지원",mend:"응급처치",guard:"방패 태세",distract:"교란",air:"공기 보급",rescue:"구조 줄"};
O.applyExtra=d=>{
 const p=d.payload||{};
 if(d.kind==="crew_work"){
  const parts=[];let r="";
  if(p.items)for(const k in p.items){if(knownItem(k)){const n=Math.min(9,Math.floor(+p.items[k])||0);if(n>0){add(k,n);parts.push(`${esc(k)} ${n}`)}}}
  if(p.fx&&String(p.fx).split(";").every(x=>FX1.test(x))){r=fx(p.fx);if(S.hull>hm())S.hull=hm()}
  say(`※ ${esc(p.text||"선원이 일을 마쳤다.")} ${parts.join(", ")} ${r}`.trim());
 }else if(d.kind==="crew_support"){
  const by=esc(p.by),k=p.kind,pw=Math.max(0,Math.min(60,Math.floor(+p.power)||0));
  if(k==="fire"||k==="mend"||k==="guard"||k==="distract"){
   if(!S.bt||S.bt.done){say(`※ 전투가 끝나 ${by}의 ${SUPNAME[k]}${jo(SUPNAME[k],"이(가)")} 닿지 못했다.`);return}
   let a=S.bt.al.slice(1).find(x=>x.n===p.by);if(!a){a=mkAlly({name:p.by,role:p.role,rank:RANKS[0]});S.bt.al.push(a)}
   if(a.q.length<2)a.q.push({kind:k,power:pw});
   const msg={fire:"포를 끌어 겨눈다",mend:"붕대와 약초를 들고 달려온다",guard:"방패를 들고 선장 곁으로 다가선다",distract:"적의 시선을 끌 준비를 한다"}[k];
   say(`※ <b>${by}</b>${jo(p.by,"이(가)")} ${msg}! (${SUPNAME[k]})`);bl(`${p.by}${jo(p.by,"이(가)")} ${SUPNAME[k]}${jo(SUPNAME[k],"을(를)")} 준비한다.`);renderAll();
  }else if(k==="air"){
   if(!S.inC){say(`※ 잠수가 끝나 ${by}의 공기 보급이 닿지 못했다.`);return}
   S.air=Math.min(S.airMax,S.air+pw);say(`※ 수면의 <b>${by}</b>${jo(p.by,"이(가)")} 공기 주머니를 줄에 매달아 내려보냈다. (산소 +${pw})`);renderAll();
  }else if(k==="rescue"){
   if(!S.inC){say(`※ 잠수가 끝나 ${by}의 구조 줄이 닿지 못했다.`);return}
   S.hp=Math.min(hpm(),S.hp+pw);say(`※ <b>${by}</b>${jo(p.by,"이(가)")} 줄을 힘껏 당겨 선장을 안전한 곳으로 끌어당겼다. (체력 +${pw})`);renderAll();
  }
 }else if(d.kind==="crew_advice"){
  if(!S.pend||!S.pend.o[p.opt])return;
  const a=(S.pend.adv=S.pend.adv||{}),l=(a[p.opt]=a[p.opt]||[]);if(!l.includes(p.by))l.push(p.by);
  say(`※ 선원 <b>${esc(p.by)}</b>${jo(p.by,"이(가)")}${p.role?`(${esc(p.role)})`:""} 귓속말한다. "${esc(plain(S.pend.o[p.opt][0]).replace(/[ ✓·].*$/,""))}… 저는 이쪽이 좋겠습니다."`);renderAll()}};

/* ---- 함께하는 선원 (갑판 오른쪽 위 창) — 선장·선원 화면 공통 ---- */
const RICON=Object.fromEntries(ROLES.map(r=>[r[0],r[1]]));
function crewRow(o){
 const ri=Math.max(0,RANKS.indexOf(o.rank)),next=RXP[ri+1],pc=next?Math.round(100*(o.xp-RXP[ri])/(next-RXP[ri])):100;
 const days=o.joined?Math.max(1,Math.ceil((O.srvNow()-o.joined)/86400000)):0;
 const last=o.on?"접속 중":o.last?`${Math.max(1,Math.round((O.srvNow()-o.last)/60000))}분 전 접속`:"아직 접속 기록 없음";
 return `<div class="crew-row"><div class="av">${esc((o.name||"?").slice(0,1))}</div><div class="ci"><div class="cn"><b>${esc(o.name)}</b>${o.tag?` <span class="chip">${esc(o.tag)}</span>`:""}<span class="dot${o.on?" on":""}" title="${last}"></span></div><div class="sub sm">${o.sub||""}${o.rank?`${o.sub?" · ":""}${esc(o.rank)}`:""}${days?` · 승선 ${days}일째`:""}${o.tasks!=null?` · 일한 횟수 ${o.tasks}`:""} · ${last}</div>${o.rank?`<div class="xpb"><i style="width:${pc}%"></i></div>`:""}</div></div>`}
O.renderCrewInfo=()=>{
 const el=$("crewinfo");if(!el||!O.data)return;const c=O.data.crew;let h="";
 if(O.crewMode){
  const m=c.memberOf;if(!m)return;const sh=m.ship;
  h+=crewRow({icon:"船",name:m.captain,tag:"선장",sub:sh?esc(sh.ship):"",on:!!(sh&&sh.online),last:sh?sh.at:0});
  h+=m.shipmates.map(x=>crewRow({icon:(ROLE_TXT[x.role]||[])[1]||"員",name:x.cname||x.name,tag:x.role||"직책 미정",rank:x.rank,xp:x.xp,tasks:x.tasks,joined:x.joined,on:x.name===O.user.username||(!!x.last&&O.srvNow()-x.last<120000),last:x.last,sub:x.name===O.user.username?"나":""})).join("")}
 else if(gameOn()){
  h=c.captainOf.length?c.captainOf.map(m=>crewRow({icon:(ROLE_TXT[m.role]||[])[1]||"員",name:m.name,tag:m.role||"직책 미정",rank:m.rank,xp:m.xp,tasks:m.tasks,joined:m.joined,on:m.online,last:m.last})).join(""):`<div class="sub sm">함께하는 선원이 없다. 오른쪽 아래 '바다 위의 사람들'에서 친구를 선원으로 초대해 보자. 선원은 직책에 맞는 일을 하고, 전투와 잠수도 함께한다.</div>`}
 else return;
 if(el._h!==h){el._h=h;el.innerHTML=h}};

/* ================================================================
   선원 쪽 — 같은 화면 틀을 쓰되 선장실 대신 선원실
   ================================================================ */
let cs={bag:{},sel:[],diary:[],known:[]},csTimer=0,tab="deck",crewLog=[],tick=0,loaded=false;
const stamp=()=>new Date().toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit"});
const bagN=()=>Object.values(cs.bag).reduce((a,b)=>a+b,0),BAGMAX=30;
function bagAdd(k,n){if(!knownItem(k)||n<=0)return 0;const a=Math.min(n,BAGMAX-bagN());if(a>0)cs.bag[k]=(cs.bag[k]||0)+a;dirty();return a}
function bagTake(k,n){if((cs.bag[k]||0)<n)return false;cs.bag[k]-=n;if(cs.bag[k]<=0)delete cs.bag[k];dirty();return true}
function diary(t){cs.diary.unshift(`${stamp()} ${t}`);cs.diary.length=Math.min(cs.diary.length,30);dirty()}
function dirty(){clearTimeout(csTimer);csTimer=setTimeout(saveState,4000)}
async function saveState(){try{await O.api("/crewstate",{data:JSON.stringify({bag:cs.bag,diary:cs.diary,known:cs.known})},"PUT")}catch(e){}}
async function loadState(){
 try{const r=await O.api("/crewstate");if(r.data){const d=JSON.parse(r.data),bag={};for(const k in (d.bag||{})){if(knownItem(k)){const n=Math.floor(+d.bag[k]);if(n>0&&n<100)bag[k]=n}}
  cs.bag=bag;cs.diary=(Array.isArray(d.diary)?d.diary:[]).slice(0,30).map(x=>cleanStr(x,140));cs.known=(Array.isArray(d.known)?d.known:[]).slice(0,200).map(x=>cleanStr(x,30))}}catch(e){}
 loaded=true}
const me=()=>{const c=O.data&&O.data.crew;return c&&c.me?c.me:{purse:0,xp:0,rank:RANKS[0],role:"",cond:100,cd:{},dayLeft:0}};
const ship=()=>{const m=O.data&&O.data.crew.memberOf;return m&&m.ship?m.ship:null};
const snapOf=()=>{const s=ship();return s&&s.snap?s.snap:{}};
const secs=k=>Math.max(0,Math.ceil((((me().cd||{})[k]||0)-O.srvNow())/1000));
const bar=(v,m,w)=>`<div class="bar${v/Math.max(1,m)<(w||.3)?" w":""}"><i style="width:${Math.max(0,Math.min(100,v/Math.max(1,m)*100))}%"></i></div>`;

O.enterCrew=async()=>{
 O.crewMode=true;["title","create"].forEach(x=>$(x).hidden=true);$("game").hidden=false;
 try{genWorld()}catch(e){}try{setView()}catch(e){}
 build();go("deck");await loadState();O.syncNow();clearInterval(tick);tick=setInterval(timers,1000)};
O.exitCrew=()=>{saveState();location.reload()};
O.leaveShip=()=>{if(confirm("이 배에서 내릴까요? 쌓인 월급과 보관함은 그대로 남습니다."))O.api("/crew/leave",{}).then(()=>{saveState();location.reload()}).catch(e=>alert(e.message))};
O.cside=()=>{const s=$("side");s.className=s.className==="open"?"":"open"};
function build(){
 $("side").className="";
 $("side").innerHTML=`<div id="sm"><div class="smt"><span id="smn"></span><span id="smg"></span><button id="sbt" onclick="Online.cside()">정보 ▾</button></div><div class="smb"><span><em>선체</em><div class="bar" id="smub"><i></i></div></span><span><em>컨디션</em><div class="bar" id="smcb"><i></i></div></span></div></div>
 <div id="sbody"><b id="csn" style="font-size:16px"></b><div class="sub sm" id="cscap"></div><div class="sub sm" id="csclk" style="margin-top:8px"></div><div class="sub sm" id="cswh"></div>
 <h2>배 상태</h2><div class="row"><span>선체</span><span id="chv" class="sm"></span></div><div class="bar" id="chb"><i></i></div><div class="row"><span>허기 (선장)</span><span id="cfv" class="sm"></span></div><div class="bar" id="cfb"><i></i></div><div class="row"><span>체력 (선장)</span><span id="cpv" class="sm"></span></div><div class="bar" id="cpb"><i></i></div>
 <h2>나</h2><div class="row"><span>이름</span><span id="cnm"></span></div><div class="row"><span>직책</span><span id="crl"></span></div><div class="row"><span>계급</span><span id="crk"></span></div><div class="row"><span>컨디션</span><span id="ccv" class="sm"></span></div><div class="bar" id="ccb"><i></i></div><div class="row"><span>쌓인 월급</span><span id="cpu"></span></div><div class="row"><span>오늘 더 받을 수 있는 월급</span><span id="cdl" class="sm"></span></div>
 <h2>항해</h2><div class="row"><span>방위</span><span id="chd"></span></div><div class="row"><span>속력</span><span id="ckn"></span></div><div class="row"><span>바람</span><span id="cwd"></span></div><div class="row"><span>남은 거리</span><span id="cds"></span></div>
 <h2>메뉴</h2><div><button onclick="Online.exitCrew()">타이틀로</button><button onclick="Online.leaveShip()">배에서 내리기</button></div><div class="sub sm">타이틀로 가도 배에는 계속 타고 있습니다.</div></div>`;
 $("tabs").innerHTML=[["deck","갑판"],["kitchen","주방"],["cabin","선원실"],["inv","소지품"]].map(([k,n])=>`<button data-t="${k}" onclick="Online.cgo('${k}')">${n}</button>`).join("");
 ["island","city","storage"].forEach(k=>$("v-"+k).hidden=true);$("bw").hidden=true;
 if(!$("cpick")){const d=document.createElement("div");d.id="cpick";d.hidden=true;$("rt").appendChild(d)}}
function go(t){tab=t;document.querySelectorAll("#tabs button").forEach(b=>b.className=b.dataset.t===t?"on":"");render()}
O.cgo=go;

O.renderCrew=()=>{
 if(!O.crewMode||!O.data)return;const m=O.data.crew.memberOf;
 if(!m){$("rt").innerHTML=`<div class="pan"><h2>선원 시점</h2><p class="sub">이제 어느 배에도 타고 있지 않습니다.</p><button onclick="Online.exitCrew()">타이틀로</button></div>`;return}
 render()};
function render(){
 if(!O.crewMode||!O.data||!O.data.crew.memberOf||!$("csn"))return;
 const need=!me().role;      // 직책을 정하기 전에는 직책 선택 화면만 보인다
 $("tabs").hidden=need;$("cpick").hidden=!need;
 ["deck","kitchen","cabin","inv"].forEach(k=>$("v-"+k).hidden=need||k!==tab);
 side();
 if(need){picker();timers();return}
 if(tab==="deck")deck();else if(tab==="kitchen")kitchen();else if(tab==="cabin")cabin();else inv();
 timers()}
function picker(){
 const m=O.data.crew.memberOf,sh=m.ship;
 $("cpick").innerHTML=`<div class="pan"><h2 style="margin-top:0">직책을 정하세요</h2>
 <div class="sm" style="margin:8px 0 4px">선원 캐릭터의 이름 <span class="sub">(항해일지와 채팅에 아이디 대신 이 이름이 보입니다)</span></div><input id="cname" maxlength="12" placeholder="예: 바람이" style="width:min(320px,100%);margin-bottom:10px">
 <div class="sub sm" style="margin-bottom:8px">${esc(m.captain)} 선장의 ${esc(sh?sh.ship:"배")}에 선원으로 타기 전에 맡을 직책을 하나 정합니다. 직책에 맞는 장면 선택지는 선장이 더 유리해지고, 직책의 일은 효과와 월급이 커집니다. <b>탑승 중에는 바꿀 수 없고</b>, 바꾸려면 배에서 내렸다가 다시 탑승해야 합니다.</div>
 ${ROLES.map(([r,ic,d])=>`<div class="row seat"><span>${ic} <b>${r}</b><br><span class="sub sm">${d}</span></span><button class="pri" onclick="Online.role('${r}')">이 직책으로 시작</button></div>`).join("")}</div>`;
 const nm=$("cname");if(nm&&!nm.value&&me().cname)nm.value=me().cname}
const D8=["북","북동","동","남동","남","남서","서","북서"];
function side(){
 const m=O.data.crew.memberOf,sh=m.ship,sn=snapOf(),mm=me();
 $("csn").textContent=sh?sh.ship:"배";$("cscap").textContent=`선장 ${m.captain}`+(sh&&sh.online?" · 접속 중":"");
 $("csclk").textContent=sn.d?`${TODI[todOf(HRF())]+" "}항해 ${sn.d}일째`:"";applyTod();
 const state=!sh?"아직 출항 전":!sh.online?`선장이 자리를 비웠다 (${Math.max(0,Math.round((O.srvNow()-sh.at)/60000))}분 전)`:sn.dv?`${sn.dv.n} 잠수 중`:sh.loc==="port"?`${sn.in||"부두"}에 정박`:sn.sail?"항해 중":"바다에서 닻을 내림";
 $("cswh").textContent=state;
 const set=(k,v,mx,w)=>{$("c"+k+"v").textContent=Math.round(v)+" / "+mx;$("c"+k+"b").firstElementChild.style.width=Math.max(0,Math.min(100,v/Math.max(1,mx)*100))+"%";$("c"+k+"b").className="bar"+(v/Math.max(1,mx)<w?" w":"")};
 if(sn.h!=null){set("h",sn.h,sn.hm,.3);set("f",sn.f,100,.25);set("p",sn.p,sn.pm,.3)}
 $("cnm").textContent=mm.cname||"";$("crl").textContent=mm.role?`${(ROLE_TXT[mm.role]||[])[1]||""} ${mm.role}`:"미정";$("crk").textContent=mm.rank;
 set("c",mm.cond,100,.25);$("cpu").textContent=mm.purse+" G";$("cdl").textContent=mm.dayLeft+" G";
 $("chd").textContent=sh?Math.round(sh.hd)+"°":"—";$("ckn").textContent=sn.sail?(sn.kn||0)+" 노트":"—";
 $("cwd").textContent=sn.wind!=null?D8[Math.round(((sn.wind+180)%360)/45)%8]+"풍 · "+(sn.ws<.85?"약함":sn.ws<1.2?"보통":"강함"):"—";
 $("cds").textContent=sn.dst!=null?sn.dst+" 해리":"—";
 $("smn").textContent=`${sh?sh.ship:"배"} · ${mm.cname||mm.rank}`;$("smg").textContent=mm.purse+" G";
 const sb=(k,v,mx,w)=>{$(k).firstElementChild.style.width=Math.min(100,Math.max(0,v/Math.max(1,mx)*100))+"%";$(k).className="bar"+(v/Math.max(1,mx)<w?" w":"")};
 if(sn.h!=null)sb("smub",sn.h,sn.hm,.3);sb("smcb",mm.cond,100,.25)}

/* ---- 갑판 ---- */
function mapSvg(sh,sn){
 const x=sh.x,y=sh.y,seen=new Set(sn.seen||[]);I.forEach((w,i)=>{if(i===0)seen.add(0)});
 let s=`<g transform="translate(${VW/2-x*K},${VH/2-y*K})"><g stroke="var(--line)" stroke-width=".5">`;
 for(let gx=Math.floor((x-16)/5)*5;gx<x+16;gx+=5)s+=`<line x1="${gx*K}" y1="${(y-12)*K}" x2="${gx*K}" y2="${(y+12)*K}"/>`;
 for(let gy=Math.floor((y-12)/5)*5;gy<y+12;gy+=5)s+=`<line x1="${(x-16)*K}" y1="${gy*K}" x2="${(x+16)*K}" y2="${gy*K}"/>`;s+=`</g>`;
 const vv=sn.vr||6;
 I.forEach((w,i)=>{if(!seen.has(i))return;const dx=dl(w.x-x,WW),dy=dl(w.y-y,WH);if(Math.abs(dx)>VW/2/K+w.rm+1||Math.abs(dy)>VH/2/K+w.rm+1)return;
  const ox=Math.round((x+dx-w.x)/WW)*WW*K,oy=Math.round((y+dy-w.y)/WH)*WH*K,dd=Math.hypot(dx,dy),op=dd-w.rm<=vv?1:.6,na=Math.max(.3,Math.min(1,1.2-dd/(vv*1.2)));
  s+=`<g transform="translate(${ox},${oy})" opacity="${op}"><path d="${w.p2}" fill="var(--sh)"/><path d="${w.p}" fill="var(--land)" stroke="var(--sub)" stroke-width="1"/><path d="${w.p3}" fill="var(--hi)"/><text x="${w.x*K}" y="${w.y*K+3}" font-size="${na>.7?10:9}" text-anchor="middle" fill="${na>.7?"var(--ink)":"var(--sub)"}" fill-opacity="${na}">${w.n}</text></g>`});
 s+=`<circle cx="${x*K}" cy="${y*K}" r="${vv*K}" fill="none" stroke="var(--line)" stroke-dasharray="3 5"/>`;
 if(sn.tx!=null)s+=`<line x1="${x*K}" y1="${y*K}" x2="${(x+dl(sn.tx-x,WW))*K}" y2="${(y+dl(sn.ty-y,WH))*K}" stroke="var(--acc)" stroke-dasharray="4 4"/><circle cx="${(x+dl(sn.tx-x,WW))*K}" cy="${(y+dl(sn.ty-y,WH))*K}" r="4" fill="none" stroke="var(--acc)"/>`;
 s+=`</g><g transform="translate(${VW/2},${VH/2}) rotate(${sh.hd}) scale(${[1.3,1.1,.95,.85][sh.lv||0]})">${shipG(sh.lv||0)}</g>`;
 if(sn.wind!=null)s+=`<g transform="translate(${VW-28},${VH-40}) rotate(${sn.wind})" stroke="var(--sub)" fill="none"><line y1="14" y2="-14"/><path d="M-4,-8 L0,-14 L4,-8"/></g><text x="${VW-28}" y="${VH-12}" font-size="8" text-anchor="middle" fill="var(--sub)">바람</text>`;
 s+=`<g transform="translate(34,36)" fill="none" stroke="var(--sub)"><circle r="17"/><circle r="13" stroke-dasharray="1 3"/><path d="M0,-15 L3,-3 L15,0 L3,3 L0,15 L-3,3 L-15,0 L-3,-3Z" fill="var(--hi)"/><path d="M0,-15 L3,-3 L-3,-3Z" fill="var(--warn)" stroke="none"/><text y="-21" font-size="9" text-anchor="middle" fill="var(--warn)" stroke="none">N</text></g>`;
 return s}
const cb=(label,fn,dis,pri,attr)=>`<button class="${pri?"pri":""}" ${attr||""} onclick="${fn}" ${dis?"disabled":""}>${label}</button>`;
const gp=(t,b,h)=>`<div class="grp"><div class="gt">${t}</div><div class="gb">${b}${h?`<div class="sub sm" style="margin-top:2px">${h}</div>`:""}</div></div>`;
const supBtns=(arr,mm)=>arr.map(([k,ic,n,d])=>{const sec=secs("sup:"+k);return cb(`${ic} ${n}${sec>0?` (${sec}초)`:""}`,`Online.support('${k}')`,sec>0||mm.cond<8,0,`data-sup="${k}" data-l="${ic} ${n}" title="${esc(d)}"`)}).join("");
const supHelp=arr=>arr.map(x=>`${x[1]} ${x[3]}`).join(" · ");
function deck(){
 const sh=ship(),sn=snapOf(),mm=me();
 if(sh){$("dy").innerHTML=mapSvg(sh,sn)}else $("dy").innerHTML="";
 const act=(sn.act?`<div class="sm sub" style="margin-bottom:6px">선장은 지금 <b>${esc(sn.act)}</b> 중이다.</div>`:"")+(mm.role?"":`<div class="sm" style="margin-bottom:6px;color:var(--warn)">직책이 아직 없다. 선원실 탭에서 직책을 정하면 선장이 더 유리해지고 일의 효과가 커진다.</div>`);
 const own=DUTY.find(d=>d[3]===mm.role),rest=DUTY.filter(d=>d!==own);
 const dbtn=d=>{const sec=secs(d[0]);return cb(`${d[1]} ${d[2]}${sec>0?` (${sec}초)`:""}`,`Online.duty('${d[0]}')`,sec>0||mm.cond<12,d===own,`data-duty="${d[0]}" data-l="${d[1]} ${d[2]}" title="${esc(d[4])}"`)};
 const rsec=secs("rest");
 $("acts").innerHTML=act+gp("배 위에서",(own?dbtn(own):"")+rest.map(dbtn).join(""),`${own?`<b>${own[1]} ${own[2]}</b>은(는) 내 직책(${esc(mm.role)})의 일이라 효과와 월급이 크다. `:""}일마다 컨디션이 12 든다.`)+gp("휴식",cb(`해먹에서 쉬기${rsec>0?` (${rsec}초)`:""}`,"Online.rest()",rsec>0||mm.cond>=95,0,`data-rest="1" data-l="해먹에서 쉬기"`)+cb("식사","Online.cgo('inv')",0));
 // 전투 / 잠수 / 장면
 const bt=$("btl"),pe=$("pend");
 if(sn.bt){const b=sn.bt;bt.className="card pend";bt.innerHTML=`<h2 style="margin-top:0">전투 — ${esc(b.t)} · 라운드 ${b.rd}</h2><div class="two"><div><h3>적</h3>${b.en.map(e=>`<div class="${e.hp<=0?"dead":""}"><div class="row"><span>${esc(e.n)}</span><span class="sm">${e.hp}/${e.mhp}</span></div>${bar(e.hp,e.mhp)}</div>`).join("")}</div><div><h3>아군</h3>${b.al.map(a=>`<div class="${a.hp<=0?"dead":""}"><div class="row"><span>${esc(a.n)} ${a.role?`<span class="sub sm">${esc(a.role)}</span>`:""}</span><span class="sm">${a.hp}/${a.mhp}</span></div>${bar(a.hp,a.mhp)}</div>`).join("")}</div></div><div style="margin-top:8px">${gp("지원",supBtns(BSUP,mm),supHelp(BSUP)+" — 선장이 다음에 행동할 때 전투에 반영된다")}</div><div class="sub sm bt-log">${(b.log||[]).map(l=>`<div>${esc(l)}</div>`).join("")}</div>`}
 else if(sn.dv){const d=sn.dv;bt.className="card pend";bt.innerHTML=`<h2 style="margin-top:0">잠수 — ${esc(d.n)} · ${esc(d.z||"")}</h2><div class="row"><span>선장의 산소</span><span class="sm">${d.air} / ${d.mx}</span></div>${bar(d.air,d.mx,.3)}<div class="row"><span>선장의 체력</span><span class="sm">${d.hp} / ${d.pm}</span></div>${bar(d.hp,d.pm)}<div style="margin-top:8px">${gp("수면에서 줄을 잡고 있다",supBtns(DSUP,mm),supHelp(DSUP))}</div>`}
 else{bt.className="";bt.innerHTML=""}
 if(sn.sc){const s=sn.sc;pe.className="card pend";pe.innerHTML=`<div>${esc(s.t)}</div><div class="sub sm" style="margin:6px 0">선장이 고르는 중이다. 이쪽이 좋겠다고 귓속말을 건넬 수 있다 (맞는 직책이면 선장이 더 유리해진다).</div>`+s.o.map((o,i)=>`<button onclick="Online.advise(${i})">★ ${esc(o)}</button>`).join("")}
 else{pe.className="";pe.innerHTML=""}
 // 기록: 선장의 항해일지 + 내가 한 일
 const lg=[...crewLog.map(x=>`<div>${esc(x)}</div>`),...(sn.logs||[]).map(x=>`<div>${esc(x)}</div>`)];
 $("log").innerHTML=lg.join("")||"<div>(기록 없음)</div>";
 O.renderChat();O.hookCrewChat&&O.hookCrewChat();O.renderCrewInfo()}
function timers(){
 if(!O.crewMode||!O.data||!O.data.crew.me)return;const mm=me();
 const lab=(b,sec)=>{const l=b.dataset.l;if(l)b.textContent=sec>0?`${l} (${sec}초)`:l};
 document.querySelectorAll("[data-duty]").forEach(b=>{const sec=secs(b.dataset.duty);b.disabled=sec>0||mm.cond<12;lab(b,sec)});
 document.querySelectorAll("[data-sup]").forEach(b=>{const sec=secs("sup:"+b.dataset.sup);b.disabled=sec>0||mm.cond<8;lab(b,sec)});
 document.querySelectorAll("[data-rest]").forEach(b=>{const sec=secs("rest");b.disabled=sec>0||mm.cond>=95;lab(b,sec)})}

const note=t=>{crewLog.unshift(`${stamp()} ${t}`);crewLog.length=Math.min(crewLog.length,12)};
async function act(fn){try{await fn()}catch(e){note("※ "+e.message)}O.syncNow();render()}
O.duty=k=>act(async()=>{const r=await O.api("/crew/duty",{duty:k});
 let extra="";if(r.mine){for(const it in r.mine){if(bagAdd(it,r.mine[it]))extra=` (내 몫으로 ${it} ${r.mine[it]} 챙겼다)`}}
 note(`${r.msg}${r.wage?` (월급 +${r.wage}G)`:""}${extra}`);diary(r.msg)});
O.support=k=>act(async()=>{const r=await O.api("/crew/support",{kind:k});note(`${SUPNAME[k]}${r.bonus?" (직책의 솜씨!)":""} — 선장에게 닿았다.`)});
O.advise=i=>act(async()=>{await O.api("/crew/advise",{opt:i});note("선장에게 귓속말을 건넸다.")});
O.rest=()=>act(async()=>{const r=await O.api("/crew/rest",{});note(r.msg);diary(r.msg)});
O.role=r=>{const name=cleanName(($("cname")||{}).value||"").trim(),raw=(($("cname")||{}).value||"").trim();if(!raw){alert("선원 캐릭터의 이름을 먼저 정해 주세요.");return}
 if(!confirm(`「${name}」, 직책 「${r}」(으)로 시작할까요? 탑승 중에는 직책을 바꿀 수 없습니다.`))return;act(async()=>{await O.api("/crew/role",{role:r,name:raw});note(`${name}(으)로서 「${r}」 직책을 맡아 일을 시작했다.`)})};
O.crewDeliveries=async list=>{
 const mine=(list||[]).filter(d=>d.kind==="coop_note");if(!mine.length)return;
 const got=(await O.api("/claim",{ids:mine.map(d=>d.id)})).deliveries;
 got.forEach(d=>{const t=cleanStr(d.payload&&d.payload.text,120);if(t){note("※ "+t);diary(t)}})};
O.crewSay=t=>{const m=O.data&&O.data.crew.memberOf;if(!m)return;O.api("/chat",{channel:"crew:"+m.captainId,text:t}).then(()=>O.syncNow()).catch(e=>note("※ "+e.message))};

/* ---- 주방 ---- */
function kitchen(){
 const items=Object.keys(cs.bag).sort(),sel=cs.sel.filter(k=>k==="물"||cs.bag[k]>0),dishes=items.filter(k=>EDI(k));
 cs.sel=sel;
 $("v-kitchen").innerHTML=VHD(IC.kit,"선원 주방","낚시로 얻은 내 몫의 재료로 요리해 선장에게 올리거나 직접 먹는다")+
 `<div class="two"><div><h2>재료 (내 보관함 ${bagN()}/${BAGMAX})</h2>`+
 (`<button class="${sel.includes("물")?"on":""}" onclick="Online.csel('물')">물 (무한)</button>`+items.map(k=>`<button class="${sel.includes(k)?"on":""}" onclick="Online.csel('${esc(k)}')">${esc(k)} ×${cs.bag[k]}</button>`).join(""))+
 `<div style="margin-top:8px"><button class="pri" onclick="Online.ccook()" ${sel.length<2||sel.length>3?"disabled":""}>조리 (재료 2~3개)</button></div><div class="sub sm">고른 재료: ${sel.map(esc).join(" + ")||"없음"}</div></div>
 <div><h2>만든 음식</h2>${dishes.length?dishes.map(k=>`<div class="row"><span>${esc(k)} ×${cs.bag[k]} <span class="sub sm">허기 ${BV[k]}</span></span><span><a onclick="Online.ceat('${esc(k)}')">먹기</a><a onclick="Online.cserve('${esc(k)}')">선장에게 올리기</a></span></div>`).join(""):"<div class='sub sm'>만든 음식이 없다. 낚시로 재료를 모아 보자.</div>"}
 <h2>아는 레시피 ${cs.known.length}개</h2><div class="sub sm">${cs.known.slice(-8).map(esc).join(", ")||"아직 없다"}</div></div></div>`}
O.csel=k=>{const i=cs.sel.indexOf(k);if(i>=0)cs.sel.splice(i,1);else if(cs.sel.length<3)cs.sel.push(k);kitchen()};
O.ccook=()=>{
 const ing=cs.sel.slice();if(ing.length<2||ing.length>3)return;
 for(const k of ing)if(k!=="물"&&!(cs.bag[k]>0)){note(k+"이(가) 없다.");return render()}
 if(bagN()-ing.filter(k=>k!=="물").length+1>BAGMAX){note("보관함이 가득 찼다.");return render()}
 ing.forEach(k=>{if(k!=="물")bagTake(k,1)});cs.sel=[];
 const key=ing.slice().sort().join(),r=RC.find(r=>r.i.slice().sort().join()===key);
 if(!r){bagAdd("정체불명의 요리",1);note("조리: 정체불명의 요리가 나왔다. 그래도 먹을 수는 있다.");diary("정체불명의 요리를 만들었다.")}
 else{const was=cs.known.includes(r.n);bagAdd(r.n,1);if(!was)cs.known.push(r.n);const t=was?`조리: ${r.n}을(를) 만들었다.`:`조리: 새 레시피를 알아냈다 — ${r.n} (${r.i.join("+")})`;note(t);diary(t)}
 render()};
O.ceat=k=>{if(!(cs.bag[k]>0))return;act(async()=>{await O.api("/crew/eat",{v:BV[k]||10});bagTake(k,1);const t=`${k}을(를) 먹었다. 기운이 난다.`;note(t);diary(t)})};
O.cserve=k=>{if(!(cs.bag[k]>0))return;act(async()=>{await O.api("/crew/serve",{item:k});bagTake(k,1);note(`${k}을(를) 선장에게 올렸다.`)})};

/* ---- 선원실 (선장실 대신) ---- */
function cabin(){
 const m=O.data.crew.memberOf,mm=me(),ri=Math.max(0,RANKS.indexOf(mm.rank)),next=RXP[ri+1],sn=snapOf();
 const seen=(sn.seen||[]).map(i=>I[i]&&I[i].n).filter(Boolean);
 const talk=[["식사 시간입니다, 선장님. 든든히 드셔야 합니다!","식사하시죠"],["다들 지쳤습니다. 닻을 내리고 잠시 쉬어 가면 어떨까요?","쉬어 가요"],["뭔가 불길한 기운이 느껴집니다. 조심하세요, 선장님!","불길해요"],["항해가 순조롭습니다, 선장님!","순조로워요"],...(seen.length?[[`근처 ${pick(seen)}에 들러 보면 어떨까요?`,"섬에 들러요"]]:[])];
 $("v-cabin").innerHTML=VHD(IC.cab,"선원실","선원들이 쉬고 짐을 두는 방 — 해먹과 사물함, 그리고 내 일지")+
 ` <div class="two"><div><h2>직책</h2><div class="row seat"><span>${(ROLE_TXT[mm.role]||[])[1]||""} <b>${esc(mm.role)}</b><br><span class="sub sm">${esc((ROLE_TXT[mm.role]||[])[2]||"")}</span></span></div><div class="sub sm">직책은 탑승하기 전에 정한다. 바꾸려면 배에서 내렸다가 다시 탑승해야 한다.</div>
 <h2>동료</h2>${m.shipmates.map(x=>`<div class="row"><span>${esc(x.cname||x.name)}${x.name===O.user.username?" (나)":""}</span><span class="sub sm">${esc(x.role||"직책 미정")}</span></div>`).join("")||"<div class='sub sm'>없음</div>"}
 <h2>선장에게 한마디</h2><div class="sub sm" style="margin-bottom:4px">선원 채팅에 대신 말해 준다.</div>${talk.map(([t,l])=>`<button onclick="Online.crewSay(${JSON.stringify(t).replace(/"/g,"&quot;")})">${l}</button>`).join("")}</div>
 <div><h2>컨디션</h2>${bar(mm.cond,100,.25)}<div class="row"><span class="sm">${mm.cond} / 100 (30초에 1 회복)</span><button data-rest="1" data-l="해먹에서 쉬기" onclick="Online.rest()">해먹에서 쉬기</button></div>
 <h2>계급과 월급</h2><div class="row"><span>${esc(mm.rank)}</span><span class="sm">일한 횟수 ${mm.tasks||0} · 경험 ${mm.xp}${next?` / ${next}`:" (최고 계급)"}</span></div>${bar(mm.xp-RXP[ri],(next||RXP[ri]+1)-RXP[ri],0)}<div class="sub sm">계급이 오르면 쿨다운이 줄고 월급이 늘며, 전투에서 더 강한 아군이 된다. 월급은 내 항해를 시작하면 '바다 위의 사람들'에서 찾는다.</div>
 </div></div>
 <h2>내 일지</h2><div class="lg" style="max-height:200px">${cs.diary.map(x=>`<div>${esc(x)}</div>`).join("")||"<div class='sub'>아직 적을 것이 없다.</div>"}</div>`}

/* ---- 소지품 (내 보관함) ---- */
function inv(){
 const items=Object.keys(cs.bag).sort(),m=O.data&&O.data.crew.memberOf,st=m&&m.sto?m.sto:{items:{},cap:0},sk=Object.keys(st.items).sort(),sn=Object.values(st.items).reduce((a,b)=>a+b,0);
 const mv=(k,dir,n,lab)=>`<a onclick="Online.csto('${esc(k)}','${dir}',${n})">${lab}</a>`;
 $("v-inv").innerHTML=VHD(IC.inv,"소지품","내 사물함과, 선장과 함께 쓰는 배 창고")+`<div class="two"><div><h2>내 사물함 ${bagN()} / ${BAGMAX}</h2>`+
 (items.length?items.map(k=>`<div class="row"><span>${esc(k)} ×${cs.bag[k]} ${IT[k]?`<span class="sub sm">${esc(IT[k])}</span>`:""}</span><span>${EDI(k)?`<a onclick="Online.ceat('${esc(k)}')">먹기</a><a onclick="Online.cserve('${esc(k)}')">선장에게 올리기</a>`:""}${mv(k,"put",1,"창고에 1")}${cs.bag[k]>1?mv(k,"put",cs.bag[k],"전부"):""}<a onclick="Online.cdrop('${esc(k)}')">버리기</a></span></div>`).join(""):"<div class='sub'>비어 있다. 낚시를 하면 내 몫이 생긴다.</div>")+
 `</div><div><h2>배 창고 ${sn} / ${st.cap} <span class="sub">· 선장과 공유</span></h2>`+
 (sk.length?sk.map(k=>`<div class="row"><span>${esc(k)} ×${st.items[k]}</span><span>${mv(k,"take",1,"1개 꺼내기")}${st.items[k]>1?mv(k,"take",st.items[k],"전부"):""}</span></div>`).join(""):"<div class='sub'>비어 있다. 선장이 접속해 있으면 선장의 창고가 이곳에 보인다.</div>")+`</div></div>`}
O.csto=(k,dir,n)=>act(async()=>{n=Math.floor(+n);if(!(n>0))return;
 if(dir==="put"){if((cs.bag[k]||0)<n){note("사물함에 그만큼 없다.");return}await O.api("/ship/sto",{k,n:Math.min(n,99),dir});bagTake(k,Math.min(n,99));note(`${k} ${Math.min(n,99)}개를 배 창고에 넣었다.`)}
 else{if(!knownItem(k)){note("알 수 없는 물건이다.");return}const room=BAGMAX-bagN(),c=Math.min(n,99,room);if(c<=0){note("사물함이 가득 찼다.");return}await O.api("/ship/sto",{k,n:c,dir});bagAdd(k,c);note(`배 창고에서 ${k} ${c}개를 꺼냈다.`)}});
O.cdrop=k=>{if(bagTake(k,1))render()};

/* 선원 채팅 입력: 선원 시점에서는 배 채널로 말한다 (online.js 의 채팅 처리를 그대로 쓴다) */
let chSet=false;
O.hookCrewChat=()=>{const m=O.data&&O.data.crew.memberOf;if(m&&!chSet){chSet=true;O.setCh("crew:"+m.captainId)}};

install();
})();
