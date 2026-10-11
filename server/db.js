// SQLite(내장 node:sqlite) 한 파일에 모든 걸 저장한다. 외부 의존성 없음.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

export const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), "data");
mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(join(DATA_DIR, "adrift.db"));
db.exec(`
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
PRAGMA busy_timeout=3000;

CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  salt TEXT NOT NULL,
  hash TEXT NOT NULL,
  invite TEXT,
  created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS invites(
  code TEXT PRIMARY KEY,
  note TEXT NOT NULL DEFAULT '',
  created INTEGER NOT NULL,
  expires INTEGER NOT NULL,
  used_by INTEGER,
  used_at INTEGER
);
CREATE TABLE IF NOT EXISTS sessions(
  token TEXT PRIMARY KEY,          -- sha256(token)
  user_id INTEGER NOT NULL,
  created INTEGER NOT NULL,
  seen INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS presence(
  user_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  ship TEXT NOT NULL,
  lv INTEGER NOT NULL DEFAULT 0,
  x REAL NOT NULL, y REAL NOT NULL, hd REAL NOT NULL DEFAULT 0,
  loc TEXT NOT NULL,               -- sea | port | city
  isl INTEGER NOT NULL DEFAULT -1,
  snap TEXT NOT NULL DEFAULT '{}',
  updated INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chat(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  text TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS chat_ch ON chat(channel, id);

-- 받는 사람이 다음 동기화 때 한 번만 가져가는 우편함 (인사, 거래 결과, 병 답장, 선원 작업 결과 ...)
CREATE TABLE IF NOT EXISTS deliveries(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  created INTEGER NOT NULL,
  claimed INTEGER
);
CREATE INDEX IF NOT EXISTS deliveries_user ON deliveries(user_id, claimed);

CREATE TABLE IF NOT EXISTS trades(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id INTEGER NOT NULL,
  to_id INTEGER NOT NULL,
  give TEXT NOT NULL,              -- 제안자가 내놓은 것 (제안 시점에 클라이언트가 차감 = 보관)
  want TEXT NOT NULL,              -- 제안자가 원하는 것
  status TEXT NOT NULL,            -- open | done | declined | cancelled | expired
  created INTEGER NOT NULL,
  expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS trades_to ON trades(to_id, status);
CREATE INDEX IF NOT EXISTS trades_from ON trades(from_id, status);

CREATE TABLE IF NOT EXISTS bottles(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  text TEXT NOT NULL,
  reply_to INTEGER,                -- 답장이면 원래 병 id
  created INTEGER NOT NULL,
  finder_id INTEGER,
  found_at INTEGER
);
CREATE INDEX IF NOT EXISTS bottles_free ON bottles(finder_id, created);

CREATE TABLE IF NOT EXISTS crew(
  member_id INTEGER PRIMARY KEY,   -- 한 사람은 한 배에만 탄다
  captain_id INTEGER NOT NULL,
  joined INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS crew_captain ON crew(captain_id);
CREATE TABLE IF NOT EXISTS crew_invites(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  captain_id INTEGER NOT NULL,
  member_id INTEGER NOT NULL,
  created INTEGER NOT NULL,
  status TEXT NOT NULL             -- open | accepted | declined | cancelled
);
CREATE TABLE IF NOT EXISTS crew_profile(
  user_id INTEGER PRIMARY KEY,
  purse INTEGER NOT NULL DEFAULT 0,
  xp INTEGER NOT NULL DEFAULT 0,
  tasks INTEGER NOT NULL DEFAULT 0,
  day TEXT NOT NULL DEFAULT '',
  day_earn INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS crew_cd(
  member_id INTEGER NOT NULL,
  duty TEXT NOT NULL,
  ready INTEGER NOT NULL,
  PRIMARY KEY(member_id, duty)
);

CREATE TABLE IF NOT EXISTS saves(
  user_id INTEGER PRIMARY KEY,
  data TEXT NOT NULL,
  updated INTEGER NOT NULL
);
`);

// 짧은 트랜잭션 헬퍼 (node:sqlite 에는 내장 transaction 이 없다)
export function tx(fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch {}
    throw e;
  }
}
export const q = (sql) => db.prepare(sql);
