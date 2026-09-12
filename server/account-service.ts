import { z } from "zod";
import { Decimal } from "decimal.js";
import { Store, type Session } from "./store.js";
import { AppError, requireList, type Client } from "./client.js";
import { AccountLocks, syncAccount } from "./sync.js";
import { filterBills, statistics, publicBill } from "./domain.js";
import {
  capabilities,
  performWrite,
  reconcileWrite,
  revision,
} from "./writes.js";
import { demoResource } from "./demo.js";
import type { Filters, Raw, WriteAction } from "../shared/types.js";
const decimal = z
  .string()
  .regex(/^\d+(\.\d{1,8})?$/)
  .max(30);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (s) => !isNaN(Date.parse(s)) && new Date(s).toISOString().startsWith(s),
  );
export const filterSchema = z
  .object({
    bookid: z.string().max(80).optional(),
    from: date.optional(),
    to: date.optional(),
    type: z.string().regex(/^\d+$/).optional(),
    category: z.string().max(80).optional(),
    member: z.string().max(80).optional(),
    tag: z.string().max(80).optional(),
    min: decimal.optional(),
    max: decimal.optional(),
    query: z.string().max(200).optional(),
    page: z.coerce.number().int().min(1).max(1000000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    group: z.enum(["day", "month", "year"]).default("day"),
    format: z.enum(["csv", "json"]).optional(),
  })
  .refine((f) => !f.from || !f.to || f.from <= f.to, {
    message: "开始日期不能晚于结束日期",
  })
  .refine((f) => !f.min || !f.max || new Decimal(f.min).lte(f.max), {
    message: "最小金额不能超过最大金额",
  });

export function createAccountService(
  store: Store,
  client: Client,
  locks: AccountLocks,
) {
  const snap = (s: Session) => store.snapshot(s.uid);
  const filters = (query: unknown) => filterSchema.parse(query);
  const bootstrap = async (account: Session) => {
    const s = snap(account);
    return {
      ...s,
      bills: undefined,
      cursors: undefined,
      user: account.user,
      capabilities: capabilities(store, account.uid),
      settings: store.settings(account.uid),
      billCount: s.bills.length,
      demo: !!account.demo,
    };
  };
  const sync = async (account: Session, body: unknown) =>
    locks.run(account.uid, async () => {
      const { full } = z
        .object({ full: z.boolean().default(false) })
        .parse(body);
      const s = account.demo
        ? snap(account)
        : await syncAccount(store, client, account, full);
      return { lastSync: s.lastSync, billCount: s.bills.length };
    });
  const bills = async (account: Session, query: unknown) => {
    const f = filters(query);
    const list = filterBills(snap(account), f as unknown as Filters);
    return {
      list: list
        .slice((f.page - 1) * f.pageSize, f.page * f.pageSize)
        .map(publicBill),
      total: list.length,
      page: f.page,
      pageSize: f.pageSize,
    };
  };
  const bill = async (account: Session, id: string) => {
    const snapshot = snap(account),
      bill = snapshot.bills.find((b) => b.id === id);
    if (!bill) throw new AppError("NOT_FOUND", "账单不存在", 404);
    return {
      bill: publicBill(bill),
      revision: revision(bill),
      related: snapshot.bills
        .filter(
          (b) =>
            String(b.extra?.refundsid) === bill.id ||
            b.id === String(bill.extra?.refundsid) ||
            Object.keys(bill.extra?.bxs ?? {}).includes(b.id),
        )
        .map(publicBill),
    };
  };
  const stats = async (account: Session, query: unknown) =>
    statistics(snap(account), filters(query) as unknown as Filters);
  const budgets = async (account: Session, query: unknown) => {
    const q = z
      .object({
        bookid: z.string().default("-1"),
        kind: z.enum(["month", "year"]).default("month"),
        period: z.string().regex(/^\d{4}(-\d{2})?$/),
      })
      .parse(query);
    const [year, month] = q.period.split("-");
    if (
      q.kind === "month" &&
      (!month || Number(month) < 1 || Number(month) > 12)
    )
      throw new AppError("PERIOD", "请选择有效月份");
    let data: Raw;
    if (account.demo) {
      const f = {
        bookid: q.bookid,
        from: q.kind === "month" ? q.period + "-01" : year + "-01-01",
        to: q.kind === "month" ? q.period + "-31" : year + "-12-31",
      };
      const spend = statistics(snap(account), f);
      data = {
        list: [
          {
            budgetid: "81000000000020000",
            bookid: q.bookid,
            flag: "1",
            money: q.kind === "month" ? "6000" : "72000",
            used: spend.totals.spend,
          },
          {
            budgetid: "81000000000021000",
            bookid: q.bookid,
            flag: "2",
            cateid: "101",
            money: "2000",
            used: spend.categories.find((c) => c.id === "101")?.money ?? "0",
            category: { name: "餐饮美食" },
          },
        ],
        daystats: spend.trend.map((t) => ({
          datetime: String(Date.parse(t.date + "T00:00:00+08:00") / 1000),
          spend: t.spend,
        })),
      };
    } else
      data = await client.call(
        "/budget/list",
        {
          bookid: q.bookid,
          flts: JSON.stringify(
            q.kind === "month"
              ? { month: year + "," + Number(month) }
              : { year },
          ),
        },
        account,
      );
    const list = requireList(data).map((b) => {
      if (b.money == null || b.used == null)
        throw new AppError("BUDGET_STRUCTURE", "预算金额结构尚未确认", 502);
      return {
        ...b,
        money: String(b.money),
        used: String(b.used),
        remaining: new Decimal(b.money).minus(b.used).toFixed(),
      };
    });
    return { ...data, list };
  };
  const resources = async (account: Session, kind: string, query: unknown) => {
    const q = z
      .object({
        bookid: z.string().default("-1"),
        direction: z.enum(["51", "52"]).default("51"),
        status: z.enum(["0", "1"]).default("0"),
      })
      .parse(query);
    const snapshot = snap(account);
    if (kind === "books") return { list: snapshot.books };
    if (kind === "categories")
      return {
        list: snapshot.categories.filter(
          (c) => c.bookid === q.bookid || c.bookid === "-1",
        ),
      };
    if (kind === "members")
      return {
        list: snapshot.books.find((b) => b.bookid === q.bookid)?.members ?? [],
        source: "初始化账本成员",
      };
    if (!["assets", "loans", "tags", "currencies"].includes(kind))
      throw new AppError("NOT_FOUND", "查询项目不存在", 404);
    if (account.demo) return demoResource(kind);
    const path = {
      assets: "/asset/list",
      loans: "/asset/listloan",
      tags: "/tag/list",
      currencies: "/currency/listv2",
    }[kind]!;
    const body =
      kind === "loans"
        ? { t: q.direction, status: q.status }
        : kind === "assets"
          ? { status: 0 }
          : kind === "tags"
            ? { status: -1, lasttime: 0 }
            : {};
    const data = await client.call(path, body, account),
      list = requireList(data);
    if (kind === "tags")
      return {
        ...data,
        list: list.flatMap((group) => {
          if (!Array.isArray(group.tags))
            throw new AppError("TAG_STRUCTURE", "标签分组结构尚未确认", 502);
          return group.tags.map((t: Raw) => ({
            ...t,
            id: String(t.id),
            groupName: group.name,
          }));
        }),
      };
    if (
      ["assets", "loans"].includes(kind) &&
      list.some(
        (x) =>
          x.id == null ||
          typeof x.name !== "string" ||
          x.money == null ||
          (kind === "loans" && (!x.loan || x.loan.money == null)),
      )
    )
      throw new AppError(
        "RESOURCE_STRUCTURE",
        "资产或借贷数据结构尚未确认，不能判断余额",
        502,
      );
    return data;
  };
  const settings = async (account: Session) => ({
    settings: store.settings(account.uid),
    capabilities: capabilities(store, account.uid),
    operations: store.operations(account.uid),
  });
  const write = async (account: Session, body: unknown) =>
    locks.run(account.uid, async () => {
      const input = z
        .object({
          requestId: z.uuid(),
          action: z.enum([
            "create",
            "edit",
            "delete",
            "refund",
            "reimburse",
            "upgrade",
            "cancelReimburse",
          ]),
          testing: z.boolean().default(false),
          bookid: z.string().max(80),
          id: z.string().max(80).optional(),
          expected: z.string().max(16000).optional(),
          money: decimal.optional(),
          cateid: z.string().max(80).optional(),
          time: z.number().int().min(0).max(4102444800).optional(),
          type: z.number().int().optional(),
          remark: z.string().max(1000).optional(),
        })
        .strict()
        .parse(body);
      const unresolved = store
        .operations(account.uid)
        .find(
          (o) =>
            ["pending", "uncertain"].includes(o.status) &&
            o.requestId !== input.requestId,
        );
      if (unresolved)
        throw new AppError(
          "PENDING_WRITE",
          "账号有尚未确认的写入，请先在设置中核查结果",
          409,
        );
      return performWrite(
        store,
        client,
        account,
        input as typeof input & { action: WriteAction },
      );
    });
  const reconcile = async (account: Session, id: string) =>
    locks.run(account.uid, () => reconcileWrite(store, client, account, id));
  return {
    bootstrap,
    sync,
    bills,
    bill,
    stats,
    budgets,
    resources,
    settings,
    write,
    reconcile,
  };
}
export type AccountService = ReturnType<typeof createAccountService>;
