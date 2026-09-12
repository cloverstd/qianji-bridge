import { DatabaseSync } from "node:sqlite";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  chmodSync,
} from "node:fs";
import { join } from "node:path";
import type { Raw, Snapshot } from "../shared/types.js";
import type { TunnelConfig } from "../shared/tunnel.js";
export interface Session {
  uid: string;
  devid: string;
  token: string;
  user: Raw;
  demo?: boolean;
}
export const emptySnapshot = (): Snapshot => ({
  bills: [],
  categories: [],
  books: [],
  user: {},
  config: {},
  cursors: {},
  lastSync: null,
});
export class Store {
  db: DatabaseSync;
  key: Buffer;
  constructor(directory: string, secret?: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const keyfile = join(directory, ".key");
    if (secret && !/^[a-f\d]{64}$/i.test(secret))
      throw new Error("SESSION_KEY 必须为 64 位十六进制字符串");
    if (!secret && !existsSync(keyfile))
      writeFileSync(keyfile, randomBytes(32), { mode: 0o600, flag: "wx" });
    this.key = secret ? Buffer.from(secret, "hex") : readFileSync(keyfile);
    this.db = new DatabaseSync(join(directory, "qianji.db"));
    chmodSync(join(directory, "qianji.db"), 0o600);
    this.db.exec(
      "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS devices (email_hash TEXT PRIMARY KEY, devid TEXT NOT NULL); CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, value TEXT NOT NULL, expires INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS snapshots (uid TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS settings (uid TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS operations (uid TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(uid,id));",
    );
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS integrations (name TEXT PRIMARY KEY, value TEXT NOT NULL)",
    );
  }
  encrypt(value: unknown): string {
    const iv = randomBytes(12),
      c = createCipheriv("aes-256-gcm", this.key, iv);
    const data = Buffer.concat([c.update(JSON.stringify(value)), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), data]).toString("base64");
  }
  decrypt(value: string) {
    const b = Buffer.from(value, "base64"),
      d = createDecipheriv("aes-256-gcm", this.key, b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([d.update(b.subarray(28)), d.final()]).toString(),
    );
  }
  hash(id: string) {
    return createHash("sha256").update(id).digest("hex");
  }
  device(email: string) {
    const key = this.hash(email.trim().toLowerCase());
    const existing = this.db
      .prepare("SELECT devid FROM devices WHERE email_hash=?")
      .get(key) as { devid: string } | undefined;
    if (existing) return existing.devid;
    const devid = "mac-" + randomBytes(8).toString("hex");
    this.db.prepare("INSERT INTO devices VALUES (?,?)").run(key, devid);
    return devid;
  }
  createSession(value: Session) {
    const id = randomBytes(32).toString("hex");
    this.db.prepare("DELETE FROM sessions WHERE expires < ?").run(Date.now());
    this.db
      .prepare("INSERT INTO sessions VALUES (?,?,?)")
      .run(
        this.hash(id),
        this.encrypt(value) as string,
        Date.now() + 7 * 86400_000,
      );
    return id;
  }
  session(id: string | undefined): Session | undefined {
    if (!id) return;
    const row = this.db
      .prepare("SELECT value FROM sessions WHERE id=? AND expires>?")
      .get(this.hash(id), Date.now()) as { value: string } | undefined;
    return row ? this.decrypt(row.value) : undefined;
  }
  logout(id: string) {
    this.db.prepare("DELETE FROM sessions WHERE id=?").run(this.hash(id));
  }
  mcpAccount(): Session | undefined {
    const row = this.db
      .prepare("SELECT value FROM integrations WHERE name='mcp'")
      .get() as { value: string } | undefined;
    return row ? this.decrypt(row.value) : undefined;
  }
  connectMcp(account: Session) {
    if (account.demo || account.uid.startsWith("__"))
      throw new Error("演示账号不能连接 MCP");
    this.db
      .prepare("INSERT OR REPLACE INTO integrations VALUES ('mcp',?)")
      .run(this.encrypt(account));
  }
  disconnectMcp(uid: string) {
    if (this.mcpAccount()?.uid === uid)
      this.db.prepare("DELETE FROM integrations WHERE name='mcp'").run();
  }
  tunnelConfig(): TunnelConfig | undefined {
    const row = this.db
      .prepare("SELECT value FROM integrations WHERE name='tunnel'")
      .get() as { value: string } | undefined;
    return row ? this.decrypt(row.value) : undefined;
  }
  saveTunnelConfig(config: TunnelConfig | undefined) {
    if (config)
      this.db
        .prepare("INSERT OR REPLACE INTO integrations VALUES ('tunnel',?)")
        .run(this.encrypt(config));
    else this.db.prepare("DELETE FROM integrations WHERE name='tunnel'").run();
  }
  snapshot(uid: string): Snapshot {
    const row = this.db
      .prepare("SELECT value FROM snapshots WHERE uid=?")
      .get(uid) as { value: string } | undefined;
    return row ? JSON.parse(row.value) : emptySnapshot();
  }
  save(uid: string, value: Snapshot) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare("INSERT OR REPLACE INTO snapshots VALUES (?,?)")
        .run(uid, JSON.stringify(value));
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  settings(uid: string): Raw {
    const row = this.db
      .prepare("SELECT value FROM settings WHERE uid=?")
      .get(uid) as { value: string } | undefined;
    return row ? JSON.parse(row.value) : { testBookid: "", verified: {} };
  }
  saveSettings(uid: string, value: Raw) {
    this.db
      .prepare("INSERT OR REPLACE INTO settings VALUES (?,?)")
      .run(uid, JSON.stringify(value));
  }
  operation(uid: string, id: string): Raw | undefined {
    const row = this.db
      .prepare("SELECT value FROM operations WHERE uid=? AND id=?")
      .get(uid, id) as { value: string } | undefined;
    return row ? JSON.parse(row.value) : undefined;
  }
  saveOperation(uid: string, id: string, value: Raw) {
    this.db
      .prepare("INSERT OR REPLACE INTO operations VALUES (?,?,?)")
      .run(uid, id, JSON.stringify(value));
  }
  operations(uid: string): Raw[] {
    return (
      this.db
        .prepare("SELECT id, value FROM operations WHERE uid=?")
        .all(uid) as { id: string; value: string }[]
    ).map((r) => ({ requestId: r.id, ...JSON.parse(r.value).public }));
  }
  close() {
    this.db.close();
  }
}
