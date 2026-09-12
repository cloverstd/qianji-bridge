import type { Client } from "./client.js";
import { AppError, requireList } from "./client.js";
import type { Store, Session } from "./store.js";
import { normalizeBill, normalizeCategory } from "./domain.js";
import type { Snapshot } from "../shared/types.js";
export class AccountLocks {
  private active = new Set<string>();
  async run<T>(uid: string, fn: () => Promise<T>): Promise<T> {
    if (this.active.has(uid))
      throw new AppError("BUSY", "账号正在同步或提交，请稍候再试", 409);
    this.active.add(uid);
    try {
      return await fn();
    } finally {
      this.active.delete(uid);
    }
  }
}
export async function syncAccount(
  store: Store,
  client: Client,
  session: Session,
  full = false,
): Promise<Snapshot> {
  const previous = store.snapshot(session.uid);
  const init = await client.call("/client/init", {}, session);
  if (
    !init ||
    !Array.isArray(init.books) ||
    !init.userinfo ||
    String(init.userinfo.id) !== session.uid
  )
    throw new AppError(
      "INIT_STRUCTURE",
      "初始化返回的账号或账本信息不完整",
      502,
    );
  const next: Snapshot = {
    ...previous,
    user: init.userinfo,
    config: init.userconfigs ?? {},
    books: requireList({ list: init.books }).map((b) => {
      if (b.bookid == null || typeof b.name !== "string")
        throw new AppError("BOOK_STRUCTURE", "账本结构不完整", 502);
      return { ...b, name: String(b.name), bookid: String(b.bookid) };
    }),
  };
  const bills = new Map((full ? [] : previous.bills).map((b) => [b.id, b]));
  const categories = new Map(
    (full ? [] : previous.categories).map((c) => [c.bookid + ":" + c.id, c]),
  );
  const initial = full || !previous.lastSync ? 0 : previous.cursors;
  let bookid = "-1",
    pageoffset = 0,
    pagesign = "";
  const seen = new Set<string>();
  let complete = false;
  for (let page = 0; page < 1000; page++) {
    const key = JSON.stringify([bookid, pageoffset, pagesign]);
    if (seen.has(key))
      throw new AppError(
        "SYNC_STALLED",
        "同步游标没有前进，已保留上次完整数据",
        502,
      );
    seen.add(key);
    const data = await client.call(
      "/syncv2/pull",
      { bookid, pageoffset, pagesign, lasttimes: JSON.stringify(initial) },
      session,
    );
    if (
      !data ||
      ![0, 1].includes(Number(data.hasmore)) ||
      !Number.isInteger(Number(data.pageoffset)) ||
      Number(data.pageoffset) < 0 ||
      typeof data.pagesign !== "string" ||
      data.bookid == null ||
      !Array.isArray(data.deletes)
    )
      throw new AppError(
        "SYNC_STRUCTURE",
        "同步响应结构异常，未保存本次结果",
        502,
      );
    for (const raw of requireList(data, "changes")) {
      const b = normalizeBill(raw);
      bills.set(b.id, b);
    }
    for (const id of data.deletes) {
      if (!/^-?\d+$/.test(String(id)))
        throw new AppError("SYNC_DELETE", "删除记录 ID 无效", 502);
      bills.delete(String(id));
    }
    if (data.categories !== undefined)
      for (const raw of requireList(data, "categories")) {
        const c = normalizeCategory(raw);
        categories.set(c.bookid + ":" + c.id, c);
      }
    if (Number(data.hasmore) === 0) {
      if (
        !data.lasttimes ||
        typeof data.lasttimes !== "object" ||
        Array.isArray(data.lasttimes)
      )
        throw new AppError("SYNC_CURSOR", "同步缺少最终增量游标", 502);
      next.cursors = Object.fromEntries(
        Object.entries(data.lasttimes).map(([id, time]) => {
          if (!Number.isSafeInteger(Number(time)) || Number(time) < 0)
            throw new AppError("SYNC_CURSOR", "增量游标无效", 502);
          return [id, Number(time)];
        }),
      );
      complete = true;
      break;
    }
    bookid = String(data.bookid);
    pageoffset = Number(data.pageoffset);
    pagesign = data.pagesign;
  }
  if (!complete)
    throw new AppError(
      "SYNC_LIMIT",
      "同步超过页数上限，已保留上次完整数据",
      502,
    );
  next.bills = [...bills.values()];
  next.categories = [...categories.values()];
  next.lastSync = new Date().toISOString();
  store.save(session.uid, next);
  return next;
}
