import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { Store, emptySnapshot } from "../server/store.js";
test("online backup restores snapshot and encrypted session including key", () => {
  const directory = mkdtempSync(join(tmpdir(), "qianji-backup-test-"));
  const live = new Store(join(directory, "live"));
  let restored: Store | undefined;
  try {
    const snapshot = emptySnapshot();
    snapshot.user = { id: "100", name: "备份测试" };
    live.save("100", snapshot);
    const cookie = live.createSession({
      uid: "100",
      devid: "test-device",
      token: "test-token",
      user: snapshot.user,
    });
    live.connectMcp(live.session(cookie)!);
    const backup = join(directory, "backup");
    const run = spawnSync(
      process.execPath,
      ["--import", "tsx", "server/backup.ts", backup],
      {
        env: { ...process.env, DATA_DIR: join(directory, "live") },
        encoding: "utf8",
      },
    );
    assert.equal(run.status, 0, run.stderr);
    restored = new Store(backup);
    assert.deepEqual(restored.snapshot("100"), snapshot);
    assert.equal(restored.session(cookie)?.token, "test-token");
    assert.equal(restored.mcpAccount()?.token, "test-token");
  } finally {
    restored?.close();
    live.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
