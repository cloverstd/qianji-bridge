import { randomInt } from "node:crypto";
import { parse, stringify, LosslessNumber } from "lossless-json";
import { Decimal } from "decimal.js";
import { AppError, type Client } from "./client.js";
import type { Store, Session } from "./store.js";
import type { Raw, Bill, WriteAction } from "../shared/types.js";
import { actionLabels } from "../shared/types.js";
import { syncAccount } from "./sync.js";
export const createBillId = (ms = Date.now()) =>
  (BigInt(ms) * 1000000n + BigInt(randomInt(100000, 200000))).toString();
const numericKeys = new Set([
  "id",
  "bookid",
  "cateid",
  "assetid",
  "fromid",
  "targetid",
  "time",
  "type",
  "money",
  "status",
  "createtime",
  "updatetime",
  "platform",
  "billid",
]);
function numeric(value: unknown) {
  const s = String(value);
  if (!/^-?\d+(\.\d+)?$/.test(s))
    throw new AppError("PAYLOAD", "写入数字字段无效");
  return new LosslessNumber(s);
}
export function payloadBill(b: Raw): Raw {
  const raw: Raw = b._wire ? (parse(b._wire) as Raw) : {};
  for (const field of ["bookname", "category", "asset", "user"])
    delete raw[field];
  for (const [key, value] of Object.entries(b)) {
    if (
      key === "_wire" ||
      ["bookname", "category", "asset", "user"].includes(key)
    )
      continue;
    if (numericKeys.has(key) && value != null) raw[key] = numeric(value);
    else if (!(key in raw) || ["remark", "images"].includes(key))
      raw[key] = value;
  }
  return raw;
}
export function capabilities(store: Store, uid: string) {
  const settings = store.settings(uid);
  return Object.entries(actionLabels).map(([action, label]) => ({
    action,
    label,
    verified: action !== "upgrade" && Boolean(settings.verified?.[action]),
    testable: action !== "upgrade",
    reason:
      action === "upgrade"
        ? "此操作会迁移整个账号，不能在单个测试账本中隔离验证，暂不开放"
        : "仅基准币种普通账单；需在专用测试账本通过真实写入及回拉核验",
  }));
}
export interface WriteInput {
  requestId: string;
  action: WriteAction;
  testing?: boolean;
  bookid: string;
  id?: string;
  expected?: string;
  money?: string;
  cateid?: string;
  time?: number;
  type?: number;
  remark?: string;
}
export function revision(b: Bill) {
  return JSON.stringify([
    b.money,
    b.time,
    b.type,
    b.cateid,
    b.remark,
    b.updatetime,
    b.extra,
  ]);
}
function plainBill(b: Bill) {
  if (
    ![0, 1, 5].includes(b.type) ||
    b.extra?.curr ||
    Number(b.extra?.transfee ?? 0) !== 0 ||
    String(b.assetid ?? "-1") !== "-1" ||
    (Array.isArray(b.images) && b.images.length)
  )
    throw new AppError(
      "WRITE_SCENARIO",
      "当前写入仅验证无资产关联、无图片、无外币及手续费的普通账单",
    );
}
function relations(b: Bill) {
  return (
    Object.keys(b.extra?.rfds ?? {}).length ||
    Object.keys(b.extra?.bxs ?? {}).length ||
    Number(b.extra?.refundv ?? 0) > 0 ||
    Number(b.extra?.baoxiaoed ?? 0) === 1
  );
}
export async function performWrite(
  store: Store,
  client: Client,
  s: Session,
  input: WriteInput,
): Promise<Raw> {
  if (s.demo) throw new AppError("DEMO_READONLY", "演示数据不可写入钱迹", 403);
  const prior = store.operation(s.uid, input.requestId);
  if (prior) return { requestId: input.requestId, ...prior.public };
  const settings = store.settings(s.uid),
    cap = capabilities(store, s.uid).find((x) => x.action === input.action)!;
  if (!cap?.testable)
    throw new AppError("WRITE_DISABLED", cap?.reason ?? "操作不可用", 403);
  if (input.testing) {
    if (!settings.testBookid || settings.testBookid !== input.bookid)
      throw new AppError(
        "TEST_BOOK_REQUIRED",
        "请先指定专用测试账本，测试写入只能发生在该账本",
        403,
      );
  } else if (!cap.verified)
    throw new AppError("WRITE_UNVERIFIED", "此功能尚未通过测试账本验收", 403);
  await syncAccount(store, client, s);
  const snapshot = store.snapshot(s.uid),
    before = snapshot.bills.find((b) => b.id === input.id);
  if (!snapshot.books.some((b) => b.bookid === input.bookid))
    throw new AppError("BOOK_NOT_FOUND", "账本不存在");
  if (input.action !== "create") {
    if (!before || before.bookid !== input.bookid)
      throw new AppError("BILL_NOT_FOUND", "账单不存在或不属于所选账本", 404);
    if (before.userid !== s.uid)
      throw new AppError("OWNERSHIP", "只能操作自己创建的账单", 403);
    if (input.expected !== revision(before))
      throw new AppError(
        "CONFLICT",
        "账单已在其他设备变更，请刷新详情后重试",
        409,
      );
    plainBill(before);
  }
  let bill: Raw | undefined,
    path = "/bill/syncall",
    body: Raw = {},
    expected: Raw = {
      action: input.action,
      bookid: input.bookid,
      id: input.id,
      testing: Boolean(input.testing),
    };
  const time = input.time ?? Math.floor(Date.now() / 1000);
  if (["create", "edit", "refund", "reimburse"].includes(input.action)) {
    if (
      !input.money ||
      !/^\d+(\.\d{1,2})?$/.test(input.money) ||
      !new Decimal(input.money).gt(0) ||
      new Decimal(input.money).gt("999999999.99")
    )
      throw new AppError(
        "MONEY",
        "金额必须大于 0，最多两位小数且不超过 999999999.99",
      );
  }
  if (input.action === "create" || input.action === "edit") {
    if (before && relations(before))
      throw new AppError("RELATED_BILL", "已关联退款或报销的账单暂不支持编辑");
    const type = input.type ?? before?.type ?? 0;
    if (![0, 1, 5].includes(type))
      throw new AppError("TYPE", "当前支持支出、收入和待报销支出");
    if (
      !snapshot.categories.some(
        (c) =>
          c.id === input.cateid &&
          (c.bookid === input.bookid || c.bookid === "-1") &&
          c.type === (type === 1 ? 1 : 0),
      )
    )
      throw new AppError("CATEGORY", "请选择匹配收支类型的有效分类");
    const id = before?.id ?? createBillId();
    bill = {
      ...(before ?? {}),
      id,
      userid: s.uid,
      bookid: input.bookid,
      time,
      type,
      money: input.money,
      remark: input.remark ?? "",
      status: 2,
      cateid: input.cateid,
      assetid: "-1",
      fromid: "-1",
      targetid: "-1",
      createtime: before?.createtime ?? Math.floor(Date.now() / 1000),
      updatetime: Math.floor(Date.now() / 1000),
      platform: before?.platform ?? 0,
      images: before?.images ?? [],
    };
    body = { v: stringify({ bills: { changelist: [payloadBill(bill)] } }) };
    expected = {
      ...expected,
      id,
      bill: {
        money: input.money,
        time,
        type,
        cateid: input.cateid,
        remark: input.remark ?? "",
      },
    };
  } else if (input.action === "delete") {
    if (relations(before!))
      throw new AppError(
        "RELATED_BILL",
        "已关联退款或报销的账单暂不支持删除，请先在钱迹处理关联记录",
      );
    body = { v: stringify({ bills: { dellist: [numeric(input.id)] } }) };
  } else if (input.action === "refund") {
    if (before!.type !== 0)
      throw new AppError("REFUND_TYPE", "只能对普通支出创建退款");
    const used = snapshot.bills
      .filter((b) => b.type === 20 && String(b.extra?.refundsid) === before!.id)
      .reduce((sum, b) => sum.plus(b.money), new Decimal(0));
    if (new Decimal(input.money!).plus(used).gt(before!.money))
      throw new AppError("REFUND_AMOUNT", "退款金额超过剩余可退金额");
    path = "/bill/refund2";
    body = {
      did: input.id,
      v: stringify({
        money: numeric(input.money),
        time,
        ...(input.remark ? { remark: input.remark } : {}),
      }),
    };
    expected = {
      ...expected,
      money: input.money,
      time,
      remark: input.remark ?? "",
      previousIds: snapshot.bills.map((b) => b.id),
    };
  } else if (input.action === "reimburse") {
    if (before!.type !== 5)
      throw new AppError("REIMBURSE_TYPE", "只能对待报销支出操作");
    if (relations(before!))
      throw new AppError(
        "REIMBURSE_RELATION",
        "已有退款或报销关系的账单暂不支持追加报销",
      );
    if (new Decimal(input.money!).gt(before!.money))
      throw new AppError("REIMBURSE_AMOUNT", "报销金额不能超过源账单金额");
    path = "/baoxiao/baoxiao";
    body = {
      v: stringify({ [input.id!]: { money: numeric(input.money) } }),
      bxtime: time,
      remark: input.remark ?? "",
    };
    expected = { ...expected, money: input.money };
  } else if (input.action === "cancelReimburse") {
    if (before!.type !== 5 || !Object.keys(before!.extra?.bxs ?? {}).length)
      throw new AppError("REIMBURSE_RELATION", "账单没有可核验的新版报销关系");
    path = "/baoxiao/cancelbaoxiao";
    body = { v: stringify([numeric(input.id)]) };
  }
  const operation: Raw = {
    expected,
    public: { status: "pending", message: "正在提交与核验，请勿重复记账" },
  };
  store.saveOperation(s.uid, input.requestId, operation);
  try {
    const result = await client.call(path, body, s);
    if (path === "/bill/syncall") {
      const r = result?.sync_result?.bill;
      const key =
        input.action === "create"
          ? "new_ids"
          : input.action === "edit"
            ? "update_ids"
            : "del_ids";
      if (
        !r ||
        !Array.isArray(r[key]) ||
        !r[key].map(String).includes(String(expected.id)) ||
        Number(r.has_failed) === 1 ||
        r.has_failed === true ||
        (Array.isArray(r.conf_ids) && r.conf_ids.length)
      )
        throw new AppError(
          "WRITE_REJECTED",
          "钱迹未明确接受本次账单操作，请核查结果",
          409,
        );
    }
    return await reconcileWrite(store, client, s, input.requestId);
  } catch (error) {
    operation.public = {
      status: "uncertain",
      message:
        error instanceof AppError
          ? error.message
          : "写入结果尚未确认，请核查后再操作",
    };
    store.saveOperation(s.uid, input.requestId, operation);
    return { requestId: input.requestId, ...operation.public };
  }
}
export async function reconcileWrite(
  store: Store,
  client: Client,
  s: Session,
  id: string,
): Promise<Raw> {
  const op = store.operation(s.uid, id);
  if (!op) throw new AppError("OPERATION_NOT_FOUND", "找不到写入记录", 404);
  if (["confirmed", "dismissed"].includes(op.public.status))
    return { requestId: id, ...op.public };
  await syncAccount(store, client, s, true);
  const snapshot = store.snapshot(s.uid),
    e = op.expected,
    b = snapshot.bills.find((b) => b.id === e.id);
  let confirmed = false;
  if (e.action === "create" || e.action === "edit")
    confirmed = Boolean(
      b &&
      b.bookid === e.bookid &&
      Object.entries(e.bill).every(([k, v]) =>
        k === "money"
          ? new Decimal(b.money).eq(String(v))
          : String(b[k] ?? "") === String(v),
      ),
    );
  else if (e.action === "delete") confirmed = !b;
  else if (e.action === "refund") {
    const candidates = snapshot.bills.filter(
      (x) =>
        !e.previousIds.includes(x.id) &&
        x.type === 20 &&
        String(x.extra?.refundsid) === e.id &&
        x.bookid === e.bookid &&
        new Decimal(x.money).eq(e.money) &&
        x.time === e.time &&
        (x.remark ?? "") === e.remark,
    );
    confirmed =
      candidates.length === 1 &&
      Boolean(
        b &&
        new Decimal(b.extra?.rfds?.[candidates[0]!.id] ?? "-1").eq(e.money),
      );
  } else if (e.action === "reimburse") {
    const entries = Object.entries(b?.extra?.bxs ?? {});
    confirmed =
      entries.length === 1 &&
      entries.every(
        ([related, amount]) =>
          new Decimal(String(amount)).eq(e.money) &&
          snapshot.bills.some(
            (x) => x.id === related && new Decimal(x.money).eq(e.money),
          ),
      );
  } else if (e.action === "cancelReimburse")
    confirmed = Boolean(
      b &&
      Object.keys(b.extra?.bxs ?? {}).length === 0 &&
      Number(b.extra?.baoxiaoed ?? 0) === 0,
    );
  op.public = {
    status: confirmed ? "confirmed" : "uncertain",
    message: confirmed
      ? "钱迹已同步，本次操作核验通过"
      : "回拉数据尚未匹配本次操作，请在钱迹核查；不要重复提交",
  };
  store.saveOperation(s.uid, id, op);
  if (confirmed && e.testing) {
    const settings = store.settings(s.uid);
    settings.verified = {
      ...settings.verified,
      [e.action]: {
        time: new Date().toISOString(),
        bookid: e.bookid,
        scope: "simple-base-currency",
      },
    };
    store.saveSettings(s.uid, settings);
  }
  return { requestId: id, ...op.public };
}
