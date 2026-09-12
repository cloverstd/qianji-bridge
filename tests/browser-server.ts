// Test-only upstream. Production startup never imports this module.
import { createApp } from "../server/app.js";
import { AppError, md5, type Client } from "../server/client.js";
import { demoSnapshot, demoResource } from "../server/demo.js";
import { parseUpstream } from "../server/domain.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Raw } from "../shared/types.js";
const directory = mkdtempSync(join(tmpdir(), "qianji-browser-"));
const snapshot = demoSnapshot();
snapshot.user = { id: "100", name: "浏览器测试", email: "browser@example.com" };
snapshot.bills = snapshot.bills.map((b) => ({ ...b, userid: "100" }));
snapshot.books = snapshot.books.map((b) => ({
  ...b,
  members: [snapshot.user],
}));
const fake: Client = {
  async call(path, body) {
    if (path === "/account/login") {
      if (body.v !== "browser@example.com" || body.pwd !== md5("test-password"))
        throw new AppError(
          "QIANJI_8888",
          "登录失败，请核对邮箱和密码或重新登录",
          401,
        );
      return { user: snapshot.user, token: "TEST_ONLY_TOKEN" };
    }
    if (path === "/client/init")
      return {
        userinfo: snapshot.user,
        userconfigs: snapshot.config,
        books: snapshot.books,
      };
    if (path === "/syncv2/pull")
      return {
        bookid: "-1",
        pageoffset: 0,
        pagesign: "done",
        hasmore: 0,
        lasttimes: { "-1": Math.floor(Date.now() / 1000) },
        changes: snapshot.bills,
        categories: snapshot.categories,
        deletes: [],
      };
    if (path === "/bill/syncall") {
      const payload = parseUpstream(body.v),
        change = payload.bills.changelist ?? [],
        deleted = payload.bills.dellist ?? [];
      const added: string[] = [],
        updated: string[] = [];
      for (const b of change) {
        const index = snapshot.bills.findIndex((x) => x.id === b.id);
        if (index >= 0) {
          snapshot.bills[index] = b;
          updated.push(b.id);
        } else {
          snapshot.bills.push(b);
          added.push(b.id);
        }
      }
      snapshot.bills = snapshot.bills.filter((b) => !deleted.includes(b.id));
      return {
        sync_result: {
          bill: {
            new_ids: added,
            update_ids: updated,
            del_ids: deleted,
            conf_ids: [],
            has_failed: 0,
          },
        },
      };
    }
    if (path === "/budget/list")
      return {
        list: [
          {
            budgetid: "81000000000020000",
            bookid: "-1",
            flag: 1,
            money: "6000",
            used: "2000",
          },
        ],
        daystats: [],
      };
    if (path === "/tag/list") return { list: [] };
    return demoResource(
      (
        {
          "/asset/list": "assets",
          "/currency/listv2": "currencies",
          "/asset/listloan": "loans",
        } as Raw
      )[path] ?? "",
    );
  },
};
const port = Number(process.env.QIANJI_TEST_PORT ?? 3001);
const { app } = await createApp({
  mcpEnabled: true,
  directory,
  client: fake,
  origins: [`http://localhost:${port}`],
  demo: true,
});
await app.listen({ host: "127.0.0.1", port });
for (const sig of ["SIGTERM", "SIGINT"])
  process.on(sig, async () => {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
    process.exit(0);
  });
