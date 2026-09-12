import type { Raw, Snapshot } from "../shared/types.js";
import { normalizeBill, normalizeCategory } from "./domain.js";
// All fixtures below are synthetic; no account or transaction data is embedded.
export function demoSnapshot(): Snapshot {
  const month = new Date(Date.now() + 28800000).toISOString().slice(0, 7);
  const categories = [
    ["101", "餐饮美食", "-1", 0],
    ["102", "交通出行", "-1", 0],
    ["103", "购物消费", "-1", 0],
    ["104", "居家生活", "-1", 0],
    ["105", "休闲娱乐", "-1", 0],
    ["106", "工资收入", "-1", 1],
    ["107", "咖啡茶饮", "101", 0],
    ["108", "旅行", "-1", 0],
  ].map(([id, name, parentid, type]) =>
    normalizeCategory({
      id,
      name,
      parentid,
      type,
      bookid: "-1",
      level: parentid === "-1" ? 1 : 2,
    }),
  );
  const names = [
    "午间工作餐",
    "地铁出行",
    "周末买菜",
    "咖啡与阅读",
    "生活用品",
    "电影之夜",
    "朋友聚餐",
    "通勤打车",
  ];
  const amounts = ["38.50", "6", "126.80", "28", "189", "65", "168", "32.50"];
  const cats = ["101", "102", "104", "107", "103", "105", "101", "102"];
  const bills = Array.from({ length: 68 }, (_, i) =>
    normalizeBill({
      id: (1788924961057158647n + BigInt(i)).toString(),
      bookid: i % 7 === 0 ? "81000000000001000" : "-1",
      userid: "__demo__",
      cateid: cats[i % 8],
      type: 0,
      time:
        Date.parse(
          `${month}-${String((i % 27) + 1).padStart(2, "0")}T${String(8 + (i % 12)).padStart(2, "0")}:30:00+08:00`,
        ) / 1000,
      money: amounts[i % 8],
      remark: names[i % 8],
      status: 1,
      assetid: "-1",
      extra: i % 5 === 0 ? { tags: ["work"] } : {},
    }),
  );
  bills.push(
    normalizeBill({
      id: "8100000000000017000",
      bookid: "-1",
      userid: "__demo__",
      cateid: "106",
      type: 1,
      time: Date.parse(`${month}-05T09:00:00+08:00`) / 1000,
      money: "18500",
      remark: "九月工资",
      assetid: "-1",
    }),
  );
  const original = bills[4]!;
  bills.push(
    normalizeBill({
      id: "8100000000000018000",
      bookid: original.bookid,
      userid: "__demo__",
      cateid: original.cateid,
      type: 20,
      time: original.time + 86400,
      money: "89",
      remark: "商品部分退款",
      extra: { refundsid: original.id },
    }),
  );
  return {
    bills,
    categories,
    books: [
      {
        bookid: "-1",
        name: "日常账本",
        members: [{ id: "__demo__", name: "演示用户" }],
      },
      {
        bookid: "81000000000001000",
        name: "旅行账本",
        members: [{ id: "__demo__", name: "演示用户" }],
      },
    ],
    user: { id: "__demo__", name: "演示用户", email: "demo@example.com" },
    config: { mcurrency: "CNY" },
    cursors: {},
    lastSync: new Date().toISOString(),
  };
}
export function demoResource(kind: string): Raw {
  if (kind === "assets")
    return {
      list: [
        {
          id: "8001",
          name: "日常储蓄卡",
          money: "32680.50",
          currency: "CNY",
          groupid: "1",
          type: "1",
        },
        {
          id: "8002",
          name: "现金",
          money: "580",
          currency: "CNY",
          groupid: "1",
          type: "0",
        },
      ],
      groups: [{ groupid: "1", name: "日常账户" }],
    };
  if (kind === "loans")
    return {
      list: [
        {
          id: "9001",
          name: "旅行垫付",
          money: "1200",
          currency: "CNY",
          stype: "52",
          status: "0",
          loan: { money: "2000", totalpay: "800" },
        },
      ],
    };
  if (kind === "tags")
    return {
      list: [
        { id: "work", name: "工作日", groupName: "生活标签" },
        { id: "travel", name: "旅行", groupName: "生活标签" },
      ],
    };
  if (kind === "currencies")
    return {
      list: [
        {
          symbol: "CNY",
          name: "人民币",
          sign: "¥",
          baseprice: "1.000000",
          pricetime: String(Math.floor(Date.now() / 1000)),
        },
        {
          symbol: "USD",
          name: "美元",
          sign: "$",
          baseprice: "7.000000",
          pricetime: String(Math.floor(Date.now() / 1000)),
        },
        {
          symbol: "JPY",
          name: "日元",
          sign: "¥",
          baseprice: "0.048000",
          pricetime: String(Math.floor(Date.now() / 1000)),
        },
      ],
    };
  return { list: [] };
}
