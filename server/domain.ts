import { Decimal } from "decimal.js";
import { parse, stringify, isLosslessNumber } from "lossless-json";
import type {
  Bill,
  Category,
  Filters,
  Raw,
  Snapshot,
  Statistics,
  Totals,
} from "../shared/types.js";

Decimal.set({ precision: 60 });

// Preserve every number token before any JavaScript Number conversion, including nested IDs.
const rawObjects = new WeakMap<object, string>();
export function parseUpstream(text: string): any {
  const visit = (value: any): any => {
    if (isLosslessNumber(value)) return value.value;
    if (Array.isArray(value)) return value.map(visit);
    if (value && typeof value === "object") {
      const result = Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, visit(v)]),
      );
      rawObjects.set(result, stringify(value)!);
      return result;
    }
    return value;
  };
  return visit(parse(text));
}
export function publicBill(b: Bill): Bill {
  const { _wire, ...rest } = b;
  return rest as Bill;
}
export function normalizeBill(raw: Raw): Bill {
  if (
    raw.id == null ||
    raw.bookid == null ||
    raw.money == null ||
    !Number.isFinite(Number(raw.time))
  )
    throw new Error("账单结构不完整，同步未保存");
  if (!new Decimal(raw.money).isFinite() || !Number.isInteger(Number(raw.type)))
    throw new Error("账单金额或类型无效");
  return {
    ...raw,
    _wire: rawObjects.get(raw) ?? raw._wire,
    id: String(raw.id),
    bookid: String(raw.bookid),
    userid: String(raw.userid ?? ""),
    cateid: String(raw.cateid ?? "-1"),
    type: Number(raw.type),
    time: Number(raw.time),
    money: new Decimal(raw.money).toFixed(),
  };
}
export function normalizeCategory(raw: Raw): Category {
  if (raw.id == null || typeof raw.name !== "string")
    throw new Error("分类结构不完整");
  return {
    ...raw,
    name: String(raw.name),
    id: String(raw.id),
    bookid: String(raw.bookid ?? "-1"),
    parentid: String(raw.parentid ?? "-1"),
    type: Number(raw.type),
    level: Number(raw.level ?? 1),
  };
}
export const day = (seconds: number) =>
  new Date(seconds * 1000 + 8 * 3600_000).toISOString().slice(0, 10);
export function parentCategory(
  bill: Bill,
  snapshot: Snapshot,
): { id: string; name: string } {
  const original =
    bill.type === 20
      ? snapshot.bills.find((b) => b.id === String(bill.extra?.refundsid))
      : undefined;
  const source = original ?? bill;
  let category =
    snapshot.categories.find(
      (c) => c.id === source.cateid && c.bookid === source.bookid,
    ) ?? snapshot.categories.find((c) => c.id === source.cateid);
  const visited = new Set<string>();
  while (category && category.parentid !== "-1" && !visited.has(category.id)) {
    visited.add(category.id);
    const parent = snapshot.categories.find(
      (c) => c.id === category!.parentid && c.bookid === category!.bookid,
    );
    if (!parent) break;
    category = parent;
  }
  return {
    id: category?.id ?? source.cateid,
    name: category?.name ?? "未分类",
  };
}
export function filterBills(snapshot: Snapshot, f: Filters): Bill[] {
  const categoryIds = new Set(f.category ? [f.category] : []);
  let size = -1;
  while (size !== categoryIds.size) {
    size = categoryIds.size;
    for (const c of snapshot.categories)
      if (categoryIds.has(c.parentid)) categoryIds.add(c.id);
  }
  return snapshot.bills
    .filter((b) => {
      const date = day(b.time);
      const original =
        b.type === 20
          ? snapshot.bills.find((x) => x.id === String(b.extra?.refundsid))
          : undefined;
      const tags = b.extra?.tags;
      return (
        (!f.bookid || b.bookid === f.bookid) &&
        (!f.from || date >= f.from) &&
        (!f.to || date <= f.to) &&
        (!f.type || String(b.type) === f.type) &&
        (!f.category || categoryIds.has((original ?? b).cateid)) &&
        (!f.member || b.userid === f.member) &&
        (!f.tag ||
          (Array.isArray(tags) &&
            tags.some(
              (t) => String(typeof t === "object" ? t.id : t) === f.tag,
            ))) &&
        (!f.min || new Decimal(b.money).gte(f.min)) &&
        (!f.max || new Decimal(b.money).lte(f.max)) &&
        (!f.query ||
          (b.remark ?? "")
            .toLocaleLowerCase()
            .includes(f.query.toLocaleLowerCase()))
      );
    })
    .sort((a, b) => b.time - a.time || b.id.localeCompare(a.id));
}
const empty = (): Totals => ({
  income: "0",
  spend: "0",
  net: "0",
  refund: "0",
  transfer: "0",
  repayment: "0",
  reimbursement: "0",
  unknown: "0",
  count: 0,
});
function add(t: Totals, b: Bill) {
  const key =
    (
      {
        0: "spend",
        1: "income",
        2: "transfer",
        3: "repayment",
        5: "reimbursement",
        20: "refund",
      } as const
    )[b.type as 0] ?? "unknown";
  t[key] = new Decimal(t[key]).plus(b.money).toFixed();
  if (b.type === 20) t.spend = new Decimal(t.spend).minus(b.money).toFixed();
  t.net = new Decimal(t.income).minus(t.spend).toFixed();
  t.count++;
}
export function statistics(snapshot: Snapshot, f: Filters): Statistics {
  const totals = empty();
  const trend = new Map<string, Totals>();
  const categories = new Map<
    string,
    { id: string; name: string; money: string }
  >();
  let orphanRefunds = 0;
  for (const b of filterBills(snapshot, f)) {
    add(totals, b);
    const date = day(b.time).slice(
      0,
      f.group === "year" ? 4 : f.group === "month" ? 7 : 10,
    );
    const bucket = trend.get(date) ?? empty();
    add(bucket, b);
    trend.set(date, bucket);
    if (b.type === 0 || b.type === 20) {
      const c = parentCategory(b, snapshot);
      const existing = categories.get(c.id) ?? { ...c, money: "0" };
      existing.money = new Decimal(existing.money)
        .plus(new Decimal(b.money).times(b.type === 20 ? -1 : 1))
        .toFixed();
      categories.set(c.id, existing);
      if (
        b.type === 20 &&
        !snapshot.bills.some((x) => x.id === String(b.extra?.refundsid))
      )
        orphanRefunds++;
    }
  }
  return {
    totals,
    trend: [...trend]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, t]) => ({ date, ...t })),
    categories: [...categories.values()].sort((a, b) =>
      new Decimal(b.money).cmp(a.money),
    ),
    orphanRefunds,
  };
}
export function exportCsv(bills: Bill[]) {
  const cell = (v: unknown) =>
    '"' +
    String(v ?? "")
      .replace(/^[=+\-@\t\r]/, "'$&")
      .replaceAll('"', '""') +
    '"';
  // Apostrophe keeps long identifiers as text when opened in a spreadsheet.
  return (
    "\uFEFF" +
    [
      [
        "账单ID",
        "账本ID",
        "日期",
        "类型",
        "基准金额",
        "原币",
        "原币金额",
        "备注",
      ],
      ...bills.map((b) => [
        "'" + b.id,
        "'" + b.bookid,
        day(b.time),
        b.type,
        b.money,
        b.extra?.curr?.ss,
        b.extra?.curr?.sv,
        b.remark,
      ]),
    ]
      .map((row) => row.map(cell).join(","))
      .join("\r\n")
  );
}
