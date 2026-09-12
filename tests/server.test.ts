import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createApp } from "../server/app.js";
import {
  QianjiClient,
  signature,
  md5,
  type Client,
  AppError,
} from "../server/client.js";
import { Store, type Session } from "../server/store.js";
import { syncAccount } from "../server/sync.js";
import { parseUpstream } from "../server/domain.js";
import { performWrite, revision } from "../server/writes.js";
import type { Raw } from "../shared/types.js";
const session: Session = {
  uid: "100",
  devid: "device",
  token: "SECRET_TOKEN_FOR_TEST",
  user: { id: "100", name: "测试用户" },
};
const sample = () => ({
  id: "8100000000000012000",
  userid: "100",
  bookid: "-1",
  cateid: "10",
  type: "0",
  time: "1788192000",
  money: "10",
  status: "1",
  assetid: "-1",
  remark: "午餐",
});
const init = {
  userinfo: { id: "100", name: "测试用户" },
  userconfigs: { mcurrency: "CNY" },
  books: [
    { bookid: "-1", name: "日常账本" },
    { bookid: "123", name: "测试账本" },
  ],
};
const complete = (changes: Raw[] = []) => ({
  hasmore: "0",
  bookid: "-1",
  pageoffset: "0",
  pagesign: "done",
  lasttimes: { "-1": "1789205861", "123": "1789205861" },
  changes,
  deletes: [],
  categories: [
    {
      id: "10",
      name: "餐饮",
      bookid: "-1",
      parentid: "-1",
      type: "0",
      level: "1",
    },
  ],
});
function tempStore() {
  const dir = mkdtempSync(join(tmpdir(), "qianji-test-"));
  return {
    dir,
    store: new Store(dir),
    clean() {
      this.store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
test("signature and htoken profiles match documented and source contracts", async () => {
  const signed = signature("/syncv2/pull", 1789200000000);
  assert.equal(
    signed.reqidv2,
    md5(
      "com.mutangtech.qianji" +
        String(1789200000000 + 1207 + 9081127) +
        "syncv2pullfree20170908&x_*1127",
    ),
  );
  assert.throws(() => signature("/a/b/c", 1));
  const requests: { url: string; init: RequestInit }[] = [];
  const client = new QianjiClient(
    async (url, init) => {
      requests.push({ url: String(url), init: init! });
      return new Response('{"ec":200,"data":{"id":8100000000000012000}}');
    },
    () => 1000,
  );
  await client.call(
    "/syncv2/pull",
    { bookid: "-1", lasttimes: JSON.stringify({ "-1": 123 }) },
    session,
  );
  await client.call("/syncv2/pull", {}, session);
  await client.call("/bill/refund2", { v: '{"money":1}' }, session);
  await client.call("/baoxiao/baoxiao", {}, session);
  assert.notEqual(
    (requests[0]!.init.headers as Raw).reqidv2,
    (requests[1]!.init.headers as Raw).reqidv2,
  );
  assert.equal((requests[0]!.init.headers as Raw).htoken, "1");
  assert.equal((requests[2]!.init.headers as Raw).htoken, undefined);
  assert.equal((requests[3]!.init.headers as Raw).htoken, undefined);
  assert.equal(
    new URLSearchParams(String(requests[0]!.init.body)).get("lasttimes"),
    '{"-1":123}',
  );
  assert.equal(
    new URLSearchParams(String(requests[0]!.init.body)).get("uid"),
    "100",
  );
});
test("business errors never leak upstream messages or credentials", async () => {
  const c = new QianjiClient(
    async () =>
      new Response('{"ec":8888,"em":"SECRET_TOKEN_FOR_TEST","data":{}}'),
  );
  await assert.rejects(
    c.call("/account/login", {}),
    (e) =>
      e instanceof AppError &&
      e.statusCode === 401 &&
      !e.message.includes("SECRET"),
  );
});
test("sync follows cross-book pagination, commits deletes and cursor atomically", async () => {
  const t = tempStore();
  try {
    let calls = 0;
    const bodies: Raw[] = [];
    const client: Client = {
      async call(path, body) {
        if (path === "/client/init") return init;
        bodies.push(body);
        calls++;
        if (calls === 1)
          return {
            ...complete([sample()]),
            hasmore: "1",
            bookid: "123",
            pageoffset: "2",
            pagesign: "second",
          };
        return {
          ...complete([
            { ...sample(), id: "8100000000000013000", bookid: "123" },
          ]),
          deletes: [sample().id],
        };
      },
    };
    const s = await syncAccount(t.store, client, session);
    assert.equal(s.bills.length, 1);
    assert.equal(s.bills[0]?.bookid, "123");
    assert.equal(bodies[1]?.bookid, "123");
    assert.equal(bodies[1]?.pageoffset, 2);
    assert.equal(bodies[1]?.lasttimes, "0");
    assert.equal(s.cursors["123"], 1789205861);
    let later: Raw = {};
    await syncAccount(
      t.store,
      {
        async call(path, body) {
          if (path === "/client/init") return init;
          later = body;
          return complete();
        },
      },
      session,
    );
    assert.equal(later.lasttimes, JSON.stringify(s.cursors));
    assert.equal(t.store.snapshot("100").bills.length, 1);
  } finally {
    t.clean();
  }
});
test("failed/stalled pages preserve last complete snapshot and do not advance cursors", async () => {
  const t = tempStore();
  try {
    await syncAccount(
      t.store,
      {
        async call(p) {
          return p === "/client/init" ? init : complete([sample()]);
        },
      },
      session,
    );
    const saved = t.store.snapshot("100");
    let call = 0;
    await assert.rejects(
      syncAccount(
        t.store,
        {
          async call(p) {
            if (p === "/client/init") return init;
            if (call++) throw new Error("network");
            return {
              ...complete([{ ...sample(), money: "99" }]),
              hasmore: 1,
              pagesign: "next",
              pageoffset: 1,
            };
          },
        },
        session,
      ),
    );
    assert.deepEqual(t.store.snapshot("100"), saved);
    await assert.rejects(
      syncAccount(
        t.store,
        {
          async call(p) {
            return p === "/client/init"
              ? init
              : { ...complete(), hasmore: 1, pagesign: "", pageoffset: 0 };
          },
        },
        session,
      ),
    );
    assert.deepEqual(t.store.snapshot("100"), saved);
  } finally {
    t.clean();
  }
});
test("auth cookies, encrypted token persistence, origin checks, exports and isolated demo", async () => {
  const directory = mkdtempSync(join(tmpdir(), "qianji-api-"));
  const calls: Raw[] = [];
  const { app, store } = await createApp({
    directory,
    origins: ["http://localhost:3001"],
    client: {
      async call(path, body) {
        calls.push({ path, body });
        if (path === "/account/login")
          return { user: session.user, token: session.token };
        if (path === "/client/init") return init;
        if (path === "/syncv2/pull") return complete([sample()]);
        return { list: [] };
      },
    },
    serveStatic: false,
  });
  const headers = {
    origin: "http://localhost:3001",
    "content-type": "application/json",
  };
  try {
    assert.equal((await app.inject({ url: "/api/bills" })).statusCode, 401);
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/auth/login",
          payload: { email: "a@example.com", password: "p" },
        })
      ).statusCode,
      403,
    );
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers,
      payload: { email: "a@example.com", password: "plain-password" },
    });
    assert.equal(login.statusCode, 200);
    const cookie = login.cookies[0]!;
    assert.equal(cookie.httpOnly, true);
    assert.equal(cookie.sameSite, "Strict");
    assert.equal(calls[0]!.body.pwd, md5("plain-password"));
    const authed = { ...headers, cookie: `qianji_session=${cookie.value}` };
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/sync",
          headers: authed,
          payload: {},
        })
      ).statusCode,
      200,
    );
    const data = (
      await app.inject({ url: "/api/bills", headers: authed })
    ).json();
    assert.equal(data.list[0].id, sample().id);
    assert.equal(data.list[0]._wire, undefined);
    assert.equal(
      (await app.inject({ url: "/api/bills?min=abc", headers: authed }))
        .statusCode,
      400,
    );
    assert.equal(
      (
        await app.inject({
          url: "/api/bills?from=2026-09-30&to=2026-09-01",
          headers: authed,
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/settings/test-book",
          headers: { ...authed, origin: "https://evil.example" },
          payload: { bookid: "123" },
        })
      ).statusCode,
      403,
    );
    const raw = store.db.prepare("SELECT value FROM sessions").get() as {
      value: string;
    };
    assert.ok(!raw.value.includes(session.token));
    assert.ok(!raw.value.includes("plain-password"));
    const demo = await app.inject({
      method: "POST",
      url: "/api/auth/demo",
      headers,
      payload: {},
    });
    const demoCookie = demo.cookies[0]!.value;
    assert.notEqual(demoCookie, cookie.value);
    const demoBills = (
      await app.inject({
        url: "/api/bills",
        headers: { cookie: `qianji_session=${demoCookie}` },
      })
    ).json();
    assert.equal(demoBills.list[0].userid, "__demo__");
    assert.equal(store.snapshot("100").bills.length, 1);
    const exported = await app.inject({
      url: "/api/bills/export?format=json",
      headers: authed,
    });
    assert.equal(exported.json()[0].id, sample().id);
    await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: authed,
      payload: {},
    });
    assert.equal(
      (await app.inject({ url: "/api/bills", headers: authed })).statusCode,
      401,
    );
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
test("writes require verification; test create confirms remotely and does not duplicate request", async () => {
  const t = tempStore();
  let remote: Raw[] = [];
  let writes = 0;
  const client: Client = {
    async call(path, body) {
      if (path === "/client/init") return init;
      if (path === "/syncv2/pull") return complete(remote);
      if (path === "/bill/syncall") {
        writes++;
        const payload = parseUpstream(body.v);
        remote = payload.bills.changelist;
        return {
          sync_result: {
            bill: {
              new_ids: remote.map((b) => b.id),
              has_failed: 0,
              conf_ids: [],
            },
          },
        };
      }
      throw new Error("unexpected");
    },
  };
  const input = {
    requestId: randomUUID(),
    action: "create" as const,
    bookid: "123",
    money: "0.10",
    cateid: "10",
    time: 1788192000,
    type: 0,
    remark: "测试",
  };
  try {
    await syncAccount(t.store, client, session);
    await assert.rejects(
      performWrite(t.store, client, session, input),
      /尚未通过/,
    );
    t.store.saveSettings("100", { testBookid: "123", verified: {} });
    const result = await performWrite(t.store, client, session, {
      ...input,
      testing: true,
    });
    assert.equal(result.status, "confirmed");
    assert.equal(writes, 1);
    assert.ok(t.store.settings("100").verified.create);
    await performWrite(t.store, client, session, { ...input, testing: true });
    assert.equal(writes, 1);
    const b = t.store.snapshot("100").bills[0]!;
    assert.equal(b.money, "0.1");
    assert.equal(b.id.length, 19);
    t.store.saveSettings("100", {
      testBookid: "123",
      verified: { edit: true },
    });
    await assert.rejects(
      performWrite(t.store, client, session, {
        ...input,
        requestId: randomUUID(),
        action: "edit",
        id: b.id,
        expected: "stale",
      }),
      /其他设备/,
    );
  } finally {
    t.clean();
  }
});
test("write timeout remains uncertain and retry never repeats remote mutation", async () => {
  const t = tempStore();
  let writes = 0;
  const client: Client = {
    async call(p) {
      if (p === "/client/init") return init;
      if (p === "/syncv2/pull") return complete();
      writes++;
      throw new AppError("UPSTREAM_UNCERTAIN", "超时", 502);
    },
  };
  try {
    t.store.saveSettings("100", { testBookid: "123", verified: {} });
    const input = {
      requestId: randomUUID(),
      action: "create" as const,
      testing: true,
      bookid: "123",
      cateid: "10",
      money: "1",
      type: 0,
      time: 1788192000,
    };
    const r = await performWrite(t.store, client, session, input);
    assert.equal(r.status, "uncertain");
    await performWrite(t.store, client, session, input);
    assert.equal(writes, 1);
    assert.equal(t.store.settings("100").verified.create, undefined);
  } finally {
    t.clean();
  }
});

test("test-book lifecycle verifies edit, refund, reimbursement cancellation and delete with readback", async () => {
  const t = tempStore();
  let remote: Raw[] = [
    { ...sample(), bookid: "123" },
    { ...sample(), id: "8100000000000011000", bookid: "123", type: "5" },
  ];
  const client: Client = {
    async call(path, body) {
      if (path === "/client/init") return init;
      if (path === "/syncv2/pull") return complete(remote);
      const v = body.v ? parseUpstream(body.v) : {};
      if (path === "/bill/syncall") {
        if (v.bills.changelist) {
          for (const item of v.bills.changelist)
            remote = remote.map((b) => (b.id === item.id ? item : b));
          return {
            sync_result: {
              bill: {
                update_ids: v.bills.changelist.map((b: Raw) => b.id),
                has_failed: 0,
                conf_ids: [],
              },
            },
          };
        }
        remote = remote.filter((b) => !v.bills.dellist.includes(b.id));
        return {
          sync_result: {
            bill: { del_ids: v.bills.dellist, has_failed: 0, conf_ids: [] },
          },
        };
      }
      if (path === "/bill/refund2") {
        const source = remote.find((b) => b.id === body.did)!;
        const id = "8100000000000015000";
        source.extra = { rfds: { [id]: v.money } };
        remote.push({
          ...sample(),
          id,
          bookid: "123",
          type: "20",
          money: v.money,
          time: v.time,
          remark: v.remark ?? "",
          extra: { refundsid: source.id },
        });
        return { list: remote };
      }
      if (path === "/baoxiao/baoxiao") {
        const id = Object.keys(v)[0]!,
          source = remote.find((b) => b.id === id)!;
        source.extra = {
          bxs: { "8100000000000016000": v[id].money },
          baoxiaoed: 1,
        };
        remote.push({
          ...sample(),
          id: "8100000000000016000",
          bookid: "123",
          type: "1",
          money: v[id].money,
        });
        return { bills: remote };
      }
      if (path === "/baoxiao/cancelbaoxiao") {
        for (const id of v) {
          remote.find((b) => b.id === id)!.extra = { bxs: {}, baoxiaoed: 0 };
        }
        return {};
      }
      throw new Error(path);
    },
  };
  try {
    t.store.saveSettings("100", { testBookid: "123", verified: {} });
    await syncAccount(t.store, client, session);
    const run = async (
      action: "edit" | "refund" | "reimburse" | "cancelReimburse" | "delete",
      id: string,
      more: Raw = {},
    ) => {
      const bill = t.store.snapshot("100").bills.find((b) => b.id === id)!;
      return performWrite(t.store, client, session, {
        requestId: randomUUID(),
        action,
        testing: true,
        bookid: "123",
        id,
        expected: revision(bill),
        ...more,
      });
    };
    assert.equal(
      (
        await run("edit", sample().id, {
          money: "12.00",
          cateid: "10",
          time: 1788192000,
          type: 0,
          remark: "更新",
        })
      ).status,
      "confirmed",
    );
    assert.equal(
      (
        await run("refund", sample().id, {
          money: "2.00",
          time: 1788192001,
          remark: "部分退款",
        })
      ).status,
      "confirmed",
    );
    assert.equal(
      (
        await run("reimburse", "8100000000000011000", {
          money: "10.00",
          time: 1788192002,
        })
      ).status,
      "confirmed",
    );
    assert.equal(
      (await run("cancelReimburse", "8100000000000011000")).status,
      "confirmed",
    );
    assert.equal(
      (await run("delete", "8100000000000011000")).status,
      "confirmed",
    );
    const verified = t.store.settings("100").verified;
    for (const a of [
      "edit",
      "refund",
      "reimburse",
      "cancelReimburse",
      "delete",
    ])
      assert.ok(verified[a]);
  } finally {
    t.clean();
  }
});
test("device ID remains stable and account sessions survive encrypted store restart", () => {
  const directory = mkdtempSync(join(tmpdir(), "qianji-persist-"));
  let store = new Store(directory);
  try {
    const devid = store.device("test@example.com"),
      id = store.createSession({ ...session, devid });
    store.close();
    store = new Store(directory);
    assert.equal(store.device("test@example.com"), devid);
    assert.equal(store.session(id)?.token, session.token);
    assert.notEqual(store.device("other@example.com"), devid);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
test("budget form uses exclusive encoded period and unknown resource shapes are errors", async () => {
  const directory = mkdtempSync(join(tmpdir(), "qianji-resource-"));
  const calls: Raw[] = [];
  const { app, store } = await createApp({
    directory,
    serveStatic: false,
    client: {
      async call(path, body) {
        calls.push({ path, body });
        if (path === "/budget/list")
          return {
            list: [
              { budgetid: "81000000000020000", money: "100", used: "120" },
            ],
            daystats: [],
          };
        return { list: [{ unknown: "shape" }] };
      },
    },
  });
  try {
    const id = store.createSession(session),
      headers = { cookie: "qianji_session=" + id };
    const r = await app.inject({
      url: "/api/budgets?bookid=123&kind=month&period=2026-09",
      headers,
    });
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().list[0].remaining, "-20");
    assert.equal(calls[0]!.body.flts, '{"month":"2026,9"}');
    assert.equal(calls[0]!.body.bookid, "123");
    assert.equal(
      (await app.inject({ url: "/api/resources/assets", headers })).statusCode,
      502,
    );
    assert.equal(
      (await app.inject({ url: "/api/resources/tags", headers })).statusCode,
      502,
    );
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("manual resolution requires explicit acknowledgement, is account scoped and never resends", async () => {
  const directory = mkdtempSync(join(tmpdir(), "qianji-resolve-"));
  let calls = 0;
  const { app, store } = await createApp({
    directory,
    serveStatic: false,
    origins: ["http://localhost:3001"],
    client: {
      async call() {
        calls++;
        return {};
      },
    },
  });
  try {
    const id = store.createSession(session),
      other = store.createSession({ ...session, uid: "200" }),
      requestId = randomUUID();
    store.saveOperation("100", requestId, {
      expected: { action: "create" },
      public: { status: "uncertain", message: "待核查" },
    });
    const headers = {
      origin: "http://localhost:3001",
      cookie: "qianji_session=" + id,
    };
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/writes/" + requestId + "/resolve",
          headers,
          payload: { confirmedNotApplied: false },
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/writes/" + requestId + "/resolve",
          headers: { ...headers, cookie: "qianji_session=" + other },
          payload: { confirmedNotApplied: true },
        })
      ).statusCode,
      409,
    );
    const result = await app.inject({
      method: "POST",
      url: "/api/writes/" + requestId + "/resolve",
      headers,
      payload: { confirmedNotApplied: true },
    });
    assert.equal(result.json().status, "dismissed");
    assert.equal(calls, 0);
    assert.equal(store.settings("100").verified.create, undefined);
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
