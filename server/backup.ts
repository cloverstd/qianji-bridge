import { DatabaseSync } from "node:sqlite";
import { mkdirSync, copyFileSync, existsSync, chmodSync } from "node:fs";
import { resolve, join } from "node:path";
const data = resolve(process.env.DATA_DIR ?? "data");
const destination = resolve(
  process.argv[2] ??
    join(data, "backups", new Date().toISOString().replaceAll(":", "-")),
);
if (existsSync(destination)) throw new Error("备份目录已存在，请选择新目录");
mkdirSync(destination, { recursive: true, mode: 0o700 });
const db = new DatabaseSync(join(data, "qianji.db"), { readOnly: true });
try {
  db.prepare("VACUUM INTO ?").run(join(destination, "qianji.db"));
  chmodSync(join(destination, "qianji.db"), 0o600);
} finally {
  db.close();
}
if (existsSync(join(data, ".key")))
  copyFileSync(join(data, ".key"), join(destination, ".key"));
if (existsSync(join(destination, ".key")))
  chmodSync(join(destination, ".key"), 0o600);
console.log("备份完成：" + destination);
