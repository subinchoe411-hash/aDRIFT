// 사용법: node server/cli.js invite [개수] [메모]   — 초대 코드 만들기
//         node server/cli.js users                  — 가입자 목록
import { createInvites } from "./api.js";
import { db } from "./db.js";

const [cmd, a, ...rest] = process.argv.slice(2);
if (cmd === "invite") {
  const n = Math.max(1, Math.min(20, parseInt(a || "1", 10) || 1));
  for (const c of createInvites(n, rest.join(" "))) console.log(c);
} else if (cmd === "users") {
  for (const u of db.prepare("SELECT id,username,created FROM users ORDER BY id").all())
    console.log(u.id, u.username, new Date(u.created).toISOString());
} else {
  console.log("사용법: node server/cli.js invite [개수] [메모] | users");
}
