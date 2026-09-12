import { createServer } from "node:net";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { createApp } from "../server/app.js";
import { Store, type Session } from "../server/store.js";
import { TunnelManager } from "../server/tunnel.js";
const portProbe = createServer();
await new Promise<void>((resolve) => portProbe.listen(0, "127.0.0.1", resolve));
const healthPort = (portProbe.address() as import("node:net").AddressInfo).port;
await new Promise<void>((resolve) => portProbe.close(() => resolve()));
const account: Session = {
  uid: "tunnel-test-owner",
  devid: "test",
  token: "TEST_ONLY_ACCOUNT_TOKEN",
  user: {},
};
const other = { ...account, uid: "other-test-owner" };
const key = "TEST_ONLY_TUNNEL_RUNTIME_KEY";
const tunnelId = "tunnel_00000000000000000000000000000001";
const launch = (env: NodeJS.ProcessEnv) =>
  spawn(process.execPath, [resolve("tests/fixtures/tunnel-client.mjs")], {
    env,
    stdio: "ignore",
  });
async function waitReady(manager: TunnelManager) {
  for (let i = 0; i < 50; i++) {
    const s = await manager.status(account);
    if (s.state === "ready") return s;
    await delay(50);
  }
  assert.fail(
    "Tunnel did not become ready: " +
      JSON.stringify(await manager.status(account)),
  );
}
test("managed tunnel encrypts config, probes actual readiness, restarts, stops and deletes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qianji-tunnel-"));
  let store = new Store(dir),
    manager = new TunnelManager(store, { enabled: true, launch, healthPort });
  try {
    assert.equal((await manager.status(account)).state, "unconfigured");
    await assert.rejects(
      manager.command(account, { action: "save", tunnelId, apiKey: key }),
      /请先连接/,
    );
    store.connectMcp(account);
    await manager.command(account, { action: "save", tunnelId, apiKey: key });
    const ready = await waitReady(manager);
    assert.equal(ready.hasKey, true);
    assert.equal(JSON.stringify(ready).includes(key), false);
    const raw = store.db
      .prepare("SELECT value FROM integrations WHERE name='tunnel'")
      .get() as { value: string };
    assert.equal(raw.value.includes(key), false);
    assert.equal(raw.value.includes(tunnelId), false);
    await manager.close();
    store.close();
    assert.equal(
      readFileSync(join(dir, "qianji.db")).includes(Buffer.from(key)),
      false,
    );
    store = new Store(dir);
    manager = new TunnelManager(store, { enabled: true, launch, healthPort });
    await manager.startSaved();
    await waitReady(manager);
    const hidden = await manager.status(other);
    assert.equal(hidden.locked, true);
    assert.equal(hidden.tunnelId, "");
    assert.equal(hidden.hasKey, false);
    await assert.rejects(
      manager.command(other, { action: "delete" }),
      /其他账号/,
    );
    await assert.rejects(
      manager.command(
        { ...account, demo: true },
        { action: "save", tunnelId, apiKey: key },
      ),
      /演示账号/,
    );
    // Keep the encrypted key when the password input is blank; replace the ID.
    await manager.command(account, {
      action: "save",
      tunnelId: "tunnel_00000000000000000000000000000002",
    });
    await waitReady(manager);
    assert.equal(store.tunnelConfig()?.apiKey, key);
    await manager.command(account, { action: "stop" });
    assert.equal((await manager.status(account)).state, "stopped");
    assert.equal(store.tunnelConfig()?.enabled, false);
    await manager.command(account, { action: "start" });
    await waitReady(manager);
    await manager.command(account, {
      action: "save",
      tunnelId,
      apiKey: "NOT_READY_TEST_RUNTIME_KEY",
    });
    await delay(300);
    const notReady = await manager.status(account);
    assert.notEqual(notReady.state, "ready");
    assert.equal(JSON.stringify(notReady).includes("NOT_READY_TEST"), false);
    for (const badKey of [
      "NO_POLL_TEST_RUNTIME_KEY",
      "STALE_TEST_RUNTIME_KEY",
    ]) {
      await manager.command(account, {
        action: "save",
        tunnelId,
        apiKey: badKey,
      });
      await delay(150);
      assert.notEqual(
        (await manager.status(account)).state,
        "ready",
        "Local readiness alone must not imply OpenAI connectivity",
      );
    }
    // Concurrent mutations must leave the process consistent with saved configuration.
    await Promise.all([
      manager.command(account, { action: "start" }),
      manager.command(account, { action: "stop" }),
    ]);
    assert.equal((await manager.status(account)).state, "stopped");
    await manager.command(account, { action: "delete" });
    assert.equal(store.tunnelConfig(), undefined);
    assert.equal((await manager.status(account)).state, "unconfigured");
  } finally {
    await manager.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("tunnel API enforces auth, origin, ownership, schema and demo isolation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qianji-tunnel-api-"));
  const f = await createApp({
    directory: dir,
    mcpEnabled: true,
    serveStatic: false,
    tunnel: { enabled: true, launch, healthPort },
  });
  const cookie = "qianji_session=" + f.store.createSession(account);
  const headers = {
    cookie,
    origin: "http://localhost:3001",
    "content-type": "application/json",
  };
  const post = (payload: Record<string, unknown>, h = headers) =>
    f.app.inject({
      method: "POST",
      url: "/api/settings/tunnel",
      headers: h,
      payload,
    });
  try {
    assert.equal(
      (await f.app.inject({ url: "/api/settings/tunnel" })).statusCode,
      401,
    );
    assert.equal(
      (
        await post(
          { action: "stop" },
          { ...headers, origin: "https://evil.example.com" },
        )
      ).statusCode,
      403,
    );
    f.store.connectMcp(account);
    assert.equal(
      (
        await post({
          action: "save",
          tunnelId,
          apiKey: key,
          command: "anything",
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (await post({ action: "save", tunnelId: "bad-id", apiKey: key }))
        .statusCode,
      400,
    );
    assert.equal(
      (await post({ action: "save", tunnelId, apiKey: key })).statusCode,
      200,
    );
    await waitReady(f.tunnel);
    const response = await f.app.inject({
      url: "/api/settings/tunnel",
      headers: { cookie },
    });
    assert.equal(response.json().state, "ready");
    assert.equal(response.body.includes(key), false);
    const otherHeaders = {
      ...headers,
      cookie: "qianji_session=" + f.store.createSession(other),
    };
    f.store.disconnectMcp(account.uid);
    const bind = await f.app.inject({
      method: "POST",
      url: "/api/settings/mcp",
      headers: otherHeaders,
      payload: { connected: true },
    });
    assert.equal(bind.statusCode, 403);
    assert.equal(
      (await post({ action: "stop" }, otherHeaders)).statusCode,
      403,
    );
    const demoHeaders = {
      ...headers,
      cookie:
        "qianji_session=" +
        f.store.createSession({ ...account, uid: "__demo__", demo: true }),
    };
    assert.equal((await post({ action: "stop" }, demoHeaders)).statusCode, 403);
    assert.equal((await post({ action: "delete" })).statusCode, 200);
  } finally {
    await f.app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("missing binary and crashed client never report ready or expose process errors", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qianji-tunnel-error-"));
  const store = new Store(dir);
  const unavailable = new TunnelManager(store, {
    enabled: true,
    binary: "/nonexistent/qianji-tunnel",
  });
  const manager = new TunnelManager(store, {
    enabled: true,
    launch,
    healthPort,
  });
  try {
    store.connectMcp(account);
    assert.equal((await unavailable.status(account)).state, "unavailable");
    await assert.rejects(
      unavailable.command(account, { action: "save", tunnelId, apiKey: key }),
      /不支持/,
    );
    await manager.command(account, {
      action: "save",
      tunnelId,
      apiKey: "EXIT_TEST_ONLY_RUNTIME_KEY",
    });
    await delay(300);
    assert.equal((await manager.status(account)).state, "error");
    await manager.command(account, { action: "stop" });
    await delay(1100);
    assert.equal((await manager.status(account)).state, "stopped");
  } finally {
    await manager.close();
    await unavailable.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
