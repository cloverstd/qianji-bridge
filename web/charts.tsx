import { Decimal } from "decimal.js";
import {
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { ArrowUpRight, ArrowDownLeft, Wallet } from "lucide-react";
import type { Statistics, Raw } from "../shared/types";
import { money } from "./format";
import { Empty, Notice, Loading } from "./ui";
export function Trend({
  data,
  group = "day",
}: {
  data: Statistics["trend"];
  group?: string;
}) {
  if (!data.length) return <Empty text="这个期间还没有账单" />;
  const chart = data.map((x) => ({
    ...x,
    spend: Number(x.spend),
    income: Number(x.income),
    label: group === "day" ? x.date.slice(5) : x.date,
  }));
  return (
    <div className="chart" aria-label="收支趋势图">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={chart}
          margin={{ top: 15, right: 12, left: 0, bottom: 5 }}
        >
          <defs>
            <linearGradient id="spendFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#dba13c" stopOpacity={0.24} />
              <stop offset="100%" stopColor="#dba13c" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="incomeFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#278575" stopOpacity={0.17} />
              <stop offset="100%" stopColor="#278575" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="4 4"
            vertical={false}
            stroke="#e9eeeb"
          />
          <XAxis
            dataKey="label"
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 12, fill: "#78837d" }}
            minTickGap={22}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 12, fill: "#78837d" }}
            width={48}
            tickFormatter={(n) => (n >= 1000 ? n / 1000 + "k" : String(n))}
          />
          <Tooltip
            formatter={(v) => money(v)}
            contentStyle={{ borderRadius: 12, border: "1px solid #e4e9e5" }}
          />
          <Area
            isAnimationActive={false}
            type="monotone"
            dataKey="income"
            name="收入"
            stroke="#278575"
            fill="url(#incomeFill)"
            strokeWidth={2.5}
          />
          <Area
            isAnimationActive={false}
            type="monotone"
            dataKey="spend"
            name="净支出"
            stroke="#dba13c"
            fill="url(#spendFill)"
            strokeWidth={2.5}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
export function Cards({
  stats,
  currency,
}: {
  stats: Statistics["totals"];
  currency: string;
}) {
  return (
    <div className="summary-grid">
      {[
        {
          label: "净支出",
          value: stats.spend,
          icon: ArrowUpRight,
          cls: "spend",
          desc: `已扣除退款 ${money(stats.refund)}`,
        },
        {
          label: "总收入",
          value: stats.income,
          icon: ArrowDownLeft,
          cls: "income",
          desc: "普通收入，不含账户转入",
        },
        {
          label: "净结余",
          value: stats.net,
          icon: Wallet,
          cls: "balance",
          desc: `共 ${stats.count} 笔账单`,
        },
      ].map((x) => (
        <section className={"summary-card " + x.cls} key={x.label}>
          <div className="summary-label">
            <span>{x.label}</span>
            <x.icon size={19} />
          </div>
          <strong>
            <small>{currency === "CNY" ? "¥" : currency}</small>
            {money(x.value)}
          </strong>
          <span className="summary-desc">{x.desc}</span>
        </section>
      ))}
    </div>
  );
}
export function CategoryRanking({ stats }: { stats: Statistics }) {
  const max = Math.max(
    1,
    ...stats.categories.map((c) => Math.abs(Number(c.money))),
  );
  const sum = stats.categories.reduce(
    (n, c) => n.plus(c.money),
    new Decimal(0),
  );
  return (
    <section className="panel ranking">
      <div className="panel-heading">
        <h2>支出去向</h2>
        <span className="muted small">一级分类 · 净额</span>
      </div>
      {!stats.categories.length ? (
        <Empty />
      ) : (
        stats.categories.slice(0, 8).map((c, i) => (
          <div className="rank-row" key={c.id}>
            <span className="rank-number">
              {String(i + 1).padStart(2, "0")}
            </span>
            <div className="rank-main">
              <div>
                <span>{c.name}</span>
                <strong>
                  {money(c.money)}{" "}
                  <small className="muted">
                    {sum.gt(0)
                      ? new Decimal(c.money).div(sum).times(100).toFixed(1) +
                        "%"
                      : "—"}
                  </small>
                </strong>
              </div>
              <div className="track">
                <i
                  style={{
                    width:
                      Math.min(100, (Math.abs(Number(c.money)) / max) * 100) +
                      "%",
                    background: [
                      "#278575",
                      "#69a18d",
                      "#e0ad53",
                      "#94b3aa",
                      "#b9c9c1",
                    ][i % 5],
                  }}
                />
              </div>
            </div>
          </div>
        ))
      )}
    </section>
  );
}
export function BudgetPanel({
  data,
  error,
  loading,
  full = false,
}: {
  data: Raw | null;
  error: string;
  loading: boolean;
  full?: boolean;
}) {
  if (error) return <Notice kind="error">{error}</Notice>;
  if (loading) return <Loading />;
  if (!data?.list.length)
    return (
      <Empty
        text="这个期间还没有预算"
        detail="可在钱迹 App 设置预算，然后在这里查看进度。"
      />
    );
  return (
    <div className={full ? "budget-grid" : ""}>
      {data.list.map((b: Raw) => {
        const total = new Decimal(b.money),
          used = new Decimal(b.used),
          remaining = total.minus(used),
          percent = total.gt(0) ? used.div(total).times(100).toNumber() : 0;
        return (
          <section
            className={"budget-card " + (full ? "panel" : "")}
            key={b.budgetid}
          >
            <div className="budget-title">
              <span className="budget-icon">
                <Wallet size={21} />
              </span>
              <div>
                <h3>
                  {Number(b.flag) === 1
                    ? "总预算"
                    : (b.category?.name ?? "分类预算")}
                </h3>
                <span className="muted small">
                  {remaining.lt(0) ? "已超出预算" : "稳稳掌握每一笔"}
                </span>
              </div>
              <strong className={remaining.lt(0) ? "negative" : ""}>
                {percent.toFixed(0)}
                <small>%</small>
              </strong>
            </div>
            <div
              className={
                "track budget-track " + (remaining.lt(0) ? "over" : "")
              }
            >
              <i style={{ width: Math.max(0, Math.min(100, percent)) + "%" }} />
            </div>
            <div className="budget-numbers">
              <div>
                <small>已使用</small>
                <strong>{money(used)}</strong>
              </div>
              <div>
                <small>预算额度</small>
                <strong>{money(total)}</strong>
              </div>
            </div>
            <p
              className={
                "budget-remaining " + (remaining.lt(0) ? "negative" : "")
              }
            >
              {remaining.lt(0) ? "已超支" : "还可支出"}{" "}
              <b>{money(remaining.abs())}</b>
            </p>
          </section>
        );
      })}
    </div>
  );
}
