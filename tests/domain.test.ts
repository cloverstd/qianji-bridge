import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseUpstream,
  normalizeBill,
  normalizeCategory,
  filterBills,
  statistics,
  exportCsv,
  publicBill,
} from "../server/domain.js";
import { emptySnapshot } from "../server/store.js";
import { payloadBill } from "../server/writes.js";
import { stringify } from "lossless-json";
const base = {
  id: "8100000000000012000",
  bookid: "-1",
  userid: "u1",
  cateid: "11",
  type: 0,
  time: Date.parse("2026-09-01T00:00:00+08:00") / 1000,
  money: "0.1",
};
test("lossless tokens cover nested IDs, deletion arrays, money and unknown fields", () => {
  const raw = parseUpstream(
    '{"id":8100000000000012000,"bookid":-1,"cateid":11,"userid":"u1","type":0,"time":1788192000,"money":0.10,"extra":{"refundsid":8100000000000013000,"unknown":2,"large":9223372036854775807},"deletes":[8100000000000014000]}',
  );
  assert.equal(raw.id, "8100000000000012000");
  assert.equal(raw.extra.refundsid, "8100000000000013000");
  assert.equal(raw.deletes[0], "8100000000000014000");
  assert.equal(raw.money, "0.10");
  const b = normalizeBill(raw);
  const wire = stringify(
    payloadBill({ ...b, remark: "编辑后", money: "0.20" }),
  )!;
  assert.match(wire, /"id":8100000000000012000/);
  assert.match(wire, /"unknown":2/);
  assert.match(wire, /"large":9223372036854775807/);
  assert.match(wire, /"money":0.20/);
  assert.equal(publicBill(b)._wire, undefined);
});
test("refund month, base currency, category hierarchy and transfer exclusion", () => {
  const s = emptySnapshot();
  s.categories = [
    normalizeCategory({ id: "10", name: "饮食", parentid: "-1", type: 0 }),
    normalizeCategory({
      id: "11",
      name: "午餐",
      parentid: "10",
      type: 0,
      level: 2,
    }),
  ];
  s.bills = [
    normalizeBill({
      ...base,
      money: "100",
      time: Date.parse("2026-08-31T23:59:59+08:00") / 1000,
    }),
    normalizeBill({
      ...base,
      id: "2",
      type: 20,
      money: "20",
      extra: { refundsid: base.id },
    }),
    normalizeBill({
      ...base,
      id: "3",
      money: "500.25",
      extra: { curr: { ss: "JPY", sv: "10000", tv: "500.25" } },
    }),
    normalizeBill({ ...base, id: "4", type: 2, money: "500" }),
    normalizeBill({ ...base, id: "5", type: 3, money: "300" }),
    normalizeBill({ ...base, id: "6", type: 5, money: "80" }),
    normalizeBill({ ...base, id: "7", type: 1, money: "20000" }),
  ];
  const result = statistics(s, { from: "2026-09-01", to: "2026-09-30" });
  assert.equal(result.totals.spend, "480.25");
  assert.equal(result.totals.net, "19519.75");
  assert.equal(result.totals.refund, "20");
  assert.equal(result.totals.transfer, "500");
  assert.equal(result.totals.repayment, "300");
  assert.equal(result.totals.reimbursement, "80");
  assert.equal(result.categories[0]?.id, "10");
  assert.equal(result.trend.length, 1);
  assert.equal(statistics(s, { group: "month" }).trend.length, 2);
});
test("decimal addition is exact and unknown types are separate", () => {
  const s = emptySnapshot();
  s.bills = [
    normalizeBill(base),
    normalizeBill({ ...base, id: "2", money: "0.2" }),
    normalizeBill({ ...base, id: "3", type: 99, money: "1000" }),
  ];
  const t = statistics(s, {}).totals;
  assert.equal(t.spend, "0.3");
  assert.equal(t.unknown, "1000");
  assert.equal(t.net, "-0.3");
});
test("filters include child category, dates, tag/member/money and remark", () => {
  const s = emptySnapshot();
  s.categories = [
    normalizeCategory({ id: "11", parentid: "10", type: 0, name: "午餐" }),
  ];
  s.bills = [
    normalizeBill({ ...base, remark: "Lunch", extra: { tags: ["work"] } }),
  ];
  assert.equal(
    filterBills(s, {
      category: "10",
      member: "u1",
      tag: "work",
      query: "lunch",
      min: "0.1",
      max: "0.2",
      from: "2026-09-01",
      to: "2026-09-01",
    }).length,
    1,
  );
  assert.equal(filterBills(s, { from: "2026-09-02" }).length, 0);
  assert.equal(filterBills(s, { bookid: "another" }).length, 0);
});
test("CSV keeps IDs as text, quotes commas/newlines and neutralizes formulas", () => {
  const csv = exportCsv([
    normalizeBill({ ...base, remark: '=HYPERLINK("bad"),\nhello' }),
  ]);
  assert.match(csv, /'8100000000000012000/);
  assert.match(csv, /'=HYPERLINK/);
  assert.match(csv, /""bad""/);
  assert.ok(csv.startsWith("\uFEFF"));
});

test("sums remain exact beyond JavaScript safe integer and default decimal precision", () => {
  const s = emptySnapshot();
  s.bills = [
    normalizeBill({ ...base, money: "999999999999999999.99" }),
    normalizeBill({ ...base, id: "2", money: "999999999999999999.99" }),
  ];
  assert.equal(statistics(s, {}).totals.spend, "1999999999999999999.98");
});
