import React, { useEffect, useState } from "react";
import {
  LayoutDashboard,
  ReceiptText,
  ChartNoAxesCombined,
  Wallet,
  Shapes,
  Settings,
  ChevronRight,
  ChevronLeft,
  CalendarDays,
  RefreshCw,
  BookOpen,
  Menu,
  Plus,
  Download,
  ArrowRight,
} from "lucide-react";
import {
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type {
  Bill,
  Book,
  Raw,
  Filters,
  Statistics,
  WriteAction,
} from "../shared/types";
import { api, useRemote, qs } from "./api";
import { money, day, monthRange, nowDate } from "./format";
import { Loading, Notice } from "./ui";
import { Cards, Trend, CategoryRanking, BudgetPanel } from "./charts";
import { BillTable, FiltersBar, BillDetail, WriteForm } from "./bills";
import { Resources } from "./Resources";
import { SettingsPage } from "./SettingsPage";
const navigation = [
  ["overview", "总览", LayoutDashboard],
  ["bills", "账单明细", ReceiptText],
  ["statistics", "收支统计", ChartNoAxesCombined],
  ["budgets", "预算", Wallet],
  ["resources", "账本与资料", Shapes],
  ["settings", "设置", Settings],
] as const;
export function Workspace({ onLogout }: { onLogout: () => void }) {
  const [version, setVersion] = useState(0),
    [page, setPage] = useState(location.hash.slice(1) || "overview"),
    [menu, setMenu] = useState(false),
    [syncing, setSyncing] = useState(false),
    [error, setError] = useState("");
  const [month, setMonth] = useState(nowDate().slice(0, 7)),
    [bookid, setBookid] = useState("-1"),
    [filters, setFilters] = useState<Filters>({
      ...monthRange(nowDate().slice(0, 7)),
      page: "1",
    }),
    [group, setGroup] = useState("day");
  const [selected, setSelected] = useState<string | null>(null),
    [write, setWrite] = useState<{
      action: WriteAction;
      bill?: Bill;
      revision?: string;
    } | null>(null),
    [budgetKind, setBudgetKind] = useState("month");
  const boot = useRemote("/bootstrap", version),
    bootstrap = boot.data;
  const tags = useRemote("/resources/tags", version);
  const overviewFilters = { bookid, ...monthRange(month), group: "day" };
  const activeFilters =
    page === "overview" ? overviewFilters : { ...filters, bookid, group };
  const stats = useRemote<Statistics>(
    page === "overview" || page === "statistics"
      ? "/statistics?" + qs(activeFilters)
      : null,
    version,
  );
  const bills = useRemote(
    page === "overview" || page === "bills"
      ? "/bills?" +
          qs(
            page === "overview"
              ? { ...overviewFilters, pageSize: 6 }
              : { ...filters, bookid },
          )
      : null,
    version,
  );
  const budget = useRemote(
    page === "overview" || page === "budgets"
      ? "/budgets?" +
          qs({
            bookid: bookid || "-1",
            kind: page === "overview" ? "month" : budgetKind,
            period:
              page === "overview" || budgetKind === "month"
                ? month
                : month.slice(0, 4),
          })
      : null,
    version,
  );
  const firstSync = React.useRef(false);
  useEffect(() => {
    const listener = () => setPage(location.hash.slice(1) || "overview");
    window.addEventListener("hashchange", listener);
    return () => window.removeEventListener("hashchange", listener);
  }, []);
  useEffect(() => {
    if (
      bootstrap &&
      !bootstrap.lastSync &&
      !bootstrap.demo &&
      !firstSync.current
    ) {
      firstSync.current = true;
      void sync();
    }
  }, [bootstrap]);
  const refresh = () => setVersion((v) => v + 1);
  async function sync(full = false) {
    setSyncing(true);
    setError("");
    try {
      await api("/sync", { full });
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSyncing(false);
    }
  }
  function nav(key: string) {
    location.hash = key;
    setPage(key);
    setMenu(false);
  }
  function selectBook(value: string) {
    setBookid(value);
    setFilters((f) => ({ ...f, page: "1", category: "", member: "" }));
  }
  if (!bootstrap)
    return (
      <div className="initial-load">
        {boot.error ? (
          <>
            <Notice kind="error">{boot.error}</Notice>
            <button className="secondary" onClick={refresh}>
              重新加载
            </button>
            <button className="text-button" onClick={onLogout}>
              返回登录
            </button>
          </>
        ) : (
          <Loading />
        )}
      </div>
    );
  const title = navigation.find((x) => x[0] === page)?.[1] ?? "总览";
  return (
    <div className="app-layout">
      <aside className={"sidebar " + (menu ? "open" : "")}>
        <a className="brand" href="#overview">
          <span className="brand-mark">迹</span>钱迹 <small>WEB</small>
        </a>
        <div className="sidebar-caption">个人记账工作台</div>
        <nav>
          {navigation.map(([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => nav(key)}
              className={page === key ? "active" : ""}
            >
              <Icon size={19} />
              {label}
              {page === key && <span className="nav-indicator" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="connection">
            <span className="status-dot" />
            {bootstrap.demo ? "演示账本" : "钱迹账号已连接"}
            <small>
              {bootstrap.lastSync
                ? "已同步 " + bootstrap.billCount + " 笔账单"
                : "等待首次同步"}
            </small>
          </div>
          <button className="sidebar-user" onClick={() => nav("settings")}>
            <span className="avatar">
              {bootstrap.user.name?.slice(0, 1) ?? "钱"}
            </span>
            <span>
              {bootstrap.user.name}
              <small>{bootstrap.demo ? "演示模式" : "个人空间"}</small>
            </span>
            <Settings size={16} />
          </button>
        </div>
      </aside>
      {menu && <div className="menu-backdrop" onClick={() => setMenu(false)} />}
      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="mobile-menu icon-button"
              aria-label="打开导航"
              onClick={() => setMenu(true)}
            >
              <Menu size={21} />
            </button>
            <span>我的账本</span>
            <ChevronRight size={14} />
            <strong>{title}</strong>
          </div>
          <div className="topbar-actions">
            <span className="sync-time">
              {bootstrap.lastSync
                ? "更新于 " +
                  new Date(bootstrap.lastSync).toLocaleTimeString("zh-CN", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : "尚未同步"}
            </span>
            <button
              className="secondary sync-button"
              disabled={syncing}
              onClick={() => sync()}
            >
              <RefreshCw size={15} className={syncing ? "spin" : ""} />
              {syncing ? "同步中" : "同步账单"}
            </button>
          </div>
        </header>
        <div className="workspace-content">
          {bootstrap.demo && (
            <div className="demo-banner">
              <span>演示模式 · 当前数据为虚构样例</span>
              <button onClick={onLogout}>
                连接我的钱迹 <ArrowRight size={14} />
              </button>
            </div>
          )}
          {error && (
            <Notice kind="error">
              {error}
              <button className="text-button" onClick={() => sync()}>
                重试
              </button>
            </Notice>
          )}
          <div className="page-heading">
            <div>
              <span className="eyebrow">
                {page === "overview" ? "OVERVIEW" : page.toUpperCase()}
              </span>
              <h1>{page === "overview" ? "收支一目了然" : title}</h1>
              <p className="muted">
                {page === "overview"
                  ? "从每一笔记录，看见生活的节奏。"
                  : page === "bills"
                    ? "查看、筛选与管理你的每一笔收支。"
                    : page === "statistics"
                      ? "让记录变成对生活的理解。"
                      : page === "budgets"
                        ? "有计划地花，也有余地生活。"
                        : page === "resources"
                          ? "账本、账户与分类，井井有条。"
                          : "管理连接，掌握同步与写入状态。"}
              </p>
            </div>
            {page !== "settings" && (
              <div className="heading-actions">
                <label className="book-select">
                  <BookOpen size={16} />
                  <select
                    aria-label="选择账本"
                    value={bookid}
                    onChange={(e) => selectBook(e.target.value)}
                  >
                    {page !== "budgets" && <option value="">全部账本</option>}
                    {bootstrap.books.map((b: Book) => (
                      <option key={b.bookid} value={b.bookid}>
                        {b.name}
                      </option>
                    ))}
                    {bootstrap.books.length === 0 && (
                      <option value="-1">默认账本</option>
                    )}
                  </select>
                </label>
                {(page === "overview" || page === "bills") && (
                  <button
                    className="primary"
                    disabled={bootstrap.demo}
                    title={bootstrap.demo ? "登录后可在测试账本验证写入" : ""}
                    onClick={() => setWrite({ action: "create" })}
                  >
                    <Plus size={18} />
                    记一笔
                  </button>
                )}
              </div>
            )}
          </div>
          {(page === "overview" || page === "budgets") && (
            <div className="period-toolbar">
              <div className="inline-controls">
                <CalendarDays size={18} />
                <input
                  aria-label="选择月份"
                  type="month"
                  value={month}
                  onChange={(e) => {
                    if (e.target.value) setMonth(e.target.value);
                  }}
                />
                {page === "budgets" && (
                  <div className="tabs compact">
                    <button
                      className={budgetKind === "month" ? "active" : ""}
                      onClick={() => setBudgetKind("month")}
                    >
                      月度
                    </button>
                    <button
                      className={budgetKind === "year" ? "active" : ""}
                      onClick={() => setBudgetKind("year")}
                    >
                      年度
                    </button>
                  </div>
                )}
              </div>
              <span className="muted small">
                {bootstrap.config.mcurrency ?? "CNY"} · 北京时间
              </span>
            </div>
          )}
          {page === "overview" && (
            <>
              {stats.error ? (
                <Notice kind="error">{stats.error}</Notice>
              ) : stats.loading ? (
                <Loading />
              ) : (
                stats.data && (
                  <>
                    <Cards
                      stats={stats.data.totals}
                      currency={bootstrap.config.mcurrency ?? "CNY"}
                    />
                    <div className="dashboard-grid">
                      <section className="panel trend-panel">
                        <div className="panel-heading">
                          <h2>收支趋势</h2>
                          <div className="legend">
                            <span className="income-dot" />
                            收入
                            <span className="spend-dot" />
                            净支出
                          </div>
                        </div>
                        <Trend data={stats.data.trend} />
                      </section>
                      <section className="panel">
                        <div className="panel-heading">
                          <h2>{bookid ? "本月预算" : "默认账本预算"}</h2>
                          <button
                            className="text-button"
                            onClick={() => nav("budgets")}
                          >
                            查看全部
                            <ChevronRight size={14} />
                          </button>
                        </div>
                        <BudgetPanel
                          {...budget}
                          data={
                            budget.data
                              ? {
                                  ...budget.data,
                                  list: budget.data.list.filter(
                                    (x: Raw) => Number(x.flag) === 1,
                                  ),
                                }
                              : null
                          }
                        />
                      </section>
                      <section className="panel recent-panel">
                        <div className="panel-heading">
                          <h2>
                            最近账单{" "}
                            <span className="count-tag">
                              {bills.data?.total ?? 0}
                            </span>
                          </h2>
                          <button
                            className="text-button"
                            onClick={() => {
                              setFilters({ ...monthRange(month), page: "1" });
                              nav("bills");
                            }}
                          >
                            全部账单
                            <ChevronRight size={14} />
                          </button>
                        </div>
                        {bills.error ? (
                          <Notice kind="error">{bills.error}</Notice>
                        ) : bills.loading ? (
                          <Loading />
                        ) : (
                          <BillTable
                            bills={bills.data?.list ?? []}
                            categories={bootstrap.categories}
                            books={bootstrap.books}
                            onSelect={setSelected}
                            compact
                          />
                        )}
                      </section>
                      <CategoryRanking stats={stats.data} />
                    </div>
                  </>
                )
              )}
            </>
          )}
          {page === "bills" && (
            <>
              <FiltersBar
                filters={filters}
                onChange={setFilters}
                bootstrap={bootstrap}
                tags={tags.data?.list ?? []}
              />
              {tags.error && <Notice>标签暂时无法读取：{tags.error}</Notice>}
              <section className="panel">
                <div className="panel-heading">
                  <h2>
                    账单记录{" "}
                    <span className="count-tag">{bills.data?.total ?? 0}</span>
                  </h2>
                  <div className="inline-controls">
                    <a
                      className="secondary"
                      href={
                        "/api/bills/export?" +
                        qs({ ...filters, bookid, format: "csv" })
                      }
                    >
                      <Download size={15} />
                      CSV
                    </a>
                    <a
                      className="secondary"
                      href={
                        "/api/bills/export?" +
                        qs({ ...filters, bookid, format: "json" })
                      }
                    >
                      <Download size={15} />
                      JSON
                    </a>
                  </div>
                </div>
                {bills.error ? (
                  <Notice kind="error">{bills.error}</Notice>
                ) : bills.loading ? (
                  <Loading />
                ) : (
                  <BillTable
                    bills={bills.data?.list ?? []}
                    categories={bootstrap.categories}
                    books={bootstrap.books}
                    onSelect={setSelected}
                  />
                )}
                <div className="pagination">
                  <span className="muted small">
                    共 {bills.data?.total ?? 0} 笔 · 每页 25 笔
                  </span>
                  <div>
                    <button
                      className="icon-button"
                      aria-label="上一页"
                      disabled={Number(filters.page ?? 1) <= 1}
                      onClick={() =>
                        setFilters((f) => ({
                          ...f,
                          page: String(Number(f.page ?? 1) - 1),
                        }))
                      }
                    >
                      <ChevronLeft size={18} />
                    </button>
                    <span>
                      {filters.page ?? 1} /{" "}
                      {Math.max(1, Math.ceil((bills.data?.total ?? 0) / 25))}
                    </span>
                    <button
                      className="icon-button"
                      aria-label="下一页"
                      disabled={
                        Number(filters.page ?? 1) * 25 >=
                        (bills.data?.total ?? 0)
                      }
                      onClick={() =>
                        setFilters((f) => ({
                          ...f,
                          page: String(Number(f.page ?? 1) + 1),
                        }))
                      }
                    >
                      <ChevronRight size={18} />
                    </button>
                  </div>
                </div>
              </section>
            </>
          )}
          {page === "statistics" && (
            <>
              <FiltersBar
                filters={filters}
                onChange={setFilters}
                bootstrap={bootstrap}
                tags={tags.data?.list ?? []}
              />
              {stats.error ? (
                <Notice kind="error">{stats.error}</Notice>
              ) : stats.loading ? (
                <Loading />
              ) : (
                stats.data && (
                  <>
                    <Cards
                      stats={stats.data.totals}
                      currency={bootstrap.config.mcurrency ?? "CNY"}
                    />
                    <div className="stats-grid">
                      <section className="panel">
                        <div className="panel-heading">
                          <h2>收支趋势</h2>
                          <div className="tabs compact">
                            {[
                              ["day", "按日"],
                              ["month", "按月"],
                              ["year", "按年"],
                            ].map(([key, label]) => (
                              <button
                                className={group === key ? "active" : ""}
                                key={key}
                                onClick={() => setGroup(key!)}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>
                        <Trend data={stats.data.trend} group={group} />
                      </section>
                      <CategoryRanking stats={stats.data} />
                    </div>
                    <section className="panel">
                      <div className="panel-heading">
                        <h2>其他资金变动</h2>
                        <span className="muted small">
                          独立统计，不计入普通收支
                        </span>
                      </div>
                      <div className="other-totals">
                        {[
                          ["transfer", "转账"],
                          ["repayment", "信用卡还款"],
                          ["reimbursement", "报销"],
                          ["unknown", "其他类型"],
                        ].map(([key, label]) => (
                          <div key={key}>
                            <span>{label}</span>
                            <strong>
                              {money(
                                (stats.data!.totals as unknown as Raw)[key!],
                              )}
                            </strong>
                          </div>
                        ))}
                      </div>
                      <p className="footnote">
                        退款在退款发生期间抵扣支出，并尽可能沿用原账单分类。
                        {stats.data.orphanRefunds > 0
                          ? `其中 ${stats.data.orphanRefunds} 笔退款未找到原账单，使用退款自身分类。`
                          : ""}
                        报销口径尚未完整验证，因此单独展示。
                      </p>
                    </section>
                    <section className="panel">
                      <div className="panel-heading">
                        <h2>期间明细</h2>
                      </div>
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>期间</th>
                              <th>收入</th>
                              <th>净支出</th>
                              <th>退款</th>
                              <th>净结余</th>
                            </tr>
                          </thead>
                          <tbody>
                            {stats.data.trend.map((t) => (
                              <tr key={t.date}>
                                <td>{t.date}</td>
                                <td>{money(t.income)}</td>
                                <td>{money(t.spend)}</td>
                                <td>{money(t.refund)}</td>
                                <td>{money(t.net)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  </>
                )
              )}
            </>
          )}
          {page === "budgets" && (
            <>
              <BudgetPanel {...budget} full />
              {budget.data?.daystats?.length > 0 && (
                <section className="panel">
                  <div className="panel-heading">
                    <h2>每日预算消耗</h2>
                  </div>
                  <div className="chart">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={budget.data.daystats.map((x: Raw) => ({
                          date: day(Number(x.datetime)).slice(5),
                          spend: Number(x.spend),
                          totalspend:
                            x.totalspend === undefined
                              ? undefined
                              : Number(x.totalspend),
                        }))}
                      >
                        <CartesianGrid vertical={false} strokeDasharray="4 4" />
                        <XAxis dataKey="date" tickLine={false} />
                        <YAxis tickLine={false} />
                        <Tooltip formatter={(v) => money(v)} />
                        <Bar
                          isAnimationActive={false}
                          dataKey="spend"
                          name="当日支出"
                          fill="#278575"
                          radius={[4, 4, 0, 0]}
                        />
                        <Bar
                          isAnimationActive={false}
                          dataKey="totalspend"
                          name="累计支出"
                          fill="#b9cfc7"
                          radius={[4, 4, 0, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </section>
              )}
            </>
          )}
          {page === "resources" && (
            <Resources
              bootstrap={bootstrap}
              version={version}
              bookid={bookid}
            />
          )}
          {page === "settings" && (
            <SettingsPage
              bootstrap={bootstrap}
              version={version}
              onDone={refresh}
              onLogout={onLogout}
            />
          )}
          <footer className="workspace-footer">
            <span>钱迹 WEB · 个人记账工作台</span>
            <span>数据由钱迹同步 · 统计在本地计算</span>
          </footer>
        </div>
      </main>
      {selected && !write && (
        <BillDetail
          id={selected}
          bootstrap={bootstrap}
          onClose={() => setSelected(null)}
          onWrite={(action, bill, revision) =>
            setWrite({ action, bill, revision })
          }
          version={version}
        />
      )}{" "}
      {write && (
        <WriteForm
          {...write}
          bootstrap={bootstrap}
          onClose={() => setWrite(null)}
          onDone={refresh}
        />
      )}
    </div>
  );
}
