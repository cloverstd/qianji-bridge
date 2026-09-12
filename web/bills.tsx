import React, { useState } from "react";
import {
  Search,
  RotateCcw,
  ReceiptText,
  ArrowDownLeft,
  LoaderCircle,
  Pencil,
  Trash2,
} from "lucide-react";
import type {
  Bill,
  Book,
  Category,
  Filters,
  Raw,
  WriteAction,
} from "../shared/types";
import { actionLabels, typeLabels } from "../shared/types";
import { api, useRemote } from "./api";
import { money, day, datetime } from "./format";
import { Empty, Notice, Loading, Field, Modal } from "./ui";
export function BillTable({
  bills,
  categories,
  books,
  onSelect,
  compact = false,
}: {
  bills: Bill[];
  categories: Category[];
  books: Book[];
  onSelect: (id: string) => void;
  compact?: boolean;
}) {
  if (!bills.length) return <Empty text="没有找到符合条件的账单" />;
  return (
    <div className="table-scroll">
      <table className="bill-table">
        <thead>
          <tr>
            <th>分类 / 备注</th>
            <th>日期</th>
            {!compact && <th>账本</th>}
            <th>类型</th>
            <th className="right">金额</th>
          </tr>
        </thead>
        <tbody>
          {bills.map((b) => (
            <tr key={b.id}>
              <td>
                <button className="bill-name" onClick={() => onSelect(b.id)}>
                  <span className={"category-icon t" + b.type}>
                    {b.type === 1 ? (
                      <ArrowDownLeft size={18} />
                    ) : b.type === 20 ? (
                      <RotateCcw size={18} />
                    ) : (
                      <ReceiptText size={18} />
                    )}
                  </span>
                  <span>
                    <strong>
                      {categories.find(
                        (c) => c.id === b.cateid && c.bookid === b.bookid,
                      )?.name ??
                        categories.find((c) => c.id === b.cateid)?.name ??
                        "未分类"}
                    </strong>
                    <small>{b.remark || "无备注"}</small>
                  </span>
                </button>
              </td>
              <td className="muted nowrap">{day(b.time)}</td>
              {!compact && (
                <td className="muted">
                  {books.find((x) => x.bookid === b.bookid)?.name ?? "未知账本"}
                </td>
              )}
              <td>
                <span className={"type-tag t" + b.type}>
                  {typeLabels[b.type] ?? `类型 ${b.type}`}
                </span>
              </td>
              <td
                className={
                  "right amount " + ([1, 20].includes(b.type) ? "positive" : "")
                }
              >
                {b.type === 0 ? "− " : [1, 20].includes(b.type) ? "+ " : ""}
                {money(b.money)}
                {b.extra?.curr && (
                  <small>
                    {b.extra.curr.ss} {money(b.extra.curr.sv)}
                  </small>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function FiltersBar({
  filters,
  onChange,
  bootstrap,
  tags,
}: {
  filters: Filters;
  onChange: (f: Filters) => void;
  bootstrap: Raw;
  tags: Raw[];
}) {
  const set = (key: string, value: string) =>
    onChange({ ...filters, [key]: value, page: "1" });
  const members = [
    ...new Map<string, Raw>(
      bootstrap.books.flatMap((b: Book) =>
        (b.members ?? []).map((m: Raw) => [String(m.id), m] as [string, Raw]),
      ),
    ).values(),
  ];
  return (
    <div className="filters-panel">
      <div className="search-box">
        <Search size={17} />
        <input
          aria-label="搜索备注"
          placeholder="搜索账单备注…"
          value={filters.query ?? ""}
          onChange={(e) => set("query", e.target.value)}
        />
      </div>
      <div className="filter-grid">
        <Field label="开始日期">
          <input
            type="date"
            value={filters.from ?? ""}
            onChange={(e) => set("from", e.target.value)}
          />
        </Field>
        <Field label="结束日期">
          <input
            type="date"
            value={filters.to ?? ""}
            onChange={(e) => set("to", e.target.value)}
          />
        </Field>
        <Field label="账单类型">
          <select
            value={filters.type ?? ""}
            onChange={(e) => set("type", e.target.value)}
          >
            <option value="">全部类型</option>
            {Object.entries(typeLabels).map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="分类">
          <select
            value={filters.category ?? ""}
            onChange={(e) => set("category", e.target.value)}
          >
            <option value="">全部分类</option>
            {bootstrap.categories.map((c: Category) => (
              <option key={c.bookid + c.id} value={c.id}>
                {c.level === 2 ? "└ " : ""}
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="成员">
          <select
            value={filters.member ?? ""}
            onChange={(e) => set("member", e.target.value)}
          >
            <option value="">全部成员</option>
            {members.map((m: Raw) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="标签">
          <select
            value={filters.tag ?? ""}
            onChange={(e) => set("tag", e.target.value)}
          >
            <option value="">全部标签</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="最小金额">
          <input
            inputMode="decimal"
            placeholder="不限"
            value={filters.min ?? ""}
            onChange={(e) => set("min", e.target.value)}
          />
        </Field>
        <Field label="最大金额">
          <input
            inputMode="decimal"
            placeholder="不限"
            value={filters.max ?? ""}
            onChange={(e) => set("max", e.target.value)}
          />
        </Field>
      </div>
      <button
        className="text-button"
        onClick={() => onChange({ bookid: filters.bookid, page: "1" })}
      >
        <RotateCcw size={14} />
        清除筛选
      </button>
    </div>
  );
}
export function WriteForm({
  action,
  bill,
  revision,
  bootstrap,
  onClose,
  onDone,
}: {
  action: WriteAction;
  bill?: Bill;
  revision?: string;
  bootstrap: Raw;
  onClose: () => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [result, setResult] = useState<Raw | null>(null);
  const [bookid, setBookid] = useState(
      bill?.bookid ?? bootstrap.settings.testBookid ?? "-1",
    ),
    [type, setType] = useState(bill?.type ?? 0),
    [testing, setTesting] = useState(
      !bootstrap.capabilities.find((c: Raw) => c.action === action)?.verified,
    );
  const requestId = React.useRef(crypto.randomUUID());
  const isRecord = action === "create" || action === "edit";
  const isAmount = isRecord || action === "refund" || action === "reimburse";
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    const values = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const result = await api("/writes", {
        requestId: requestId.current,
        action,
        testing,
        bookid,
        id: bill?.id,
        expected: revision,
        ...(isAmount
          ? {
              money: values.money,
              remark: values.remark,
              time: Math.floor(
                Date.parse(String(values.time) + "+08:00") / 1000,
              ),
            }
          : {}),
        ...(isRecord ? { type, cateid: values.cateid } : {}),
      });
      setResult(result);
      onDone();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const testBook = bootstrap.books.find(
    (b: Book) => b.bookid === bootstrap.settings.testBookid,
  );
  return (
    <Modal title={actionLabels[action]} onClose={onClose}>
      <form onSubmit={submit} className="write-form">
        {message && <Notice kind="error">{message}</Notice>}
        {result ? (
          <>
            <Notice kind={result.status === "confirmed" ? "success" : "error"}>
              {result.message}
            </Notice>
            {result.status !== "confirmed" && (
              <button
                type="button"
                disabled={busy}
                className="secondary"
                onClick={async () => {
                  setBusy(true);
                  try {
                    setResult(
                      await api(
                        "/writes/" + requestId.current + "/reconcile",
                        {},
                      ),
                    );
                    onDone();
                  } catch (e) {
                    setMessage((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                只核查结果，不重新提交
              </button>
            )}
            <button type="button" className="primary" onClick={onClose}>
              完成
            </button>
          </>
        ) : (
          <>
            <Notice>
              {testing
                ? `此操作会真实写入测试账本「${testBook?.name ?? "尚未指定"}」。核验通过后，开放同类普通账单操作。`
                : "保存后将同步到钱迹账号。"}
            </Notice>
            {action === "delete" && (
              <p>
                确定删除「{bill?.remark || "这笔账单"}」？金额{" "}
                {money(bill?.money)}。删除会同步到钱迹 App。
              </p>
            )}
            <Field label="账本">
              <select
                value={bookid}
                disabled={!!bill}
                onChange={(e) => setBookid(e.target.value)}
                required
              >
                <option value="" disabled>
                  请选择账本
                </option>
                {bootstrap.books.map((b: Book) => (
                  <option key={b.bookid} value={b.bookid}>
                    {b.name}
                  </option>
                ))}
              </select>
            </Field>
            {isRecord && (
              <Field label="类型">
                <select
                  value={type}
                  onChange={(e) => setType(Number(e.target.value))}
                >
                  <option value={0}>支出</option>
                  <option value={1}>收入</option>
                  <option value={5}>待报销支出</option>
                </select>
              </Field>
            )}
            {isAmount && (
              <>
                <Field label={`金额（${bootstrap.config.mcurrency ?? "CNY"}）`}>
                  <input
                    name="money"
                    inputMode="decimal"
                    pattern="[0-9]+(\.[0-9]{1,2})?"
                    required
                    defaultValue={isRecord ? bill?.money : undefined}
                    placeholder="0.00"
                  />
                </Field>
                {isRecord && (
                  <Field label="分类">
                    <select
                      name="cateid"
                      defaultValue={bill?.cateid ?? ""}
                      required
                    >
                      <option value="" disabled>
                        请选择分类
                      </option>
                      {bootstrap.categories
                        .filter(
                          (c: Category) =>
                            c.type === (type === 1 ? 1 : 0) &&
                            (c.bookid === bookid || c.bookid === "-1"),
                        )
                        .map((c: Category) => (
                          <option key={c.bookid + c.id} value={c.id}>
                            {c.level === 2 ? "└ " : ""}
                            {c.name}
                          </option>
                        ))}
                    </select>
                  </Field>
                )}
                <Field label="发生时间（北京时间）">
                  <input
                    name="time"
                    type="datetime-local"
                    required
                    defaultValue={new Date(
                      (isRecord && bill ? bill.time * 1000 : Date.now()) +
                        28800000,
                    )
                      .toISOString()
                      .slice(0, 16)}
                  />
                </Field>
                <Field label="备注">
                  <textarea
                    name="remark"
                    maxLength={1000}
                    rows={3}
                    defaultValue={isRecord ? bill?.remark : ""}
                    placeholder="记下这一笔的小细节"
                  />
                </Field>
              </>
            )}
            {bootstrap.capabilities.find((c: Raw) => c.action === action)
              ?.verified && (
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={testing}
                  onChange={(e) => setTesting(e.target.checked)}
                />
                在测试账本重新验收
              </label>
            )}
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={onClose}>
                取消
              </button>
              <button
                className={action === "delete" ? "danger" : "primary"}
                disabled={busy || bootstrap.demo || (!testBook && testing)}
              >
                {busy ? (
                  <>
                    <LoaderCircle className="spin" size={17} />
                    提交与核验中…
                  </>
                ) : testing ? (
                  "确认测试写入"
                ) : (
                  "确认同步到钱迹"
                )}
              </button>
            </div>
          </>
        )}
      </form>
    </Modal>
  );
}
export function BillDetail({
  id,
  bootstrap,
  onClose,
  onWrite,
  version,
}: {
  id: string;
  bootstrap: Raw;
  onClose: () => void;
  onWrite: (action: WriteAction, bill: Bill, revision: string) => void;
  version: number;
}) {
  const { data, error, loading } = useRemote("/bills/" + id, version),
    b = data?.bill as Bill | undefined;
  return (
    <Modal title="账单详情" onClose={onClose}>
      {loading ? (
        <Loading />
      ) : error ? (
        <Notice kind="error">{error}</Notice>
      ) : (
        b && (
          <>
            <div className="detail-amount">
              <span className={"type-tag t" + b.type}>
                {typeLabels[b.type] ?? "其他类型"}
              </span>
              <strong className={[1, 20].includes(b.type) ? "positive" : ""}>
                {money(b.money)}
                <small>{bootstrap.config.mcurrency ?? "CNY"}</small>
              </strong>
              <p className="muted">{b.remark || "无备注"}</p>
            </div>
            <dl className="detail-list">
              <dt>账单 ID</dt>
              <dd className="id">{b.id}</dd>
              <dt>账本</dt>
              <dd>
                {bootstrap.books.find((x: Book) => x.bookid === b.bookid)
                  ?.name ?? b.bookid}
              </dd>
              <dt>分类</dt>
              <dd>
                {bootstrap.categories.find((c: Category) => c.id === b.cateid)
                  ?.name ?? b.cateid}
              </dd>
              <dt>发生时间</dt>
              <dd>{datetime(b.time)}</dd>
              <dt>成员</dt>
              <dd>
                {bootstrap.books
                  .flatMap((x: Book) => x.members ?? [])
                  .find((m: Raw) => String(m.id) === b.userid)?.name ??
                  b.userid}
              </dd>
              <dt>资产</dt>
              <dd>
                {String(b.assetid ?? "-1") === "-1" ? "未关联" : b.assetid}
              </dd>
              {b.extra?.curr && (
                <>
                  <dt>原币金额</dt>
                  <dd>
                    {b.extra.curr.ss} {money(b.extra.curr.sv)}
                  </dd>
                  <dt>历史换算金额</dt>
                  <dd>
                    {b.extra.curr.ts} {money(b.extra.curr.tv)}
                  </dd>
                </>
              )}
            </dl>
            {data.related.length > 0 && (
              <div className="related">
                <h3>关联账单</h3>
                {data.related.map((r: Bill) => (
                  <div key={r.id}>
                    <span>
                      {typeLabels[r.type]} · {r.remark || day(r.time)}
                    </span>
                    <b>{money(r.money)}</b>
                  </div>
                ))}
              </div>
            )}
            <div className="detail-actions">
              {(
                [
                  "edit",
                  "refund",
                  "reimburse",
                  "cancelReimburse",
                  "delete",
                ] as WriteAction[]
              ).map((action) => (
                <button
                  key={action}
                  className={
                    action === "delete" ? "text-button negative" : "secondary"
                  }
                  disabled={bootstrap.demo}
                  onClick={() => onWrite(action, b, data.revision)}
                >
                  {action === "edit" ? (
                    <Pencil size={15} />
                  ) : action === "delete" ? (
                    <Trash2 size={15} />
                  ) : (
                    <RotateCcw size={15} />
                  )}{" "}
                  {actionLabels[action]}
                </button>
              ))}
            </div>
            {bootstrap.demo && (
              <p className="footnote">
                演示账单只供浏览。登录后可在专用测试账本验证写入。
              </p>
            )}
            <details className="raw-detail">
              <summary>完整账单数据</summary>
              <pre>{JSON.stringify(b, null, 2)}</pre>
            </details>
          </>
        )
      )}
    </Modal>
  );
}
