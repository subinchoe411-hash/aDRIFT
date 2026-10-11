# 표류여행

텍스트 항해 게임. `public/index.html` 하나로 혼자서도 돌아가고, 서버를 붙이면 **초대받은 사람끼리 같은 바다**에서 즐길 수 있다.

## 혼자 하기 (서버 없음)
`public/index.html`만 열거나 정적 사이트로 올리면 된다. 저장은 브라우저에만 된다. 서버가 없으면 온라인 기능은 저절로 꺼진다.

## 다인 서버가 하는 일
- 초대 코드로만 가입 → 아이디·비밀번호로 로그인. 저장 파일이 계정에 보관돼 어느 기기에서든 이어 할 수 있다.
- **마주침**: 같은 바다에서 가까워지거나 같은 부두에 닿으면 서로 보인다. 인사와 거래(맡김 방식)를 할 수 있다.
- **병 편지**: 띄운 병은 다른 플레이어가 줍고 답장을 보낼 수 있다. 줍는 사람이 없을 때를 위해 NPC 병 편지는 그대로 남아 있다.
- **채팅**: 월드 채팅, 그리고 내 배(선장·선원) 채팅.
- **선원 시점**: 선장이 아이디로 초대 → 수락하면 타이틀에서 '선원으로 탑승'. 선원은 낚시·식사 준비·망보기·수리를 하고(선장이 오프라인이어도 쌓였다가 선장이 돌아오면 반영), 월급이 쌓여 자기 항해에서 찾을 수 있다. 월급은 하루 200G까지.

접속자가 5초마다 한 번 동기화(폴링)하는 방식이라 서버가 가볍다. 10분간 입력이 없으면 동기화를 멈춘다.

## 구성
| 위치 | 설명 |
|---|---|
| `public/` | 화면 (`index.html` 게임, `online.js` 온라인 기능, `admin.html` 초대 코드 관리) |
| `worker/` + `wrangler.toml` | **Cloudflare Workers + D1** 서버 (무료 플랜으로 운영 가능) |
| `server/` | 같은 API 를 하는 **Node 서버** (내장 SQLite). 디스크가 붙는 서버/VPS 용 대안 |

두 서버는 API 가 같아서 화면 코드는 그대로 쓴다.

## Cloudflare 로 배포 (무료, 브라우저만으로 가능)
무료 한도(대략 하루 요청 10만 건 · DB 쓰기 10만 번)는 친구끼리 노는 정도엔 넉넉하다. 한도를 넘으면 과금되지 않고 그날은 요청이 막힌다. 가격·한도는 바뀔 수 있으니 Cloudflare 요금 페이지를 확인할 것.

1. [cloudflare.com](https://www.cloudflare.com) 에서 가입한다 (카드 불필요).
2. 대시보드 → **Storage & databases → D1 SQL database → Create** 로 데이터베이스를 `adrift` 이름으로 만들고, 화면에 나오는 **Database ID** 를 복사한다.
3. GitHub 의 이 저장소에서 `wrangler.toml` 을 열어(연필 아이콘) `database_id = "000…"` 부분을 복사한 ID 로 바꾸고 커밋한다.
4. 대시보드 → **Workers & Pages → Create → Import a repository** 로 GitHub 저장소를 연결한다. 프로젝트 이름은 `wrangler.toml` 의 `name`(`pyoryu-yeohaeng`)과 같게, 배포 명령은 기본값(`npx wrangler deploy`)으로 둔다. 이후 `main` 에 push 할 때마다 자동 배포된다.
5. 만들어진 Worker → **Settings → Variables and secrets → Add** 에서 종류를 **Secret** 으로, 이름 `ADMIN_KEY`, 값은 **12자 이상** 길게 정한 비밀번호로 저장한다. (코드나 `wrangler.toml` 에는 절대 적지 않는다.)
6. `https://<워커이름>.<내서브도메인>.workers.dev/admin` 에서 ADMIN_KEY 를 넣고 초대 코드를 만든다. 게임은 같은 주소의 `/` 이다. 테이블은 첫 요청 때 자동으로 만들어진다.

컴퓨터가 있다면: `npm install` → `npx wrangler login` → `npx wrangler d1 create adrift` → `wrangler.toml` 수정 → `npx wrangler secret put ADMIN_KEY` → `npx wrangler deploy`.

환경변수(선택): `PBKDF_ITER`(비밀번호 해시 반복 횟수, 기본 20000 — 무료 플랜의 요청당 CPU 시간이 짧아 낮게 잡았다), `ENCOUNTER_RADIUS`(마주침 거리, 기본 2.5).

### 로컬에서 돌려 보기
```
echo 'ADMIN_KEY=local-test-admin-key-123' > .dev.vars
npx wrangler dev                                  # http://localhost:8787
TEST_BASE=http://localhost:8787 TEST_ADMIN_KEY=local-test-admin-key-123 node --test server/test.mjs
```

## Node 서버로 돌리기 (대안)
SQLite 파일이 남아야 하므로 디스크가 붙는 곳(Fly.io, 유료 Render, VPS)이어야 한다. 의존성은 없고 Node 22 이상이면 된다.
```
ADMIN_KEY=12자_이상_비밀번호 node server/server.js     # http://localhost:3000
node server/cli.js invite 3 친구들                      # 초대 코드를 셸에서 만들기
node --test server/test.mjs                              # 점검 (임시 DB 로 서버를 띄워 시험)
```
`fly.toml`, `Dockerfile`, `render.yaml` 이 이 서버용이다. Fly.io 는 `fly apps create` → `fly volumes create data --region nrt --size 1` → `fly secrets set ADMIN_KEY=…` → `fly deploy --ha=false` (머신은 반드시 1대). 환경변수: `ADMIN_KEY`, `PORT`, `DATA_DIR`, `ENCOUNTER_RADIUS`, `TRUST_PROXY=0`.

## 보안 메모
- 비밀번호는 PBKDF2(Workers) / scrypt(Node)로 해시, 로그인 토큰은 해시로 저장. 로그인·가입·채팅 등에 횟수 제한.
- 관리자 키는 환경 비밀값으로만 넣고 12자 미만이면 관리자 기능이 꺼진다. 저장소에는 비밀 값이 없다.
- 게임 계산은 각자 브라우저에서 돈다. 친구끼리 노는 용도로는 충분하지만, 클라이언트를 고쳐 소지품을 속이는 걸 완전히 막지는 못한다.
