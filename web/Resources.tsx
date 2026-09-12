import { useState } from "react";
import { BookOpen, Shapes } from "lucide-react";
import type { Book, Category, Raw } from "../shared/types";
import { useRemote, qs } from "./api";
import { money, datetime } from "./format";
import { Empty, Notice, Loading } from "./ui";
export function Resources({
  bootstrap,
  version,
  bookid,
}: {
  bootstrap: Raw;
  version: number;
  bookid: string;
}) {
  const [kind, setKind] = useState("books"),
    [direction, setDirection] = useState("51"),
    [status, setStatus] = useState("0"),
    [search, setSearch] = useState("");
  const remote = useRemote(
    "/resources/" +
      kind +
      "?" +
      qs({ bookid: bookid || "-1", direction, status }),
    version,
  );
  const list = (remote.data?.list ?? []).filter((r: Raw) =>
    (String(r.name ?? "") + " " + String(r.symbol ?? ""))
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <>
      <div className="tabs wrap">
        {Object.entries({
          books: "账本",
          members: "成员",
          categories: "分类",
          assets: "资产",
          loans: "借入借出",
          tags: "标签",
          currencies: "币种",
        }).map(([key, label]) => (
          <button
            key={key}
            className={kind === key ? "active" : ""}
            onClick={() => {
              setKind(key);
              setSearch("");
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <section className="panel">
        <div className="panel-heading">
          <h2>
            {
              {
                books: "我的账本",
                members: "账本成员",
                categories: "分类目录",
                assets: "我的资产",
                loans: "借入借出",
                tags: "标签管理",
                currencies: "币种与参考汇率",
              }[kind]
            }
          </h2>
          <div className="inline-controls">
            {kind === "loans" && (
              <>
                <select
                  aria-label="借贷方向"
                  value={direction}
                  onChange={(e) => setDirection(e.target.value)}
                >
                  <option value="51">借入</option>
                  <option value="52">借出</option>
                </select>
                <select
                  aria-label="借贷状态"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  <option value="0">未结清</option>
                  <option value="1">已结清</option>
                </select>
              </>
            )}
            <input
              aria-label="搜索资料"
              placeholder="搜索名称"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        {remote.error ? (
          <Notice kind="error">{remote.error}</Notice>
        ) : remote.loading ? (
          <Loading />
        ) : !list.length ? (
          <Empty
            text="暂无相关资料"
            detail="当前账号或筛选条件下没有返回记录。"
          />
        ) : (
          <>
            {kind === "books" ? (
              <div className="book-grid">
                {list.map((b: Book, i: number) => (
                  <article className="book-card" key={b.bookid}>
                    <div className={"book-cover cover" + (i % 3)}>
                      <BookOpen size={38} />
                      <span>QIANJI / {String(i + 1).padStart(2, "0")}</span>
                    </div>
                    <h3>{b.name}</h3>
                    <p className="muted small">
                      {b.members?.length ?? b.membercount ?? 0} 位成员 ·{" "}
                      {b.typename ?? "个人账本"}
                    </p>
                    <small className="muted id">{b.bookid}</small>
                  </article>
                ))}
              </div>
            ) : kind === "categories" ? (
              <div className="category-grid">
                {list
                  .filter((c: Category) => c.level !== 2)
                  .map((c: Category) => (
                    <div className="category-group" key={c.bookid + c.id}>
                      <h3>
                        <span className="category-icon">
                          <Shapes size={17} />
                        </span>
                        {c.name}
                        <small className="muted">
                          {c.type === 1 ? "收入" : "支出"}
                        </small>
                      </h3>
                      <div className="category-children">
                        {list
                          .filter((x: Category) => x.parentid === c.id)
                          .map((x: Category) => (
                            <span key={x.id}>{x.name}</span>
                          ))}
                      </div>
                    </div>
                  ))}
              </div>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>名称</th>
                      {kind === "currencies" ? (
                        <>
                          <th>币种</th>
                          <th>参考汇率</th>
                          <th>更新时间</th>
                        </>
                      ) : kind === "assets" || kind === "loans" ? (
                        <>
                          <th>币种</th>
                          <th>余额 / 未结清</th>
                          {kind === "loans" && (
                            <>
                              <th>本金</th>
                              <th>已还金额</th>
                            </>
                          )}
                        </>
                      ) : (
                        <th>{kind === "tags" ? "分组" : "ID"}</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((r: Raw, i: number) => (
                      <tr key={r.id ?? r.symbol ?? i}>
                        <td>
                          <strong>{r.name ?? "未命名"}</strong>
                        </td>
                        {kind === "currencies" ? (
                          <>
                            <td>{r.symbol}</td>
                            <td className="amount">{r.baseprice}</td>
                            <td className="muted">{datetime(r.pricetime)}</td>
                          </>
                        ) : kind === "assets" || kind === "loans" ? (
                          <>
                            <td>
                              {r.currency ??
                                bootstrap.config.mcurrency ??
                                "CNY"}
                            </td>
                            <td className="amount">{money(r.money)}</td>
                            {kind === "loans" && (
                              <>
                                <td>{money(r.loan?.money)}</td>
                                <td>{money(r.loan?.totalpay)}</td>
                              </>
                            )}
                          </>
                        ) : (
                          <td className="muted">
                            {kind === "tags" ? r.groupName : r.id}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
        {kind === "currencies" && (
          <p className="footnote">
            汇率来自钱迹，只展示接口返回值；历史账单使用原有换算结果。
          </p>
        )}
        {kind === "loans" && (
          <p className="footnote">借贷属于整个账号，不受顶部账本选择影响。</p>
        )}
      </section>
    </>
  );
}
