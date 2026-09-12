import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createApp } from "../server/app.js";
import { createMcpApp } from "../server/mcp.js";
import { demoSnapshot } from "../server/demo.js";
import { Store, type Session } from "../server/store.js";
const session: Session = {
  uid: "account-mcp",
  devid: "test-device",
  token: "PRIVATE_TOKEN_MCP_TEST",
  user: { id: "account-mcp", name: "脱敏用户" },
};
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "qianji-mcp-"));
  const calls: string[] = [];
  const web = await createApp({
    directory: dir,
    mcpEnabled: true,
    serveStatic: false,
    origins: ["http://localhost:3001"],
    client: {
      call: async (path) => {
        calls.push(path);
        throw new Error("Unexpected upstream access");
      },
    },
  });
  const snap = demoSnapshot();
  snap.bills[0]!.id = "9223372036854775807";
  snap.bills[0]!.money = "0.12345678";
  snap.bills[0]!._wire = "PRIVATE_WIRE_FIELD";
  web.store.save(session.uid, snap);
  const mcp = await createMcpApp(web.store, web.service);
  const url = await mcp.listen({ host: "127.0.0.1", port: 0 });
  const client = new McpClient({ name: "qianji-test", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url + "/mcp")),
  );
  return {
    ...web,
    mcp,
    client,
    url,
    dir,
    calls,
    async close() {
      await client.close();
      await mcp.close();
      await web.app.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
const data = (r: any) => r.structuredContent as any;
test("MCP initializes without auth and describes bounded tools; missing account is explicit", async () => {
  const f = await fixture();
  try {
    const tools = (await f.client.listTools()).tools;
    assert.equal(tools.length, 15);
    for (const t of tools) {
      assert.ok(t.description);
      assert.equal(t.inputSchema.type, "object");
      assert.deepEqual(t._meta?.securitySchemes, [{ type: "noauth" }]);
    }
    assert.equal(
      tools.find((t) => t.name === "qianji_statistics")!.annotations
        ?.readOnlyHint,
      true,
    );
    assert.equal(
      tools.find((t) => t.name === "qianji_delete_bill")!.annotations
        ?.destructiveHint,
      true,
    );
    assert.equal(
      tools.find((t) => t.name === "qianji_create_bill")!.inputSchema.properties
        ?.testing,
      undefined,
    );
    assert.equal(
      data(await f.client.callTool({ name: "qianji_status", arguments: {} }))
        .data.connected,
      false,
    );
    const r = await f.client.callTool({
      name: "qianji_list_bills",
      arguments: {},
    });
    assert.equal(r.isError, true);
    assert.equal(data(r).error.code, "MCP_NOT_CONNECTED");
    assert.equal((await f.app.inject({ url: "/api/bills" })).statusCode, 401);
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/mcp",
          payload: { jsonrpc: "2.0", id: 1, method: "tools/list" },
        })
      ).statusCode,
      404,
    );
  } finally {
    await f.close();
  }
});
test("MCP data matches REST service, preserves IDs/decimals and paginates exports", async () => {
  const f = await fixture();
  try {
    f.store.connectMcp(session);
    const r = await f.client.callTool({
      name: "qianji_get_bill",
      arguments: { id: "9223372036854775807" },
    });
    assert.equal(data(r).data.bill.id, "9223372036854775807");
    assert.equal(data(r).data.bill.money, "0.12345678");
    assert.equal(JSON.stringify(r).includes("PRIVATE_WIRE_FIELD"), false);
    assert.equal(JSON.stringify(r).includes(session.token), false);
    const query = { page: 1, pageSize: 2 };
    const listed = data(
      await f.client.callTool({ name: "qianji_list_bills", arguments: query }),
    ).data;
    const expected = await f.service.bills(session, query);
    assert.deepEqual(listed.list, expected.list);
    assert.equal(listed.total, expected.total);
    const exported = data(
      await f.client.callTool({
        name: "qianji_export_bills",
        arguments: { ...query, format: "json" },
      }),
    ).data;
    assert.equal(JSON.parse(exported.text).length, 2);
    assert.equal(exported.hasMore, true);
    const stats = data(
      await f.client.callTool({
        name: "qianji_statistics",
        arguments: { group: "month" },
      }),
    ).data;
    assert.deepEqual(
      stats.totals,
      (await f.service.stats(session, { group: "month" })).totals,
    );
    assert.equal(
      data(
        await f.client.callTool({
          name: "qianji_resources",
          arguments: { kind: "books" },
        }),
      ).data.total,
      f.store.snapshot(session.uid).books.length,
    );
    assert.equal(
      data(
        await f.client.callTool({
          name: "qianji_list_bills",
          arguments: { query: "NO-SUCH-REMARK" },
        }),
      ).data.total,
      0,
    );
    assert.equal(
      (
        await f.client.callTool({
          name: "qianji_get_bill",
          arguments: { id: 9223372036854776000 },
        })
      ).isError,
      true,
    );
    assert.equal(
      (
        await f.client.callTool({
          name: "qianji_list_bills",
          arguments: { from: "2026-02-31" },
        })
      ).isError,
      true,
    );
    assert.equal(
      (
        await f.client.callTool({
          name: "qianji_budgets",
          arguments: { period: "2026-09" },
        })
      ).isError,
      true,
    );
  } finally {
    await f.close();
  }
});
test("MCP binding is encrypted, web-managed, persistent and immediately revocable", async () => {
  const f = await fixture();
  try {
    const cookie = "qianji_session=" + f.store.createSession(session);
    const headers = { cookie, origin: "http://localhost:3001" };
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/settings/mcp",
          payload: { connected: true },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/settings/mcp",
          headers,
          payload: { connected: true },
        })
      ).statusCode,
      200,
    );
    const db = new Store(f.dir);
    assert.equal(db.mcpAccount()?.token, session.token);
    db.close();
    const row = f.store.db
      .prepare("SELECT value FROM integrations WHERE name='mcp'")
      .get() as any;
    assert.equal(row.value.includes(session.token), false);
    assert.equal(
      data(await f.client.callTool({ name: "qianji_status", arguments: {} }))
        .data.connected,
      true,
    );
    await f.app.inject({
      method: "POST",
      url: "/api/settings/mcp",
      headers,
      payload: { connected: false },
    });
    assert.equal(
      (await f.client.callTool({ name: "qianji_list_bills", arguments: {} }))
        .isError,
      true,
    );
    assert.throws(() => f.store.connectMcp({ ...session, demo: true }));
  } finally {
    await f.close();
  }
});
test("MCP cannot bypass write verification, rejects unknown keys, and does not retry upstream errors", async () => {
  const f = await fixture();
  try {
    f.store.connectMcp(session);
    const input = {
      requestId: randomUUID(),
      bookid: "-1",
      money: "1.23",
      cateid: "101",
      time: 1789200000,
      type: 0,
      remark: "协议测试",
    };
    const r = await f.client.callTool({
      name: "qianji_create_bill",
      arguments: input,
    });
    assert.equal(r.isError, true);
    assert.equal(f.calls.length, 0);
    assert.equal(
      (
        await f.client.callTool({
          name: "qianji_create_bill",
          arguments: { ...input, testing: true },
        })
      ).isError,
      true,
    );
    assert.equal(f.calls.length, 0);
    assert.equal(
      (
        await f.client.callTool({
          name: "qianji_list_bills",
          arguments: { url: "http://example.com" },
        })
      ).isError,
      true,
    );
    assert.equal(
      (await f.client.callTool({ name: "qianji_sync", arguments: {} })).isError,
      true,
    );
    assert.equal(f.calls.length, 1);
  } finally {
    await f.close();
  }
});
test("MCP transport validates host/origin, malformed JSON and stateless HTTP methods", async () => {
  const f = await fixture();
  try {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });
    assert.equal(
      (
        await f.mcp.inject({
          method: "POST",
          url: "/mcp",
          headers: { host: "evil.example" },
          payload: { jsonrpc: "2.0", id: 1, method: "tools/list" },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await fetch(f.url + "/mcp", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            origin: "https://evil.example",
          },
          body,
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(f.url + "/mcp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{bad",
        })
      ).status,
      400,
    );
    assert.equal((await fetch(f.url + "/mcp")).status, 405);
    assert.equal(
      (await fetch(f.url + "/mcp", { method: "DELETE" })).status,
      405,
    );
    assert.equal((await fetch(f.url + "/api/bills")).status, 404);
  } finally {
    await f.close();
  }
});

test("MCP edit omits unchanged fields instead of clearing remark", async () => {
  const f = await fixture();
  try {
    f.store.connectMcp(session);
    let captured: any;
    f.service.write = async (_s, input) => {
      captured = input;
      return { status: "captured-test-only" };
    };
    const r = await f.client.callTool({
      name: "qianji_edit_bill",
      arguments: {
        requestId: randomUUID(),
        bookid: "-1",
        id: "9223372036854775807",
        expected: "test-revision",
        money: "2.34",
      },
    });
    assert.equal(r.isError, undefined);
    assert.equal(captured.remark, undefined);
    assert.equal(captured.cateid, undefined);
    assert.equal(captured.money, "2.34");
    assert.equal(captured.testing, false);
  } finally {
    await f.close();
  }
});
